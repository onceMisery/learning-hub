//! # 集成测试：只通过公开 API 验证端到端行为
//!
//! Rust 里有两类测试，和 Java 的组织方式很不一样：
//! - **单元测试**：写在源码文件的 `#[cfg(test)] mod tests` 里，
//!   可以访问私有成员（≈ 把测试写在同一个 package 下）
//! - **集成测试**：放在 `tests/`，只能访问 crate 的 **pub API**
//!   （≈ 站在库使用者的视角写黑盒测试）
//!
//! 另外 Rust 没有 `JUnit` 的 `@BeforeEach`——每个测试函数都是独立进程内
//! 并行执行的任务，共享状态要自己用 `tempfile::TempDir` 隔离。

use std::fs::OpenOptions;
use std::io::Write as _;

use minidb::engine::{apply, Engine};
use minidb::error::Result;
use minidb::stage3_protocol::{Command, Response};
use minidb::stage7_concurrent::SharedEngine;

/// 走一遍完整的 CRUD + 重启流程。
#[test]
fn persistence_survives_restart() -> Result<()> {
    let dir = tempfile::tempdir().unwrap();

    {
        let mut db = Engine::open(dir.path())?;
        assert_eq!(apply(&mut db, Command::parse("SET user:1 alice").unwrap()), Response::Ok);
        assert_eq!(apply(&mut db, Command::parse("SET user:2 bob").unwrap()), Response::Ok);
        assert_eq!(
            apply(&mut db, Command::parse("GET user:1").unwrap()),
            Response::Value(Some(b"alice".to_vec()))
        );
        db.close()?;
    }

    // 重新打开：数据必须还在（索引靠重放日志重建）
    let mut db = Engine::open(dir.path())?;
    assert_eq!(
        apply(&mut db, Command::parse("GET user:2").unwrap()),
        Response::Value(Some(b"bob".to_vec()))
    );

    let Response::Keys(keys) = apply(&mut db, Command::parse("KEYS user:").unwrap()) else {
        panic!("期望 Keys 响应");
    };
    assert_eq!(keys, vec!["user:1", "user:2"]);

    // 删除后重启，键不能"复活"（墓碑记账的作用）
    assert_eq!(
        apply(&mut db, Command::parse("DEL user:1").unwrap()),
        Response::Value(Some(b"alice".to_vec()))
    );
    db.close()?;

    let db = Engine::open(dir.path())?;
    assert_eq!(db.get("user:1")?, None);
    Ok(())
}

/// 二进制安全：值里可以有 \r\n、引号、非 UTF-8 字节。
#[test]
fn values_are_binary_safe() -> Result<()> {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Engine::open(dir.path())?;

    let payload = vec![0u8, 1, 13, 10, 255, 254];
    db.set("bin", payload.clone())?;
    assert_eq!(db.get("bin")?, Some(payload));

    // 带空格的值要走引号语法
    assert_eq!(apply(&mut db, Command::parse(r#"SET msg "hello world""#).unwrap()), Response::Ok);
    assert_eq!(db.get("msg")?, Some(b"hello world".to_vec()));
    Ok(())
}

/// 崩溃模拟：在日志尾部追加半个帧，重开后应该被截断且好数据不丢。
#[test]
fn crash_mid_write_recovers() -> Result<()> {
    let dir = tempfile::tempdir().unwrap();
    {
        let mut db = Engine::open(dir.path())?;
        db.set("survivor", b"important".to_vec())?;
        db.close()?;
    }

    // 手动破坏日志尾部
    let log = dir.path().join(format!("{:09}.log", 1));
    let mut f = OpenOptions::new().append(true).open(&log)?;
    f.write_all(&[0x4D, 0x44, 0x42, 0x31, 0x09, 0x00])?;
    f.sync_all()?;
    drop(f);

    let mut db = Engine::open(dir.path())?;
    assert_eq!(db.get("survivor")?, Some(b"important".to_vec()));
    // 恢复后还能继续写入
    db.set("after", b"recovery".to_vec())?;
    assert_eq!(db.get("after")?, Some(b"recovery".to_vec()));
    Ok(())
}

/// 反复覆盖同一个键：写路径里内置的自动 GC 应该被触发，且数据始终正确。
#[test]
fn compaction_reclaims_space_and_keeps_data() -> Result<()> {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Engine::open(dir.path())?;

    for i in 0..200 {
        db.set("counter", format!("value-{i}").into_bytes())?;
    }
    db.set("keep", b"me".to_vec())?;

    // `Engine::set` 内部会在垃圾占比超阈值时自动合并，所以这里应该已经触发过
    assert!(db.stats().snapshot().compactions >= 1, "自动合并应被触发");

    // 手动再合并一次：幂等，且不能破坏数据
    db.compact()?;
    // 浮点数不要用 assert_eq! 直接比（clippy::float_cmp），用区间断言
    assert!(db.garbage_ratio() < 1e-9, "合并后不应还有垃圾: {}", db.garbage_ratio());

    assert_eq!(db.get("counter")?, Some(b"value-199".to_vec()));
    assert_eq!(db.get("keep")?, Some(b"me".to_vec()));
    Ok(())
}

/// 数据目录互斥锁：第二个实例不能打开同一个目录。
#[test]
fn directory_lock_is_exclusive() -> Result<()> {
    let dir = tempfile::tempdir().unwrap();
    let _first = Engine::open(dir.path())?;
    assert!(Engine::open(dir.path()).is_err(), "同一目录不应被打开两次");
    Ok(())
}

/// 多线程共享：模拟真实的并发读写负载。
#[test]
fn concurrent_clients_isolate_data() -> Result<()> {
    let dir = tempfile::tempdir().unwrap();
    let engine = SharedEngine::open(dir.path())?;

    let handles: Vec<_> = (0..4)
        .map(|t| {
            let eng = engine.clone();
            std::thread::spawn(move || {
                for i in 0..50 {
                    let _ = eng.apply_line(&format!("SET tenant{t}:key{i} value{i}"));
                    let resp = eng.apply_line(&format!("GET tenant{t}:key{i}"));
                    assert_eq!(resp, Response::Value(Some(format!("value{i}").into_bytes())));
                }
            })
        })
        .collect();

    for h in handles {
        h.join().expect("工作线程不应 panic");
    }

    let Response::Keys(all) = engine.apply_line("KEYS ") else {
        panic!("期望 Keys 响应");
    };
    assert_eq!(all.len(), 200);
    Ok(())
}
