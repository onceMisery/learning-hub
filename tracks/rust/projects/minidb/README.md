# minidb

一个用 Rust 写的 Bitcask 风格嵌入式 KV 存储引擎，**面向 Java 开发者的 Rust 实战教程项目**。

它不是一个玩具：有 WAL 持久化、崩溃恢复、多段滚动、垃圾回收（compaction）、CRC 校验、目录锁、并发读写安全、以及同步/异步两种 TCP 服务器。完整讲解见 [`00-总览与环境.md`](00-总览与环境.md)（按模块划分，共 9 篇），代码注释里解释了「为什么这样写」而不是「这行语法是什么」。

```bash
cargo test                      # 45 个测试全绿（39 单元 + 6 集成，另有 1 个 #[ignore] 性能冒烟）
cargo clippy --all-targets      # 官方 lint
```

---

## 快速开始

```bash
# 单命令模式
cargo run --bin minidb-cli -- --dir ./data --exec "SET name minidb"
cargo run --bin minidb-cli -- --dir ./data --exec "GET name"
# => $6
# => minidb

# 交互模式
cargo run --bin minidb-cli -- --dir ./data
minidb> SET user:1 alice
+OK
minidb> KEYS user:
*1
$7
user:1
minidb> QUIT

# 异步 TCP 服务器
cargo run --bin minidb-server -- --dir ./data --addr 127.0.0.1:6379
# 另开终端：printf 'SET a 1\r\nGET a\r\n' | nc 127.0.0.1 6379

# 单文件最小版（约 200 行、只依赖标准库，带自验证 demo）
cargo run --example mini_kv
# 也可以脱离 cargo：rustc examples/mini_kv.rs -o mini_kv && ./mini_kv
```

---

## 为什么选这个项目

写 KV 存储引擎能同时命中 Rust 的全部核心优势，而 CRUD Web 服务或 CLI 工具只能练到其中一部分：

| Rust 优势 | 在 minidb 里的体现 |
|-----------|-------------------|
| 无 GC 的确定性延迟 | 没有 Stop-The-World，P99 不会因为 Full GC 抖动 |
| 所有权管理资源 | 文件句柄、锁、段文件由 `Drop` 释放，**不可能泄漏** |
| 借用检查器 | "拿着 `get()` 的返回值去 `put()`" → 编译失败，而不是线上的 `ConcurrentModificationException` |
| 零成本抽象 | `Iterator` 组合被内联成裸循环；`Option<&T>` 和 `&T` 一样大 |
| 编译期并发证明 | `Send`/`Sync` 让"这个对象能不能跨线程用"由编译器回答 |
| RAII 收尾 | `close(self)` 消费所有权，关闭后无法再用，比 `IllegalStateException` 更早发现问题 |

---

## 按模块精讲（9 篇）

每篇独立成文，讲清「要解决什么问题 → 设计权衡 → 数据结构 → 代码路径 → 边界/坑/性能 → 可运行验证」：

| 篇 | 主题 | 主要源码 |
|----|------|---------|
| [00](00-总览与环境.md) | 总览与环境 | — |
| [01](01-实例与启动.md) | 数据库实例与启动流程 | `src/engine.rs`、`src/stage6_compact.rs`（`open`） |
| [02](02-文件格式与落盘.md) | 数据文件格式与落盘策略 | `src/stage5_wal.rs` |
| [03](03-索引与查询.md) | 索引构建与查询路径 | `src/stage6_compact.rs`、`src/stage4_traits.rs` |
| [04](04-删除与合并压缩.md) | 删除（墓碑）与合并压缩 | `src/stage6_compact.rs`（`compact`） |
| [05](05-崩溃恢复.md) | 崩溃恢复 | `src/stage6_compact.rs`（重放/截断）、`src/error.rs` |
| [06](06-并发与事务控制.md) | 并发与事务控制 | `src/stage7_concurrent.rs` |
| [07](07-协议与服务器.md) | 协议与服务器 | `src/stage3_protocol.rs`、`src/stage8_async.rs` |
| [08](08-实验手册与进阶.md) | 实验手册与进阶路线 | `examples/` |

对应的可运行示例（`cargo run --example <name>`）：

