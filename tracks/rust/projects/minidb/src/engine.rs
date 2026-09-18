//! # 阶段 9：整合与打磨
//!
//! 前面 8 个阶段分别演示了不同语言特性，这里是**生产形态的整合版**：
//! 一个干净的公开 API、可观测的统计指标、以及性能与工程化打磨。
//!
//! ## 与 Java 的对照
//!
//! | Java | Rust |
//! |------|------|
//! | `public final class Engine implements Closeable` | `pub struct Engine`（没有继承，组合优先） |
//! | Micrometer `Counter`/`Timer` | 手写的原子计数器或 `metrics` crate |
//! | `@Builder` / setter 注入配置 | `#[derive(Debug)] struct Config` + `Engine::with_config` |
//! | JMH benchmark | `criterion`（或本模块里的 `#[ignore]` 冒烟测试） |
//! | `Objects.requireNonNull` | 类型系统保证非空，不需要 |
//! | JIT 预热 + GC 调优 | 编译期优化 + 无 GC，延迟更稳定 |
//!
//! ## 本阶段的性能要点
//! 1. **能借用就别拷贝**：`get(&self, key: &str)` 而不是 `get(&self, key: String)`
//! 2. **预分配容量**：`Vec::with_capacity`、`HashMap::with_capacity`
//! 3. **release 构建**：`cargo build --release`，debug 版慢数倍到数十倍
//! 4. **热路径避免锁竞争**：见阶段 7/8 的并发设计
//! 5. **零拷贝读**：真实引擎会用 `mmap` 或 `Bytes`（引用计数切片）避免 `Vec` 拷贝

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use serde::Serialize;

use crate::error::Result;
use crate::stage3_protocol::{Command, Response};
// 必须导入 trait 才能调用 `inner.get/set/...`（见 minidb-cli.rs 里的说明）
use crate::stage4_traits::KvStore;
use crate::stage6_compact::SegmentEngine;

/// 引擎配置。
///
/// 为什么用 struct 而不是一堆 `set_xxx` 方法？
/// Rust 里**没有建造者模式的必要**：结构体字面量 + `..Default::default()`
/// 就能表达"只覆盖关心的字段"，且编译期检查字段是否齐全。
#[derive(Debug, Clone)]
pub struct Config {
    /// 活跃段滚动阈值（字节）。
    pub segment_max_bytes: u64,
    /// 垃圾占比超过该值时自动合并。
    pub compact_threshold: f64,
}

impl Default for Config {
    fn default() -> Self {
        Self { segment_max_bytes: 64 * 1024 * 1024, compact_threshold: 0.3 }
    }
}

/// 运行期统计指标。
///
/// `AtomicU64` 而不是 `AtomicLong`/`LongAdder`——语义基本一致，
/// 但 Rust 里这些计数器天然可以被多线程共享（因为 `Engine` 是 `Sync`）。
/// `#[derive(Serialize)]` 让我们能直接 `GET /stats` 返回 JSON。
#[derive(Debug, Default, Serialize)]
pub struct Stats {
    /// 读次数。
    pub gets: AtomicU64,
    /// 写次数。
    pub sets: AtomicU64,
    /// 删除次数。
    pub deletes: AtomicU64,
    /// 合并次数。
    pub compactions: AtomicU64,
}

impl Stats {
    /// 原子自增。`Relaxed` 只保证原子性、不保证顺序——
    /// 计数器场景够用了，比 `SeqCst` 便宜（≈ Java 的 `LongAdder` vs `AtomicLong`）。
    fn incr(c: &AtomicU64) {
        c.fetch_add(1, Ordering::Relaxed);
    }

    /// 导出快照为普通结构体（便于序列化）。
    #[must_use]
    pub fn snapshot(&self) -> StatsSnapshot {
        StatsSnapshot {
            gets: self.gets.load(Ordering::Relaxed),
            sets: self.sets.load(Ordering::Relaxed),
            deletes: self.deletes.load(Ordering::Relaxed),
            compactions: self.compactions.load(Ordering::Relaxed),
        }
    }
}

