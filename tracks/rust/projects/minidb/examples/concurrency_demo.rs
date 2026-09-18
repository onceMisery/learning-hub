//! # 示例：并发与"事务"边界
//!
//! 这个例子回答四个问题：
//!
//! | 场景 | 问题 | 结论 |
//! |------|------|------|
//! | A | 8 个线程各写 100 个**不同**的键，会丢数据吗？ | 不会 —— 写锁保证 |
//! | B | 8 个线程对**同一个**键做「读 → +1 → 写」，能加对吗？ | **不能** —— 丢失更新 |
//! | C | 用一把应用层的 `Mutex` 包住整个读改写呢？ | 能 —— 但原子性的粒度变了 |
//! | D | 并发写同一个键，读到的一定是完整的值吗？ | 是 —— 单键写入是原子的 |
//!
//! 运行（**务必用 release**，debug 下场景 B 慢且结果更随机）：
//! ```bash
//! cargo run --release --example concurrency_demo
//! ```

use minidb::stage3_protocol::{Command, Response};
use minidb::stage7_concurrent::SharedEngine;
use std::sync::{Arc, Mutex};
use std::thread;

const THREADS: usize = 8;
const PER_THREAD: usize = 1000;

fn main() {
    let dir = std::env::temp_dir().join("minidb_concurrency_demo");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("建目录失败");

    println!("线程数 {THREADS}，每线程 {PER_THREAD} 次操作");
    println!();

    // =======================================================================
    // A. 并发写不同的键 —— 不丢
    // =======================================================================
    println!("=== A. 8 个线程各写 100 个不同的键 ===");
    let engine = SharedEngine::open(&dir).expect("打开失败");

    let mut handles = Vec::new();
    for t in 0..8u32 {
        let eng = engine.clone();
        handles.push(thread::spawn(move || {
            for i in 0..100u32 {
                let resp = eng.apply_cmd(Command::Set {
                    key: format!("t{t}-k{i}"),
                    value: format!("v{i}").into_bytes(),
                });
                assert_eq!(resp, Response::Ok);
            }
        }));
    }
    for h in handles {
        h.join().expect("线程 panic");
    }

    let Response::Keys(keys) = engine.apply_cmd(Command::Keys { prefix: String::new() }) else {
        panic!("期望 Keys 响应");
    };
    println!("写入后键数: {}（期望 800）", keys.len());
    assert_eq!(keys.len(), 800, "并发写不同键不该丢数据");
    println!("✅ 写锁让每次 SET 独占引擎，所以不会丢");
    println!();

    // =======================================================================
    // B. 并发读改写同一个键 —— 丢失更新
    // =======================================================================
    println!("=== B. 8 个线程对同一个键做「读 → +1 → 写」===");

    set_counter(&engine, 0);
    let expected = (THREADS * PER_THREAD) as u64;

    let mut handles = Vec::new();
    for _ in 0..THREADS {
        let eng = engine.clone();
        handles.push(thread::spawn(move || {
            for _ in 0..PER_THREAD {
                // ⚠️ 关键：GET 和 SET 是**两条独立命令**，各自拿一次锁。
                // 中间没有任何东西阻止别的线程插进来。
                let cur = read_counter(&eng);
                set_counter(&eng, cur + 1);
            }
        }));
    }
    for h in handles {
        h.join().expect("线程 panic");
    }

    let actual = read_counter(&engine);
    println!("期望: {expected}");
    println!("实际: {actual}");
    println!("丢失: {} 次更新（{:.1}%）", expected - actual,
        (expected - actual) as f64 / expected as f64 * 100.0);
    println!("⚠️  每次运行的数字都不一样 —— 这正是竞态的特征");
    println!("   原因：minidb 没有多命令事务，GET + SET 不是一个原子操作");
    println!();

    // =======================================================================
    // C. 用应用层 Mutex 把读改写成原子操作
    // =======================================================================
    println!("=== C. 用一把应用层的 Mutex 包住整个读改写 ===");

    set_counter(&engine, 0);
    let guard = Arc::new(Mutex::new(()));

    let mut handles = Vec::new();
    for _ in 0..THREADS {
        let eng = engine.clone();
        let guard = Arc::clone(&guard);
        handles.push(thread::spawn(move || {
            for _ in 0..PER_THREAD {
                // 锁住的是**整个读改写序列**，而不是单条命令
                let _g = guard.lock().unwrap();
                let cur = read_counter(&eng);
                set_counter(&eng, cur + 1);
            }
        }));
    }
    for h in handles {
        h.join().expect("线程 panic");
    }

    let actual = read_counter(&engine);
    println!("期望: {expected}");
    println!("实际: {actual}");
    assert_eq!(actual, expected, "加了外层锁就应该正确");
    println!("✅ 正确了 —— 但也退化成完全串行，吞吐和单线程差不多");
    println!();

    // =======================================================================
    // D. 单键写入的原子性
    // =======================================================================
    println!("=== D. 并发写同一个键，读到的一定是完整的值吗？===");

    let writer_done = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let mut handles = Vec::new();

    // 8 个写线程，每个写自己专属的 8 字节值
    for t in 0..THREADS {
        let eng = engine.clone();
        handles.push(thread::spawn(move || {
            for _ in 0..500 {
                // 每个线程写自己专属的 8 字节标记："00000000" / "11111111" / … / "77777777"
                // 用「重复同一个数字」而不是 {:08}（那是补零，会得到 "00000003"），
                // 这样校验时只要检查"8 个字符全相同"就能识别出混合值。
                let v = t.to_string().repeat(8);
                let _ = eng.apply_cmd(Command::Set { key: "atomic".into(), value: v.into_bytes() });
            }
        }));
    }
    // 同时用一个读线程反复读，检查读到的永远是「某个线程写过的完整值」。
    // 它的返回值是 (reads, bad)，类型和其他 JoinHandle<()> 不同，所以单独存一个变量。
    let reader = {
        let eng = engine.clone();
        let done = Arc::clone(&writer_done);
        thread::spawn(move || {
            let mut bad = 0u64;
            let mut reads = 0u64;
            while !done.load(std::sync::atomic::Ordering::Relaxed) {
                if let Response::Value(Some(v)) = eng.apply_cmd(Command::Get { key: "atomic".into() }) {
                    reads += 1;
                    let s = String::from_utf8(v).unwrap_or_default();
                    // 必须是 8 字节、且是 0..8 中某个线程的标记
                    let ok = s.len() == 8 && s.chars().all(|c| c.is_ascii_digit())
                        && s.chars().all(|c| c == s.chars().next().unwrap());
                    if !ok {
                        bad += 1;
                    }
                }
            }
            (reads, bad)
        })
    };

    // 等写线程结束，再让读线程退出
    for h in handles {
        h.join().expect("线程 panic");
    }
    writer_done.store(true, std::sync::atomic::Ordering::Relaxed);
    let (reads, bad) = reader.join().expect("读线程 panic");

    println!("读线程共读了 {reads} 次，其中读到「撕裂 / 混合」的值: {bad} 次");
    assert_eq!(bad, 0, "单键写入必须是原子的");
    println!("✅ 单条 SET 是原子的：不会读到一半旧值一半新值");
    println!("   （写锁独占 + 一次 write_all，读线程要么看到写前、要么看到写后）");

    println!();
    println!("全部断言通过 ✅");
}

/// 读出计数器（键固定为 "counter"，值为十进制字符串）。
fn read_counter(engine: &SharedEngine) -> u64 {
    match engine.apply_cmd(Command::Get { key: "counter".into() }) {
        Response::Value(Some(v)) => String::from_utf8(v).unwrap().parse().unwrap_or(0),
        _ => 0,
    }
}

fn set_counter(engine: &SharedEngine, v: u64) {
    let _ = engine.apply_cmd(Command::Set { key: "counter".into(), value: v.to_string().into_bytes() });
}