| 示例 | 演示什么 |
|------|---------|
| `mini_kv` | 约 200 行、只依赖标准库的完整 Bitcask |
| `frame_format` | 帧的每个字节、CRC 篡改检测、尾部截断 |
| `gc_demo` | 垃圾增长、删除变大、合并回收 99.2% |
| `recovery_demo` | 5 种坏磁盘状态的恢复结果 |
| `concurrency_demo` | 丢失更新（丢 86.5%）与单键原子性 |

每个阶段（stage）都能单独运行：

```bash
cargo test --lib stage5              # 只跑阶段 5
cargo run --bin minidb-cli -- --exec "PING"
```

---

## 架构

```
┌────────────────────────────────────────────────┐
│ 接入层   stage7 (线程) / stage8 (tokio)        │  ≈ Controller
├────────────────────────────────────────────────┤
│ 协议层   stage3_protocol                       │  ≈ DTO + Validator
├────────────────────────────────────────────────┤
│ 引擎层   engine.rs  apply()/apply_read()       │  ≈ Service
├────────────────────────────────────────────────┤
│ 抽象层   stage4_traits (trait KvStore)         │  ≈ Repository
├────────────────────────────────────────────────┤
│ 存储层   stage5_wal / stage6_compact           │  ≈ DAO
└────────────────────────────────────────────────┘
```

**没有 DI 容器** —— 依赖靠构造函数显式传入，依赖图一眼可见。这是 Rust 项目的普遍选择。

数据布局：

```
minidb-data/
├── LOCK                 进程互斥（create_new 原子创建）
├── manifest.json        段清单（serde），rename 原子更新
├── 000000001.log        已冻结的只读段
└── 000000002.log   ←   活跃段（唯一可写）
```

---

## Cargo vs Maven 速查

| Maven | Cargo |
|-------|-------|
| `pom.xml` | `Cargo.toml` |
| `mvn test` | `cargo test` |
| `mvn package` | `cargo build --release` |
| `mvn verify`（SpotBugs/Checkstyle） | `cargo clippy -- -D warnings` |
| `mvn site`（javadoc） | `cargo doc --open` |
| `mvn dependency:tree` | `cargo tree` |
| `<scope>test</scope>` | `[dev-dependencies]` |
| JUnit `@Test` | `#[test]` |
| JUnit `@TempDir` | `tempfile::TempDir` |

---

## 这个项目里真实踩过的坑

写代码过程中实际遇到并修复的问题，都留在注释里当反面教材：

1. **`BufWriter` 与随机读不兼容** —— 活跃段同时被 append 写和按 offset 读，加了缓冲就读不到刚写的数据。修复：活跃段直接用 `File`，缓冲交给 OS page cache。（Java 里同样的坑是 `BufferedWriter` 混用 `RandomAccessFile`）
2. **`File::try_clone()` 共享文件游标** —— `dup` 出来的句柄**不是**独立的偏移量，多线程 seek 会互相踩，表现为随机的「魔数不匹配」。修复：改用位置读取 `read_at` / `seek_read`（跨平台 `#[cfg]` 分发）。
3. **Windows 上 `set_len` 需要写句柄** —— 恢复时截断损坏尾部，只读句柄会被拒（Linux 不报错）。
4. **Windows 上不能删除仍打开的文件** —— 锁文件要先 `take()` 关闭句柄再删。
5. **compaction 前忘记 fsync** —— 索引里的 offset 指向的数据还在缓冲区里，读出来会被误判成损坏。

---

## 常用命令

```bash
cargo check                            # 只做类型检查，最快
cargo test --lib stage7                # 单模块测试
cargo clippy --all-targets             # lint
cargo fmt                              # 格式化
cargo doc --open                       # 生成本项目文档
cargo test --release -- --ignored      # 性能冒烟测试（务必 release）
RUST_LOG=debug cargo run --bin minidb-server
RUST_BACKTRACE=1 cargo test
```

---

## 延伸方向

- TTL / 过期键（改帧格式加时间戳，读时惰性删除）
- LSM-Tree 化（把哈希索引换成 SSTable，支持范围查询）
- mmap 读路径（`memmap2` 消除系统调用和拷贝）
- 零拷贝值（`bytes::Bytes` 引用计数切片）
- 完整 RESP 协议（让 `redis-cli` 直连）
- 组提交（group commit）：把 N 次 fsync 合并成 1 次

许可证：MIT