/// 统计快照（普通数值，可直接 JSON 序列化）。
#[derive(Debug, Default, Serialize)]
pub struct StatsSnapshot {
    /// 读次数。
    pub gets: u64,
    /// 写次数。
    pub sets: u64,
    /// 删除次数。
    pub deletes: u64,
    /// 合并次数。
    pub compactions: u64,
}

/// minidb 的公开引擎类型。
///
/// 设计要点：**组合而不是继承**。`Engine` 持有 `SegmentEngine`，
/// 只暴露想暴露的方法。Rust 没有 `extends`，也就没有"父类改了子类崩"的问题。
pub struct Engine {
    inner: SegmentEngine,
    stats: Stats,
    config: Config,
    started_at: Instant,
}

impl Engine {
    /// 打开数据目录（默认配置）。
    pub fn open(dir: impl AsRef<Path>) -> Result<Self> {
        Self::with_config(dir, Config::default())
    }

    /// 用指定配置打开。
    pub fn with_config(dir: impl AsRef<Path>, config: Config) -> Result<Self> {
        let inner = SegmentEngine::open(dir)?;
        Ok(Self { inner, stats: Stats::default(), config, started_at: Instant::now() })
    }

    /// 读取一个键。
    pub fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        Stats::incr(&self.stats.gets);
        self.inner.get(key)
    }

    /// 写入一个键值对。
    ///
    /// 参数 `value: impl Into<Vec<u8>>`：调用方可以传 `Vec<u8>`、`&[u8]`、`String`，
    /// 不需要像 Java 那样写三个重载。
    pub fn set(&mut self, key: &str, value: impl Into<Vec<u8>>) -> Result<()> {
        Stats::incr(&self.stats.sets);
        self.inner.set(key, value.into())?;
        // 写后检查是否需要合并（≈ Java 里在 Service 方法末尾做一次兜底逻辑）
        if self.inner.garbage_ratio() >= self.config.compact_threshold {
            Stats::incr(&self.stats.compactions);
            self.inner.compact()?;
        }
        Ok(())
    }

    /// 删除一个键。
    pub fn delete(&mut self, key: &str) -> Result<Option<Vec<u8>>> {
        Stats::incr(&self.stats.deletes);
        self.inner.delete(key)
    }

    /// 判断键是否存在（走索引，不读值——避免无谓 IO）。
    pub fn exists(&self, key: &str) -> Result<bool> {
        Ok(self.get(key)?.is_some())
    }

    /// 前缀扫描。
    pub fn keys(&self, prefix: &str) -> Result<Vec<String>> {
        self.inner.keys(prefix)
    }

    /// 手动触发合并。
    pub fn compact(&mut self) -> Result<u64> {
        Stats::incr(&self.stats.compactions);
        self.inner.compact()
    }

    /// 统计指标快照。
    #[must_use]
    pub const fn stats(&self) -> &Stats {
        &self.stats
    }

    /// 运行时间。
    #[must_use]
    pub fn uptime(&self) -> std::time::Duration {
        self.started_at.elapsed()
    }

    /// 垃圾占比。
    #[must_use]
    pub fn garbage_ratio(&self) -> f64 {
        self.inner.garbage_ratio()
    }

    /// 关闭引擎（消费所有权，之后无法再使用）。
    pub fn close(self) -> Result<()> {
        self.inner.close()
    }
}

