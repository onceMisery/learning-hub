//! # minidb —— 写给 Java 开发者的 Rust 实战项目
//!
//! 一个 Bitcask 风格的嵌入式 KV 存储引擎。整个项目按 9 个阶段递进，
//! 每个阶段聚焦一组 Rust 核心特性，并给出 Java 对应概念。
//!
//! ## 模块地图（按学习顺序）
//!
//! | 阶段 | 模块 | Rust 主题 | Java 对照 |
//! |------|------|-----------|-----------|
//! | 1 | [`error`] | `Result`/`?`/thiserror | 异常体系、`throws`、`getCause` |
//! | 2 | [`stage2_inmem`] | 所有权、借用、生命周期 | GC 引用、`Map.get`、CME |
//! | 3 | [`stage3_protocol`] | enum、模式匹配、Option | sealed interface、record、null |
//! | 4 | [`stage4_traits`] | trait、泛型、静态/动态分发 | interface、泛型擦除、动态代理 |
//! | 5 | [`stage5_wal`] | Drop/RAII、BufIO、serde | try-with-resources、Jackson |
//! | 6 | [`stage6_compact`] | 迭代器、恢复、原子替换 | 迭代器、`Files.move`、WAL 重放 |
//! | 7 | [`stage7_concurrent`] | `Arc`/`RwLock`/`Send`/`Sync` | `synchronized`、`ReadWriteLock` |
//! | 8 | [`stage8_async`] | async/await、tokio、Actor | `ExecutorService`、虚拟线程、Akka |
//! | 9 | [`engine`] | 整合、零拷贝、clippy | 性能调优、JMH |
//!
//! ## 与 Maven 项目的结构对照
//!
//! ```text
//! Java (Maven)                     Rust (Cargo)
//! ─────────────────────────────    ─────────────────────────────
//! pom.xml                          Cargo.toml
//! src/main/java/...                src/            （lib.rs 是模块树根）
//! src/test/java/...                src/** 里的 #[cfg(test)] + tests/
//! target/classes                   target/debug, target/release
//! mvn test                         cargo test
//! mvn package                      cargo build --release
//! mvn verify (spotbugs/checkstyle) cargo clippy -- -D warnings
//! mvn site (javadoc)               cargo doc --open
//! ```
//!
//! 最大的区别：**Rust 没有"包 = 目录"的强制关系**。
//! `src/lib.rs` 里写 `mod stage2_inmem;` 才存在这个模块，
//! 文件放错位置或忘了 `mod` 声明，代码就像不存在一样——这是新手最常见的困惑。

pub mod engine;
pub mod error;
pub mod stage2_inmem;
pub mod stage3_protocol;
pub mod stage4_traits;
pub mod stage5_wal;
pub mod stage6_compact;
pub mod stage7_concurrent;
pub mod stage8_async;

/// 重导出常用类型，方便使用方 `use minidb::prelude::*`。
/// ≈ Java 里一个 package 的 facade 类；Rust 里更常见的是直接 `use` 具体模块，
/// prelude 只在类型特别多时用。
pub mod prelude {
    pub use crate::engine::{apply, apply_read, Engine};
    pub use crate::error::{KvError, Result};
    pub use crate::stage3_protocol::{Command, Response};
    pub use crate::stage4_traits::KvStore;
}