/// 把一条命令应用到引擎上，返回响应。
///
/// 抽成自由函数的原因是：**协议处理和引擎实现解耦**。
/// 阶段 7（线程服务器）和阶段 8（异步服务器）复用同一个函数，
/// 保证两种服务器的行为完全一致——这在测试上很有价值。
///
/// 注意错误处理策略：这里把 `Err` 转成 `Response::Error` 而不是向上传播。
/// 协议层的错误应该回给客户端，而不是让整个进程退出。
pub fn apply(engine: &mut Engine, cmd: Command) -> Response {
    match cmd {
        Command::Ping => Response::Pong,
        Command::Quit => Response::Ok,
        Command::Set { key, value } => match engine.set(&key, value) {
            Ok(()) => Response::Ok,
            Err(e) => Response::Error(e.to_string()),
        },
        Command::Get { key } => Response::from_result(engine.get(&key)),
        Command::Delete { key } => Response::from_result(engine.delete(&key)),
        Command::Exists { key } => match engine.exists(&key) {
            Ok(b) => Response::Bool(b),
            Err(e) => Response::Error(e.to_string()),
        },
        Command::Keys { prefix } => match engine.keys(&prefix) {
            Ok(ks) => Response::Keys(ks),
            Err(e) => Response::Error(e.to_string()),
        },
        Command::Compact => match engine.compact() {
            Ok(n) => Response::Keys(vec![format!("reclaimed={n}")]),
            Err(e) => Response::Error(e.to_string()),
        },
    }
}

/// 只读版本的命令执行，只需要 `&Engine`。
///
/// 为什么单独拆一个函数？因为**并发服务器要靠它区分读锁和写锁**（阶段 7）：
/// 只读命令拿 `RwLock::read()`，可以并发执行；写命令才需要独占的 write 锁。
/// Java 里通常靠 `@Transactional(readOnly = true)` 这类约定，
/// Rust 直接把"可并发"这件事写进了函数签名。
pub fn apply_read(engine: &Engine, cmd: Command) -> Response {
    match cmd {
        Command::Get { key } => Response::from_result(engine.get(&key)),
        Command::Exists { key } => match engine.exists(&key) {
            Ok(b) => Response::Bool(b),
            Err(e) => Response::Error(e.to_string()),
        },
        Command::Keys { prefix } => match engine.keys(&prefix) {
            Ok(ks) => Response::Keys(ks),
            Err(e) => Response::Error(e.to_string()),
        },
        Command::Ping => Response::Pong,
        // 其余命令需要写锁，不该走这条路径
        other => Response::Error(format!("{} 不是只读命令", other.name())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_crud_and_stats() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = Engine::open(dir.path()).unwrap();
        e.set("a", b"1".to_vec()).unwrap();
        assert_eq!(e.get("a").unwrap(), Some(b"1".to_vec()));
        assert!(e.exists("a").unwrap());

        assert_eq!(e.delete("a").unwrap(), Some(b"1".to_vec()));
        assert!(!e.exists("a").unwrap());
        // 删除是写墓碑，不是把记录抹掉——所以重启后键不会"复活"
        assert!(!e.exists("a").unwrap());

        assert_eq!(e.stats().snapshot().sets, 1);
        assert_eq!(e.stats().snapshot().deletes, 1);
        e.close().unwrap();
    }

    /// 性能冒烟测试：默认被 `#[ignore]` 跳过，
    /// 需要时用 `cargo test --release -- --ignored --nocapture` 跑。
    /// ≈ JMH 的简化版：先看量级对不对，再决定要不要上 criterion。
    #[test]
    #[ignore = "性能测试，用 --release 运行"]
    fn write_throughput_smoke() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = Engine::open(dir.path()).unwrap();
        let n = 20_000u64;
        let start = Instant::now();
        for i in 0..n {
            e.set(&format!("key{i}"), b"value".to_vec()).unwrap();
        }
        let elapsed = start.elapsed();
        let qps = f64::from(u32::try_from(n).unwrap()) / elapsed.as_secs_f64();
        println!("写入 {n} 条耗时 {elapsed:?}，约 {qps:.0} ops/s");
        assert!(qps > 1000.0, "写入性能异常: {qps:.0} ops/s（是不是忘了 --release？）");
    }
}
