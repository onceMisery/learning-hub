# minidb —— 从 0 到 1 构建一个 Rust KV 存储引擎

> **面向有 Java 后端经验的开发者。** 跟着本文从 `cargo new` 开始，一步步写出一个能落盘、能崩溃恢复、能并发读写、能对外提供 TCP 服务的 Bitcask 风格存储引擎。
>
> 文中每一行关键代码都来自 `tracks/rust/projects/minidb`，`cargo test` 全绿（39 个单元测试 + 6 个集成测试 + 1 个被 `#[ignore]` 标记的性能测试）。

---

## 0. 读我：你会做出什么，以及怎么读

### 0.1 这不是一份代码导读

很多教程的写法是"先贴完整代码，再逐段解释"。那种写法读起来很顺，但合上页面你什么也不会写——因为你没有经历过**那些代码是被什么错误逼出来的**。

这份文档的写法不同：它按**真实的开发顺序**组织。每一章都会先给你一个"这一阶段要交付什么"的目标，再带你把代码敲出来，然后**故意撞上编译器**、读一遍报错、修复它。你在源码里看到的那些看似啰嗦的注释，大多是这个过程中留下的"案发现场"。

### 0.2 最终你会拥有什么

一个约 2000 行、零 `unsafe`、无 GC 的嵌入式 KV 存储引擎：

| 能力 | 落地位置 |
|------|----------|
| `SET / GET / DEL / EXISTS / KEYS / PING / COMPACT` 命令 | `src/stage3_protocol.rs` |
| append-only WAL 持久化 + 崩溃恢复（半包截断、CRC 校验） | `src/stage5_wal.rs` |
| 多段（segment）滚动 + 段合并（compaction） | `src/stage6_compact.rs` |
| 目录锁、manifest 原子更新 | `src/stage6_compact.rs` |
| 多线程并发读写安全 | `src/stage7_concurrent.rs` |
| 同步线程版 + tokio 异步版两种 TCP 服务器 | `src/stage7_concurrent.rs`、`src/stage8_async.rs` |
| 统计指标、配置、CLI、REPL | `src/engine.rs`、`src/bin/` |

跑起来的样子：

```bash
$ cargo run --bin minidb-cli -- --dir ./data --exec "SET name minidb"
+OK
$ cargo run --bin minidb-cli -- --dir ./data --exec "GET name"
$6
minidb
```

### 0.3 三种读法

| 你的情况 | 建议路径 |
|----------|----------|
| **想真正动手**（推荐，约 2~3 个晚上） | 从第 2 章开始，每章都跟着敲。敲完一章跑一次 `cargo test --lib stageN`，看到绿的再往下走 |
| **只想理解 Rust 和 Java 的差异** | 跳到第 4 章看全局，然后按你关心的主题挑第 5~11 章读，每章的"Java 对照"小节是为你写的 |
| **已经在写 Rust，想看工程实践** | 直接看第 8、9 章（WAL / 崩溃恢复 / 合并）和第 13 章（调试与陷阱） |

### 0.4 每一章的固定结构

从第 3 章开始，每章都按这个顺序展开，你可以按需跳读：

1. **目标与验收标准** —— 这一阶段做完，你能跑通什么命令、看到什么输出
2. **涉及文件** —— 该改/该读哪些文件
3. **设计思路** —— 为什么这样设计， alternatives 为什么被否掉
4. **代码** —— 关键实现（可直接使用）
5. **Java 对照** —— 你熟悉的写法在 Rust 里长什么样
6. **编译器会教你的事** —— 真实报错文本 + 修复方法
7. **验证** —— 命令 + 期望输出
8. **练习** —— 1~2 个小改动 + 1 个延伸思考

### 0.5 前置要求

- 会写 Java（看得懂 `Map` / `interface` / `ExecutorService` / `try-with-resources` 即可）
- 会命令行
- **不需要任何 Rust 经验** —— 但第 5 章之后会默认你已经消化了前面几章的所有权概念

### 0.6 文中的约定

| 约定 | 含义 |
|------|------|
| `$ cargo xxx` | 在项目根目录（有 `Cargo.toml` 的那层）执行 |
| `src/stage5_wal.rs` | 相对项目根目录的路径 |
| `❌` 代码块 | 编译不过 / 有 bug 的反面教材，**不要抄** |
| `✅` 代码块 | 正确写法 |
| `≈` | "在 Java 世界里大致等价于"，不是严格相等 |

---

## 1. 项目背景与目标定位

### 1.1 为什么选 KV 存储引擎，而不是 Todo API

学一门新语言时，选什么项目几乎决定了你能学到多少。三个常见候选：

| 候选 | 能练到的东西 | 为什么不是最优 |
|------|-------------|---------------|
| Todo HTTP API（axum） | async、serde、错误处理、测试 | 逻辑被框架吃掉大半；Java 用 Spring Boot 半小时写完，体会不到 Rust 的差异化价值 |
| CLI 工具 | clap、错误处理、迭代器 | 规模太小，练不到并发、生命周期、资源管理这些真正的难点 |
| **KV 存储引擎（Bitcask）** | 所有权/借用、生命周期、Drop/RAII、enum/模式匹配、trait/泛型、Send/Sync、无 GC 的确定性延迟、零成本抽象 | —— |

写 KV 引擎会**逼**你直面 Rust 独有的东西，而前两个项目你可以用"写 Java 的方式"糊弄过去：

1. **没有 GC 也能不泄漏** —— 文件句柄、缓冲区、段文件由 `Drop` 管理，编译期保证释放。Java 要靠 `try-with-resources` 和 `Cleaner`，还可能漏。
2. **借用检查器的价值看得见** —— "拿着 `map.get()` 的返回值去 `map.put()`"，Java 里可能抛 `ConcurrentModificationException`（运行期事故），Rust 直接编译失败。
3. **不可变默认 + 编译期并发证明** —— `Send`/`Sync` 让"这个对象能不能跨线程用"从靠 Code Review 变成靠编译器。
4. **零成本抽象可量化** —— `impl Iterator` 组合后被内联成裸循环；`Option<&T>` 和 `&T` 一样大。这些能在具体引擎里 benchmark 出来。
5. **延迟可预测** —— 没有 GC 停顿，P99 不会因为 Full GC 抖一下。这恰恰是 Java 写存储/中间件时最痛的点。

反过来看 Java 侧：想用 Java 写同样的东西，你会不断撞上——堆外内存要靠 `ByteBuffer`/`Unsafe` 手动管、`finalize()` 释放时机不确定、`Optional` 本身还可能是 `null`、`ConcurrentHashMap` 的正确性靠约定。

### 1.2 Bitcask 是什么

Bitcask 是 Basho 为 Riak 设计的存储引擎，核心思想简单到令人发指：

> **磁盘上只做 append-only 日志追加；内存里只有一个「键 → 记录偏移」的哈希索引。**

由此得到四条性质：

- **写永远是最快的顺序 append** —— 磁盘顺序写吞吐接近内存随机写
- **随机读 = 一次 seek + 一次顺序读** —— 索引告诉你去哪儿读，不需要扫盘
- **重启时索引丢了无所谓** —— 重放日志就能重建，所以索引根本不用落盘
- **删除/更新的旧记录变成垃圾** —— 靠后台 compaction 回收

代价也很明确：内存必须装得下全部 key，且哈希索引**不支持范围查询**。这两条决定了 Bitcask 适合"key 空间可控、读多写多、不需要范围扫描"的场景（Riak 就是这么用的）。

### 1.3 功能边界：明确不做什么，也是设计的一部分

**做：**

- `SET / GET / DEL / EXISTS / KEYS <prefix> / PING / COMPACT`
- append-only WAL + 崩溃恢复（半包截断、CRC32 校验）
- 多段滚动 + 段合并
- 多线程并发读写安全
- TCP 服务器：同步线程版 + tokio 异步版
- 统计指标、持久化的 manifest

**不做**（每一条都是另一个 300+ 行的主题，列出来当作你的延伸方向）：

- 事务与 MVCC、SQL 解析层
- LSM-Tree / B+Tree（哈希索引不支持范围查询）
- 主从复制、分片、租约
- TTL（第 14 章给了实现思路）
- 压缩（snappy / lz4）

> 明确边界不是偷懒。教学项目最大的失败模式是"什么都想做，最后一件事也没讲透"。

### 1.4 学完你能带走什么

| 能力 | 对应章节 |
|------|----------|
| 用 `Cargo.toml` 组织一个真实工程（依赖、profile、lint 门禁） | 2 |
| 用 `Result` + `thiserror` 搭一套可维护的错误体系 | 3 |
| 读懂借用检查器的报错，并知道四种标准修复手法 | 5 |
| 用 `enum` 建模领域概念，让非法状态无法表示 | 6 |
| 用 `trait` 做抽象，并知道何时用静态分发、何时用 `dyn` | 7 |
| 手写二进制帧格式、位置读取、CRC 校验 | 8 |
| 设计崩溃安全的文件操作流程（临时文件 + rename + 截断） | 9 |
| 用 `Arc<RwLock<T>>` 和 `Send`/`Sync` 写并发安全的代码 | 10 |
| 用 tokio + Actor 模式写异步服务，避开阻塞 reactor 的坑 | 11 |
| 用 `#[ignore]` 冒烟测试守住性能底线 | 12 |

### 1.5 全局对照表：这个项目里的 Java → Rust 映射

整份文档会反复用到这张表，先放在这里当索引：

| 关注点 | Java / JVM | Rust / Cargo |
|--------|-----------|--------------|
| 构建文件 | `pom.xml` | `Cargo.toml` |
| 依赖锁定 | 不锁定（靠 `<dependencyManagement>`） | `Cargo.lock`（二进制项目必须提交） |
| 包/模块 | 目录即包 | 目录不是模块，`mod` 必须显式声明 |
| 可见性 | 默认 package-private，常写 `public` | 默认私有，显式 `pub` |
| 错误处理 | 异常、`throws`、`getCause` | `Result<T,E>`、`?`、`source()` |
| 空值 | `null` / `Optional<T>` | `Option<T>`（enum，零额外开销） |
| 抽象 | `interface`，永远动态分发 | `trait`，默认静态分发 |
| 泛型 | 类型擦除，不能是 primitive | 单态化，可以是 `u64` |
| 资源管理 | `try-with-resources` / `finally` | `Drop`（RAII），忘记不了 |
| 并发容器 | `ConcurrentHashMap` | `Arc<RwLock<HashMap>>` / `DashMap` |
| 线程安全 | `@ThreadSafe`（约定） | `Send` / `Sync`（编译期证明） |
| 异步 | JDK 自带 `ExecutorService`、虚拟线程 | 标准库**没有**运行时，需选 tokio 等 |
| 序列化 | Jackson（反射） | serde（编译期生成，无反射） |
| 测试 | JUnit + Mockito | `#[test]` + `#[cfg(test)]`，手写 stub 通常够用 |
| 性能基准 | JMH | `criterion`（或 `#[ignore]` 冒烟测试） |
| 指标 | Micrometer | 原子计数器 / `metrics` crate |
| 文档 | Javadoc（`@param` `@return`） | rustdoc（`///`，支持 doctest） |

---

## 2. 环境搭建与依赖说明

这一章不写业务代码，但**别跳过**——Rust 的工具链和 Java 有本质区别，理解它后面会省很多时间。

### 2.1 安装 rustup

Rust 没有"JDK 安装包"这种东西，官方的分发方式是 `rustup`（工具链管理器）。它同时管：编译器版本、标准库源码、以及 `cargo` / `rustfmt` / `clippy` 这些组件。

**macOS / Linux：**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# 装完重新加载 PATH，或重开终端
source "$HOME/.cargo/env"
```

**Windows（推荐）：**

```powershell
winget install Rustlang.Rustup
# 或者去 https://rustup.rs 下载 rustup-init.exe
```

> **Windows 用户必看**：Rust 在 Windows 上默认使用 MSVC 工具链，需要 **Microsoft C++ 生成工具（link.exe）**。
> 如果你没装过 Visual Studio，rustup 安装器会提示你安装 "Microsoft C++ Build Tools"，勾选即可（约 4 GB）。
> 装完必须**重开终端**，否则 `link.exe` 不在 PATH 里，报错是 `linker 'link.exe' not found`。

**验证：**

```bash
$ rustc --version
rustc 1.98.1 (48a229cea 2026-09-01)
$ cargo --version
cargo 1.98.1 (797e8a9bc 2026-08-05)
$ rustup --version
```

三个都要有。本项目 MSRV（最低支持版本）是 **1.75**，你只要不低于它就能编译。

### 2.2 工具链里都有什么

| 组件 | 作用 | Java 对照 |
|------|------|-----------|
| `rustc` | 编译器 | `javac` |
| `cargo` | 构建 + 包管理 + 测试 + 文档，一个命令全包 | Maven + Gradle + JUnit runner |
| `rustfmt` | 官方格式化（`cargo fmt`） | google-java-format，但**只有一种风格**，没有争论 |
| `clippy` | 官方 lint（`cargo clippy`） | SpotBugs + ErrorProne，约 700 条规则 |
| `rust-analyzer` | LSP 语言服务（编辑器插件） | IntelliJ 的 Java 支持 |
| `rustup` | 工具链版本管理 | SDKMAN! / jEnv |

**常用 rustup 命令：**

```bash
rustup update                    # 升级工具链
rustup toolchain list
rustup component add clippy rustfmt llvm-tools
rustup show                      # 当前生效的工具链
```

### 2.3 版本与 edition

`Cargo.toml` 里有两个版本概念，别混淆：

```toml
edition = "2021"      # 语言"版本"：决定语法和保留字，一个大版本内向后兼容
rust-version = "1.75" # MSRV：最低编译器版本，等价于 Maven 的 maven.compiler.release
```

- **edition** 目前有 2015 / 2018 / 2021 / 2024 四代。2024 edition 随 Rust 1.85 稳定。本项目用 2021，兼容性最好。
- edition 之间可以互操作（2021 的 crate 能依赖 2024 的 crate），这和 Java 的 `--release` 完全不同。
- **`rust-version` 是给 cargo 看的**：如果依赖要求更高的 MSRV，cargo 会明确报错而不是让你编译到一半失败。

### 2.4 编辑器

**VS Code + rust-analyzer** 是目前体验最好的组合：

```bash
code --install-extension rust-lang.rust-analyzer
```

推荐的 `settings.json`：

```jsonc
{
  // 保存时自动格式化（团队统一风格的最强手段）
  "editor.formatOnSave": true,
  "[rust]": {
    "editor.defaultFormatter": "rust-lang.rust-analyzer",
    "editor.formatOnSave": true
  },
  // 把 clippy 作为 check 的后端，写代码时就能看到 lint
  "rust-analyzer.check.command": "clippy",
  // 显示函数的 inferred 类型（学 Rust 早期非常有用）
  "rust-analyzer.inlayHints.typeHints.enable": true,
  "rust-analyzer.inlayHints.chainingHints.enable": true
}
```

用 IntelliJ IDEA 的话装 **Rust 插件**（JetBrains 官方），功能接近 rust-analyzer，但索引大项目时更吃内存。

> **初学者的一个忠告**：开 `rust-analyzer` 的 inlay hints，你会看到编译器推导出的每一个类型。这是理解生命周期和泛型最快的路径。

### 2.5 Cargo 命令速查

| 命令 | 作用 | Java 对照 |
|------|------|-----------|
| `cargo check` | 只做类型检查，**最快**，日常首选 | `mvn compile` 的检查部分 |
| `cargo build` | 编译（debug） | `mvn compile` |
| `cargo build --release` | 编译（优化版） | `mvn package` |
| `cargo test` | 跑全部测试 | `mvn test` |
| `cargo test --lib stage5` | 只跑名字含 `stage5` 的测试 | `mvn test -Dtest=XxxTest` |
| `cargo run --bin minidb-cli -- --exec "PING"` | 运行并把参数传给程序 | `mvn exec:java -Dexec.args=...` |
| `cargo clippy --all-targets` | lint（含测试和示例） | `mvn verify` |
| `cargo fmt` | 格式化 | `mvn spotless:apply` |
| `cargo doc --open` | 生成并打开本项目文档 | `mvn javadoc:javadoc` |
| `cargo tree` | 依赖树 | `mvn dependency:tree` |
| `cargo update` | 更新 `Cargo.lock` | （Maven 没有对应物） |
| `cargo add serde --features derive` | 加依赖 | 手动编辑 pom.xml |
| `cargo bench` | 跑基准测试 | JMH |

> `--` 很重要：`cargo run -- --exec "PING"` 中，`--` 之后的参数是传给你的程序的，不是给 cargo 的。这是 Java 开发者最常敲错的地方之一。

### 2.6 依赖逐个说明

本项目的 `[dependencies]` 只有 7 个直接依赖，每一个都有明确理由：

```toml
[dependencies]
serde      = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror  = "2"
clap       = { version = "4", features = ["derive"] }
tokio      = { version = "1", features = ["rt-multi-thread", "net", "io-util", "sync", "macros", "time", "signal"] }
log        = "0.4"
env_logger = "0.11"

[dev-dependencies]
tempfile = "3"
```

**`serde` + `serde_json`（序列化）**

- ≈ Jackson / Gson，但**通过 derive 宏在编译期生成代码**，运行期没有反射，也没有 `setAccessible` 那类开销。
- `features = ["derive"]` 才启用 `#[derive(Serialize, Deserialize)]`。
- 本项目只在**冷路径**用它：manifest.json、WAL 的调试 dump。热路径（WAL 帧）是手写二进制。
- 想换？`bincode`（更小更快）、`rkyv`（零拷贝反序列化）。

**`thiserror`（错误类型派生）**

- ≈ 手写 `BusinessException` 继承树 + SLF4J 格式化，但 `#[derive(Error)]` 帮你生成 `Display` 和 `source()` 链（≈ `getCause`）。
- 只在**库**里用。应用层（bin）为了省事通常用 `anyhow`。分界线见第 13 章。

**`clap`（CLI 参数解析）**

- ≈ picocli，通过 derive 宏从结构体生成解析器。
- `features = ["derive"]` 才能 `#[derive(Parser)]`。
- 代价：编译时间 +若干秒。命令行工具值得，库里一般不要引。

**`tokio`（异步运行时）**

- ≈ `ExecutorService` + `CompletableFuture`，但 **Rust 标准库不带运行时**，必须由你选择。这是 Java 开发者最容易踩的坑（详见第 11 章）。
- 注意 `features` 列表：**只开启用到的**。写 `features = ["full"]` 会让编译时间显著变长——这相当于 Maven 里不用 `<exclusions>` 而把整个生态拉进来。
- 本项目需要：`rt-multi-thread`（多线程调度器）、`net`（TcpListener/TcpStream）、`io-util`（AsyncRead/AsyncWrite）、`sync`（mpsc/oneshot）、`macros`（`#[tokio::main]`）、`time`、`signal`（ctrl_c）。

**`log` + `env_logger`（日志）**

- `log` 是**门面**（≈ SLF4J），`env_logger` 是一个实现（≈ logback）。
- 关键约定：**库只依赖 `log`，由二进制决定具体实现**。所以 `env_logger` 只在 `src/bin/` 里 `init()`。
- 用 `RUST_LOG=debug cargo run ...` 控制级别，不需要改代码重启。

**`tempfile`（dev-dependency，仅测试用）**

- ≈ JUnit 的 `@TempDir`。标准库没有，生态里是事实标准。
- 放 `[dev-dependencies]` 意味着只有测试/示例能用到，不会进最终产物。

### 2.7 Cargo.toml 逐段精读

```toml
[package]
name = "minidb"
version = "0.1.0"
edition = "2021"
rust-version = "1.75"
```

**`[[bin]]` —— 多个可执行文件**

```toml
[[bin]]
name = "minidb-cli"
path = "src/bin/minidb-cli.rs"

[[bin]]
name = "minidb-server"
path = "src/bin/minidb-server.rs"
```

≈ `exec-maven-plugin` 的 `mainClass` 配置。Cargo 的约定是 `src/bin/*.rs` 自动成为可执行文件，这里显式声明只是为了单独取名（否则二进制名会是 `minidb_cli`）。

**`[profile.release]` —— 性能优化开关**

```toml
[profile.release]
lto = true
codegen-units = 1
panic = "abort"
```

- `lto = true`：链接期优化，跨 crate 内联
- `codegen-units = 1`：牺牲并行编译换更好的优化
- `panic = "abort"`：panic 直接终止进程而不是 unwind。生产服务常用——避免"半死不活"的状态

> Maven 里没有对应物，因为 JVM 的优化靠 JIT 在运行期做。代价是：**release 构建比 debug 慢很多**（本项目的 LTO 尤其明显），日常开发别用。

**`[lints]` —— 把质量门禁前置到编译期**

```toml
[lints.rust]
unsafe_code  = "forbid"   # 全 crate 禁用 unsafe
missing_docs = "warn"

[lints.clippy]
pedantic            = { level = "warn", priority = -1 }
clone_on_ref_ptr    = "warn"   # 禁止把 clone() 当创可贴
ptr_arg             = "warn"   # 提醒用 &str 而不是 &String
missing_errors_doc  = "allow"  # 有意为之：见下
doc_markdown        = "allow"
missing_panics_doc  = "allow"
```

这相当于把 SpotBugs / Checkstyle 的 `failOnViolation` 写进了构建文件，而不是靠 CI 脚本或 Code Review 约定。`unsafe_code = "forbid"` 尤其值得注意：它保证这个 crate **一行 unsafe 都不会有**。

后面三条 `allow` 是**有意为之**的工程决策，不是偷懒：

- `missing_errors_doc`：本项目所有函数返回同一个 `KvError`，逐个函数重复写 `# Errors` 段落是纯噪音
- `doc_markdown`：中文文档里夹杂大量 Java/Cargo 专有名词（`ReadWriteLock`、`try-with-resources`…），会被误报成"该加反引号的标识符"
- `missing_panics_doc`：`unwrap`/`expect` 只用在"不可能失败"处，且都带了说明文字

> **给读者的建议**：你自己的项目里一开始不要开 `pedantic`，它会一次报几百条，很打击人。先开默认组（`cargo clippy`），等习惯了再加 `pedantic`。

### 2.8 Cargo.lock：和 Maven 相反的习惯

| 项目类型 | 是否提交 `Cargo.lock` | 原因 |
|----------|----------------------|------|
| **二进制**（含本项目） | **必须提交** | 保证任何人 checkout 后编出的是同一个东西 |
| **库** | 通常不提交 | 让下游使用者自己解析版本，避免和他们的依赖冲突 |

这个习惯和 Maven 正好相反：Maven 项目一般不提交"锁定文件"（除非用 `dependencyManagement` 或 Gradle 的 lockfile）。

本项目的 `Cargo.lock` 已提交。你 `cargo build` 时看到的依赖版本和我写文档时完全一致。

### 2.9 常见安装/构建问题

| 症状 | 原因 | 修复 |
|------|------|------|
| `linker 'link.exe' not found`（Windows） | 缺 MSVC 生成工具 | 装 "Microsoft C++ Build Tools"，重开终端 |
| `cargo` 命令找不到 | `~/.cargo/bin` 不在 PATH | `source $HOME/.cargo/env` 或重开终端 |
| 下载 crate 极慢 / 超时 | crates.io 走国际链路 | 配置镜像（见下） |
| `target/` 占了几个 GB | debug 构建产物 + 增量编译缓存 | `cargo clean`（会重新全量编译）；或把 `target` 移到别处 |
| `failed to resolve: use of undeclared crate` | 依赖没加 / 名字拼错 | `cargo add <crate>` |

**国内镜像配置**（`~/.cargo/config.toml`）：

```toml
[source.crates-io]
replace-with = "tuna"

[source.tuna]
registry = "https://mirrors.tuna.tsinghua.edu.cn/git/crates.io-index.git"
```

也可以用 `sparse+https://mirrors.tuna.tsinghua.edu.cn/crates.io-index/`（稀疏索引，更快）。rustup 自己的镜像用环境变量：

```bash
export RUSTUP_DIST_SERVER=https://mirrors.tuna.tsinghua.edu.cn/rustup
export RUSTUP_UPDATE_ROOT=https://mirrors.tuna.tsinghua.edu.cn/rustup/rustup
```

### 2.10 本章验收

```bash
$ rustc --version && cargo --version
$ cargo clippy --version
$ cargo fmt --version
```

三条都有输出，说明环境好了。下一章开始写代码。

---

## 3. 阶段 1：从 0 初始化 —— 工程骨架与错误处理

**目标**：从空目录开始，得到一个能 `cargo run` 的最小工程，并建立起贯穿全项目的错误体系。

**验收标准**：

```bash
$ cargo run --bin minidb-cli -- --dir ./data --exec "PING"
+PONG
$ cargo test --lib error
running 3 tests ... test result: ok. 3 passed
```

### 3.1 涉及文件

```
minidb/
├── Cargo.toml
├── src/
│   ├── lib.rs              ← 模块树根
│   ├── error.rs            ← 本章主战场
│   └── bin/
│       └── minidb-cli.rs   ← 第一个可执行文件
```

### 3.2 第一步：cargo new

```bash
cargo new minidb --lib
cd minidb
```

`--lib` 表示"这是一个库"（会生成 `src/lib.rs` 而不是 `src/main.rs`）。一个 crate 可以**同时**有库和多个二进制——这是 Rust 项目的常见布局：核心逻辑在库里，二进制只是薄薄的入口。

生成的 `src/lib.rs`：

```rust
pub fn add(left: u64, right: u64) -> u64 {
    left + right
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        let result = add(2, 2);
        assert_eq!(result, 4);
    }
}
```

**注意最后那个 `#[cfg(test)] mod tests`**：Rust 的单元测试**写在源码文件里**。这是和 Java 最大的组织差异之一。

| | Java | Rust |
|--|------|------|
| 单元测试 | `src/test/java/...`，独立目录 | 源码文件里的 `#[cfg(test)] mod tests`，**能访问私有成员** |
| 集成测试 | 也是 `src/test/java/` | `tests/*.rs`，只能访问 `pub` API |

好处是测试就在被测代码旁边，改代码时不会忘记改测试；`#[cfg(test)]` 保证这部分代码不会进发布产物。

### 3.3 模块树：`mod` 必须显式声明

清空 `src/lib.rs`，写：

```rust
//! # minidb —— 写给 Java 开发者的 Rust 实战项目
//!
//! 一个 Bitcask 风格的嵌入式 KV 存储引擎。

pub mod error;
```

**这是新手最常问的问题**：把 `error.rs` 放进 `src/` 之后，它是**不存在的**——必须在 `lib.rs`（或父模块）里写 `mod error;` 才生效。

- `//!` 是**模块文档**（描述整个文件），`///` 是**项文档**（描述下面那个 struct/fn）
- `pub mod` 表示对外可见；只写 `mod` 则仅 crate 内部可见

对照 Java 的心智模型：

```
Java:  目录 = 包，文件 = 类，import 即可用
Rust:  文件 ≠ 模块，mod 声明才创建模块，use 只是"缩短路径"的语法糖
```

另一个关键差异：**可见性默认是私有的**。字段和方法不加 `pub` 就只在当前模块可见（≈ package-private）。Java 里忘记写 `private` 是"对外可见"，Rust 正好反过来。

### 3.4 错误体系：`Result` 与 `thiserror`

Java 用 `throw` + 异常继承树，错误在**运行期**沿调用栈往上冒。Rust 把错误放进**类型系统**：`Result<T, E>` 就是一个普通的 enum，写在函数签名里，编译器看得见。

新建 `src/error.rs`：

```rust
use std::io;
use thiserror::Error;

/// minidb 的顶层错误类型。
#[derive(Debug, Error)]
pub enum KvError {
    /// 磁盘 / 网络 I/O 失败。
    #[error("I/O 失败: {0}")]
    Io(#[from] io::Error),

    /// 键不存在（业务上的正常分支，不是"异常"）。
    #[error("键不存在: {key}")]
    KeyNotFound { key: String },

    /// 客户端协议解析失败。
    #[error("协议错误: {0}")]
    Protocol(String),

    /// 数据文件损坏。
    #[error("数据文件损坏: {reason}（已截断到 offset {truncated_at}）")]
    Corrupted { reason: String, truncated_at: u64 },

    /// 存储已关闭。
    #[error("存储已关闭")]
    Closed,

    /// 序列化 / 反序列化失败。
    #[error("序列化失败: {0}")]
    Serialization(#[from] serde_json::Error),
}

/// 项目内统一的 `Result` 别名。
pub type Result<T> = std::result::Result<T, KvError>;
```

**四个值得停下来理解的点：**

**① 为什么用 enum 而不是 trait + 一堆实现类？**

因为调用方可以**穷尽匹配**所有错误变体，编译器会检查。Java 里你只能 `catch (Exception e)` 一把梭，或者漏掉某个子类。

**② 每个变体携带的是结构化数据**

`KeyNotFound { key: String }` 而不是 `Err("key not found: name")`。错误信息是给程序处理的，不是给日志 grep 的。

**③ `#[from]` 是 `?` 能工作的关键**

```rust
#[error("I/O 失败: {0}")]
Io(#[from] io::Error),
```

这一行生成了 `impl From<io::Error> for KvError`。于是：

```rust
fn open() -> Result<File> {
    let f = File::open("x.log")?;   // io::Error 自动转成 KvError
    Ok(f)
}
```

等价于 Java 的：

```java
try {
    return new FileInputStream("x.log");
} catch (IOException e) {
    throw new KvException(e);   // 只不过 Rust 这段是编译期生成的
}
```

而且 `thiserror` 还会自动把被包装的错误接进 `source()` 链，所以 `std::error::Error::source(&err)` 能拿到原始 `io::Error`。Java 里这需要你手写 `super(message, cause)`，忘了就断链。

**④ `Result<T>` 别名**

`Result<Vec<u8>>` 比 `Result<Vec<u8>, KvError>` 短，且以后换错误类型只改一处。几乎所有 Rust 库都会这么做。

### 3.5 第一个二进制：CLI

新建 `src/bin/minidb-cli.rs`：

**注意**：阶段 1 还没有存储引擎（那是第 8、9 章的事），所以这个 CLI 只做一件事——演示"错误怎么从最底层一路传到 `main` 并变成退出码"。第 12 章我们会把它长成完整形态。

```rust
use std::path::PathBuf;

use clap::Parser;
use minidb::error::{KvError, Result};

#[derive(Debug, Parser)]
#[command(name = "minidb", version, about = "Bitcask 风格的嵌入式 KV 存储")]
struct Cli {
    /// 数据目录
    #[arg(long, default_value = "./minidb-data")]
    dir: PathBuf,

    /// 执行一次命令后退出，例如：--exec "PING"
    #[arg(long)]
    exec: Option<String>,
}

fn main() -> Result<()> {
    env_logger::init();

    let cli = Cli::parse();
    // 这一行的 `?`：io::Error 通过 #[from] 自动变成 KvError
    std::fs::create_dir_all(&cli.dir)?;

    match cli.exec.as_deref() {
        Some("PING") | None => println!("+PONG"),
        // 协议错误回给客户端，而不是让进程崩溃
        Some(other) => return Err(KvError::Protocol(format!("未知命令: {other}"))),
    }
    Ok(())
}
```

几个 Java 开发者会眼前一亮的点：

- **`fn main() -> Result<()>`**：`main` 也能返回 `Result`。返回 `Err` 时 Rust 会自动打印 `Error: <Display>` 并以退出码 1 退出——不用写 `try/catch`，也不用 `System.exit(1)`。
- **`#[derive(Parser)]`**：从结构体生成参数解析器，零反射。文档注释（`/// 数据目录`）直接变成 `--help` 里的说明文字。
- **`PathBuf` 而不是 `String`**：路径就是路径，别用字符串表示。
- **`as_deref()`**：把 `Option<String>` 变成 `Option<&str>`，避免为了匹配而 clone。这是 Rust 里非常常见的"借用转换"小技巧。

> **一个容易卡住的点**：调用 trait 方法前必须把 trait `use` 进来。比如要调用 `engine.get(...)`（来自 `KvStore` trait），就得 `use minidb::stage4_traits::KvStore;`。
> 这比 Java 麻烦，但它消灭了"两个接口都有同名方法、编译器悄悄帮你选了一个"这类问题。

### 3.6 跑起来

```bash
$ cargo build
   Compiling minidb v0.1.0
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 3.21s

$ cargo run --bin minidb-cli -- --dir ./data --exec "PING"
+PONG

$ cargo run --bin minidb-cli -- --dir ./data --exec "SET name minidb"
Error: 协议错误: 未知命令: SET name minidb
$ echo $?
1
```

第二条"失败"是**预期的**——阶段 1 还没实现存储。`Error: ...` 这行是 `main` 返回 `Err` 时 Rust 自动打印的，退出码是 1。

等第 12 章把 `Engine` 接进来之后，同样这条命令会变成：

```bash
$ cargo run --bin minidb-cli -- --dir ./data --exec "SET name minidb"
+OK
$ cargo run --bin minidb-cli -- --dir ./data --exec "GET name"
$6
minidb
```

`GET` 返回两行：`$6` 是值的**字节长度**，`minidb` 是值本身。这是 Redis RESP 协议里的 bulk string 格式——因为值可以是任意二进制（含 `\r\n`），必须用长度前缀界定边界。第 6 章会详细讲。

### 3.7 为错误体系写测试

`Result` 返回值测试是 Rust 的惯用写法——测试函数可以返回 `Result`，内部用 `?`，失败即测试失败，比 `unwrap()` 报得更清楚：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// 演示 `?` 如何自动转换错误类型（Java 的异常链 / cause）。
    #[test]
    fn from_converts_io_error() -> Result<()> {
        let err: KvError = io::Error::new(io::ErrorKind::NotFound, "no such file").into();
        assert!(matches!(err, KvError::Io(_)));
        // source() ≈ getCause()
        assert!(std::error::Error::source(&err).is_some());
        Ok(())
    }

    /// 错误的 Display 是稳定契约（客户端会看到它）。
    #[test]
    fn error_display_is_stable() {
        let e = KvError::KeyNotFound { key: "name".into() };
        assert_eq!(e.to_string(), "键不存在: name");
    }

    /// `?` 在函数内传播错误。
    #[test]
    fn propagate_with_question_mark() -> Result<()> {
        fn inner() -> std::io::Result<()> { Err(io::Error::other("boom")) }
        fn outer() -> Result<()> {
            inner()?;   // io::Error 自动转 KvError，然后提前 return Err
            Ok(())
        }
        assert!(matches!(outer(), Err(KvError::Io(_))));
        Ok(())
    }
}
```

```bash
$ cargo test --lib error
running 3 tests
test error::tests::error_display_is_stable ... ok
test error::tests::from_converts_io_error ... ok
test error::tests::propagate_with_question_mark ... ok
```

### 3.8 Java 对照

| | Java | Rust |
|--|------|------|
| 错误表示 | 异常对象，运行期沿栈上冒 | `Result<T, E>`，普通返回值 |
| 声明 | `throws`（受检）或干脆不写 | 写在签名里，编译器盯着 |
| 转换 | `catch (IOException e) { throw new BizException(e); }` | `#[from]` + 一个 `?` |
| 信息 | 拼进 message 字符串 | 结构化字段，可穷尽匹配 |
| 忘记处理 | 线上报 500 | 编译不过（`#[must_use]`） |
| 错误链 | 手写 `super(msg, cause)` | `source()`，`#[from]` 自动接上 |

### 3.9 练习

1. **体会穷尽性检查**：给 `KvError` 加一个 `KeyTooLong { key: String, max: usize }` 变体，然后 `cargo build`。观察所有 `match kv_error` 的地方如何被编译器揪出来。这是理解"穷尽匹配"最快的方式。
2. 把 `--exec` 改成支持一次执行多条命令（分号分隔），体会迭代器 + `?` 的组合。
3. **延伸思考**：在应用层引入 `anyhow`（`Result<T, anyhow::Error>`），对比"库定 enum、应用用 anyhow"这条分界线为什么合理。

---

## 4. 架构总览、数据布局与九阶段路线图

在继续写代码之前，先把全局看清楚。**带着这张图往下读，否则从第 8 章开始你会迷路。**

### 4.1 分层架构（对照 Spring 三层）

```
┌─────────────────────────────────────────────────────────┐
│  接入层  stage7_concurrent / stage8_async               │  ≈ Controller
│  TcpListener → 每连接一个 Task/Thread → 行协议编解码      │
├─────────────────────────────────────────────────────────┤
│  协议层  stage3_protocol                                │  ≈ DTO + Validator
│  Command / Response enum ↔ 文本行                        │
├─────────────────────────────────────────────────────────┤
│  引擎层  engine.rs                                      │  ≈ Service
│  Engine + apply()/apply_read() + 统计指标               │
├─────────────────────────────────────────────────────────┤
│  抽象层  stage4_traits (trait KvStore)                  │  ≈ Repository 接口
├─────────────────────────────────────────────────────────┤
│  存储层  stage5_wal / stage6_compact                    │  ≈ DAO
│  二进制帧编解码 / 段管理 / 恢复 / 合并                    │
└─────────────────────────────────────────────────────────┘
```

**和 Spring 分层最大的区别**：没有 DI 容器。依赖靠**构造函数显式传入**（`Engine::open(dir)`、`bind_async(addr, handle)`），依赖图在代码里一眼可见。Rust 项目普遍认为"隐式装配"带来的便利抵不上可读性损失。

### 4.2 一次 `SET` 的完整旅程

跟着一条命令走一遍全链路，比看十张图有用：

```
1. 客户端: "SET user:1 alice\r\n"
                    ↓
2. 接入层 handle_conn: 按行读取，拿到一行文本
                    ↓
3. 协议层 Command::parse: 分词 → 匹配 "SET" → Command::Set { key, value }
                    （分词返回 &str 切片，零分配）
                    ↓
4. 引擎层 apply(engine, cmd):
      engine.set(key, value)
                    ↓
5. 存储层 SegmentEngine::set:
      a. 活跃段超过 1 MiB？→ roll()：冻结当前段，开新段
      b. encode_frame(key, Some(value))：拼二进制帧 + CRC32
      c. write_all(&frame)：append 到活跃段
      d. index.insert(key, Location { seg, offset, len })
          旧记录变成垃圾 → dead_bytes += old.len
                    ↓
6. 引擎层 Engine::set 收尾:
      garbage_ratio() >= 0.3 ? → 触发 compact()
                    ↓
7. 回到协议层: Ok(()) → Response::Ok
                    ↓
8. 接入层: writer.write_all("+OK\r\n".as_bytes())
```

**这条链路上有几个设计决策值得注意：**

- **步骤 3 的零分配**：解析时全是 `&str` 切片，只有构造 `Command`（要落盘/跨线程）时才 `to_owned()`
- **步骤 5c 没有用户态缓冲**：活跃段直接用 `File::write_all`，把写入合并交给 OS page cache。原因见第 8 章——这里有个真实踩过的坑
- **步骤 6 的自动合并**：写路径里内联了 GC 判断，所以你不需要手动维护

### 4.3 数据目录布局

```
minidb-data/
├── LOCK                    进程互斥锁（create_new 原子创建）
├── manifest.json           段清单（serde），原子 rename 更新
├── 000000001.log           已冻结的只读段
├── 000000002.log           已冻结的只读段
└── 000000003.log   ← 活跃段（唯一可写）
```

| 文件 | 作用 | 关键性质 |
|------|------|----------|
| `LOCK` | 防止两个进程同时打开同一目录 | `create_new` 是原子的；进程崩溃会残留（生产要用 `fs2` 的 flock） |
| `manifest.json` | 记录哪些段是 frozen、哪个是 active | **先写 tmp 再 rename**，永不出现"写了一半" |
| `NNNNNNNNN.log` | 数据段，append-only | 文件名 9 位数字，保证字典序 = 时间序 |

### 4.4 二进制帧格式

```
┌──────────┬───────────┬───────────┬──────┬───────┬─────────┐
│ magic 4B │ key_len 4B│ val_len 4B│ key  │ value │ crc32 4B│
│ "MDB1"   │ u32 LE    │ u32 LE    │      │       │ u32 LE  │
└──────────┴───────────┴───────────┴──────┴───────┴─────────┘
  定长 12 字节头                              定长 4 字节尾
```

| 字段 | 作用 |
|------|------|
| `magic = "MDB1"` | 快速判断"这里是不是一条合法记录"，≈ class 文件的 `0xCAFEBABE` |
| `key_len` / `val_len` | 变长体的长度（小端 u32） |
| `val_len == u32::MAX` | **哨兵值：表示墓碑（删除标记）**。用哨兵而不是 `Option<u32>`，因为定长帧里放 Option 会浪费字节 |
| `crc32` | 覆盖 header + key + value，检测半截写入和位翻转 |

**为什么不用 JSON 存 WAL？** 100 字节的值用 JSON 数组会膨胀到 300+ 字节，还要每次解析数字。

> **本项目的核心取舍：热路径用手写二进制，调试路径用 serde。**
> `WalEngine::dump()` 会把二进制 WAL 转成人类可读的 JSON，排查问题时 `cat` 一下就行。

### 4.5 索引：Bitcask 的心脏

内存里只有一个映射：

```rust
// 阶段 5（单段）：键 → 文件内偏移
index: HashMap<String, IndexEntry>   // IndexEntry { offset, len }

// 段 6（多段）：键 → 段号 + 段内偏移
index: HashMap<String, Location>     // Location { seg, offset, len }
```

**索引不落盘**。重启时靠重放日志重建——因为重放是纯顺序读，比加载随机写的索引快照更快。这是 Bitcask 最反直觉、也最优雅的一点。

### 4.6 九阶段路线图

| 阶段 | 交付物 | 新学的 Rust 特性 | Java 对照 | 验证命令 |
|------|--------|-----------------|-----------|----------|
| 1 | 工程骨架 + 错误体系 | `Result`、`?`、thiserror | 异常体系、`throws`、`getCause` | `cargo test --lib error` |
| 2 | 内存 KV | 所有权、借用、生命周期 | GC 引用、`Map.get`、CME | `cargo test --lib stage2` |
| 3 | 协议层 | enum、模式匹配、`Option` | sealed interface、record、`null` | `cargo test --lib stage3` |
| 4 | 抽象层 | trait、泛型、静态/动态分发 | interface、泛型擦除、动态代理 | `cargo test --lib stage4` |
| 5 | WAL 持久化 | Drop/RAII、BufIO、serde | try-with-resources、Jackson | `cargo test --lib stage5` |
| 6 | 恢复 + 段合并 | 迭代器、原子替换、崩溃恢复 | `Files.move`、Stream、WAL 重放 | `cargo test --lib stage6` |
| 7 | 并发安全 | `Arc`/`RwLock`/`Send`/`Sync` | `synchronized`、`ReadWriteLock` | `cargo test --lib stage7` |
| 8 | 异步服务器 | async/await、tokio、Actor | `ExecutorService`、虚拟线程、Akka | `cargo test --lib stage8` |
| 9 | 整合 + 性能 | 组合、零拷贝、clippy | 性能调优、JMH、Micrometer | `cargo test --release -- --ignored` |

**每个阶段都能独立运行和测试**——这是本项目的刻意设计。`stage2_inmem` 不依赖 `stage5_wal`，你可以只读其中一个文件就理解一块知识。最终的可执行程序只用到阶段 3/6/9 的产物，前面的阶段是"学习脚手架"，但它们的代码是真实编译进去的（不是注释掉的伪代码）。

### 4.7 配套文件导航

| 文件 | 内容 |
|------|------|
| `src/lib.rs` | 模块树根 + `prelude` 重导出 |
| `src/error.rs` | 阶段 1 |
| `src/stage2_inmem.rs` ~ `src/stage8_async.rs` | 阶段 2 ~ 8 |
| `src/engine.rs` | 阶段 9：整合 |
| `src/bin/minidb-cli.rs` | REPL / 单命令入口 |
| `src/bin/minidb-server.rs` | tokio TCP 服务器 |
| `tests/integration.rs` | 6 个端到端集成测试 |

---

## 5. 阶段 2：内存 KV —— 所有权、借用与生命周期

**目标**：实现一个最小可用的 `HashMap` 版 KV，并**刻意撞上借用检查器**，理解为什么 Java 里随手就写的 `map.get(k)` 在 Rust 里要区分"借用"和"取走"。

**验收标准**：

```bash
$ cargo test --lib stage2
running 6 tests ... ok
```

### 5.1 涉及文件

`src/stage2_inmem.rs`

### 5.2 先建立心智模型

> **Java 的引用是"谁都可以拿、GC 负责收"；Rust 的引用是"同一时刻，要么一个可写，要么多个只读，编译期定死"。**

这不是语法限制，而是一整套并发与内存安全的基础设施。理解了这一句，第 10 章的 `Send`/`Sync` 会变得理所当然。

### 5.3 数据结构

```rust
use std::collections::HashMap;

#[derive(Debug, Default)]
pub struct InMemKv {
    inner: HashMap<String, Vec<u8>>,   // 字段默认私有（≈ Java 的 private）
}
```

注意几个点：

- **字段默认私有**。Rust 的封装边界是**模块**，不是 class。
- 用 `Vec<u8>` 存值而不是 `String`：KV 存储必须能存任意二进制。
- `#[derive(Default)]`：让 `InMemKv::default()` 可用，从而能被 `#[derive(Default)]` 的父结构体自动初始化。

> **clippy 会提醒你**：有 `new()` 就应该实现 `Default`（`new_without_default` lint）。这不是洁癖——`#[derive(Default)] struct Config { kv: InMemKv }` 这种组合场景需要它。

### 5.4 写：`&mut self` 与 `impl Into<T>`

```rust
pub fn set(&mut self, key: impl Into<String>, value: impl Into<Vec<u8>>) -> Option<Vec<u8>> {
    self.inner.insert(key.into(), value.into())
}
```

**`&mut self`**：独占借用。调用期间该实例不能被别处读或写——编译期保证。

**`impl Into<T>` 参数**：这是 Rust 的**静态分发泛型**写法：

- `key` 可以传 `&str`（借用）也可以传 `String`（移交所有权），调用方自己决定
- 相比 Java 的重载（`set(String)` / `set(byte[])`），一份代码覆盖所有可转换类型
- 相比写死 `&str`，调用方持有 `String` 时不必先 `&s[..]` 转换

代价是函数会被**单态化**（monomorphization）——编译器为每个实际类型生成一份机器码。这正是 Rust 泛型没有 Java"擦除 + 装箱"开销的原因。

### 5.5 读：返回借用还是返回所有权

这是本阶段最重要的一行代码：

```rust
/// 零拷贝：返回"视图"，不复制数据
#[must_use]
pub fn get(&self, key: &str) -> Option<&[u8]> {
    self.inner.get(key).map(Vec::as_slice)
}

/// 需要"拥有数据"时（跨线程、存进别的结构）才显式拷贝
#[must_use]
pub fn get_owned(&self, key: &str) -> Option<Vec<u8>> {
    self.get(key).map(<[u8]>::to_vec)
}
```

返回 `Option<&[u8]>` 意味着：

1. **零拷贝**：没有内存复制，也没有 GC 压力
2. 调用方拿到的是"视图"，不能改，也不能活得比 `self` 久（生命周期约束）
3. **借用期间 `self` 被只读冻结**，任何 `&mut self` 调用都会编译失败

Java 的等价物是 `ByteBuffer.asReadOnlyBuffer()`，但那只是**约定**，底层数组仍可能被别人改；Rust 这里是硬约束。

> **工程习惯差异**：Rust 里拷贝应该是**显式的**。所以有 `get` 和 `get_owned` 两个名字，而不是让 `get` 偷偷 clone。这和 Java 里到处 `new ArrayList<>(list)` 的防御性拷贝是两种文化。

另外注意 `key: &str` 而不是 `&String`——接受后者会强迫调用方必须先有 `String`，传 `&str` 就得分配一次。clippy 的 `ptr_arg` 会抓这个。

### 5.6 前缀扫描：惰性迭代器

```rust
pub fn scan_prefix<'k>(&'k self, prefix: &'k str) -> impl Iterator<Item = (&'k str, &'k [u8])> + 'k {
    self.inner
        .iter()
        .filter(move |(k, _)| k.starts_with(prefix))   // move 把 prefix 移进闭包
        .map(|(k, v)| (k.as_str(), v.as_slice()))
}
```

**为什么返回 `impl Iterator` 而不是 `Vec<(String, Vec<u8>)>`？**

- Java 的 `Stream` 是惰性求值，但每次都要 `.collect()` 分配；这里**调用方决定**要不要收集
- `impl Trait` 返回位置让你**换实现不破坏 API**（今天返回 filter+map，明天换成跳表扫描）
- 若返回具体类型（比如 `std::collections::hash_map::Iter`），内部结构泄漏进 API 就再也改不动了

**生命周期 `'k` 的含义**：迭代器借用 `self`，因此**不能活得比 self 久**。编译器追踪这一点——Java 里做不到，所以才有 `ConcurrentModificationException`。

### 5.7 编译器会教你的三件事

源码里注释了三个**编译不过**的反例。请务必逐个取消注释、`cargo build`、读一遍报错——这是本章最有价值的部分。

**❌ 案例 A：借用期间试图修改**

```rust
pub fn java_habit_a(kv: &mut InMemKv) {
    let v = kv.get("a");             // 不可变借用开始
    kv.set("b", b"new".to_vec());    // ❌ E0502: cannot borrow `*kv` as mutable
    println!("{v:?}");               // v 在这里还被使用，所以借用还活着
}
```

Java 里这会静默成功，然后在别处可能抛 `ConcurrentModificationException`。

**✅ 修复 1：缩短借用作用域**（NLL 非词法生命周期会在最后一次使用后自动结束借用）

```rust
{
    let v = kv.get("a").expect("a 存在");
    println!("{v:?}");
}                                    // ← 借用在这里结束
kv.set("b", b"new".to_vec());        // ✅
```

**✅ 修复 2：确实需要数据时就 `get_owned()` 拿走所有权**

**❌ 案例 B：返回局部变量的引用**

```rust
pub fn java_habit_b() -> &'static [u8] {
    let local = vec![1u8, 2, 3];
    &local    // ❌ E0515: cannot return reference to local variable
}
```

Java 里返回对象引用完全没问题（GC 兜底）。

**✅ 修复**：返回 `Vec<u8>`（移交所有权），而不是 `&[u8]`。

**❌ 案例 C：同一个值被 move 两次**

```rust
pub fn java_habit_c() {
    let s = String::from("hello");
    let a = s;
    let b = s;      // ❌ E0382: use of moved value
    println!("{a}{b}");
}
```

Java 里引用赋值多少次都行。

**✅ 修复**：`let b = a.clone();`（真的要两份）或 `let b = &a;`（只是借用）。

### 5.8 边遍历边修改：Rust 的惯用法

Java 里用 `Iterator.remove()` 或 `ConcurrentHashMap`。Rust 的惯用法是**把借用和修改在时间上分开**：

```rust
let doomed: Vec<String> = kv.scan_prefix("tmp:").map(|(k, _)| k.to_owned()).collect();
for k in doomed {
    kv.delete(&k);   // ✅ 迭代已经结束，借用已释放
}
```

### 5.9 Java 对照

| Java | Rust |
|------|------|
| `Map<String, byte[]> map` | `HashMap<String, Vec<u8>>` |
| `map.get(k)` 返回引用，GC 保证对象活着 | 返回 `Option<&Vec<u8>>`，**编译器**保证借用期间没人改 |
| 迭代中 `map.put()` → CME（运行期） | 借用中 `map.insert()` → **编译失败** |
| 参数 `String key`（谁都能改你的对象） | 参数 `&str`（借用，函数内不能改也不能带走） |
| `new String(bytes)` 到处拷贝 | 能借用就借用，实在要走才 `to_owned()` |
| `Optional<T>` 是对象，有装箱 | `Option<T>` 是 enum，`Option<&T>` 和 `&T` 一样大 |

### 5.10 验证

```bash
$ cargo test --lib stage2
running 6 tests
test stage2_inmem::tests::borrow_then_mutate_needs_scoping ... ok
test stage2_inmem::tests::delete_returns_owned_value ... ok
test stage2_inmem::tests::get_missing_returns_none ... ok
test stage2_inmem::tests::mutate_while_scanning_collect_first ... ok
test stage2_inmem::tests::scan_prefix_is_lazy_and_sorted_by_hashmap_order ... ok
test stage2_inmem::tests::set_then_get ... ok
test result: ok. 6 passed
```

其中 `get_missing_returns_none` 值得注意：`Option<T>` 取代了 `null`，**不存在 NPE 的可能**，因为编译器强制你先处理 `None`。

### 5.11 练习

1. 把 `scan_prefix` 的返回值从 `impl Iterator` 改成 `Vec<(String, Vec<u8>)>`，对比 API 灵活度和分配次数。
2. 写 `batch_get(&self, keys: &[&str]) -> Vec<Option<Vec<u8>>>`，体会"返回引用"在这个签名下为什么行不通（返回值会活得比 `self` 的借用还久）。
3. **延伸**：读一遍 `std::borrow::Cow` 的文档，思考什么场景下 `Cow<'_, [u8]>` 才是正解。

---

## 6. 阶段 3：协议层 —— enum、模式匹配与零拷贝分词

**目标**：把文本命令解析成结构化的 `Command`，再把结果编码回字符串。这一层对应 Java Web 项目里的 **DTO + 参数校验器**（`@RequestBody` + Bean Validation）。

**验收标准**：

```bash
$ cargo test --lib stage3
running 6 tests ... ok
```

### 6.1 涉及文件

`src/stage3_protocol.rs`

### 6.2 为什么 Rust 的 enum 比 Java 的强

先看定义：

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Command {
    Set    { key: String, value: Vec<u8> },
    Get    { key: String },
    Delete { key: String },
    Exists { key: String },
    Keys   { prefix: String },
    Ping,
    Compact,
    Quit,
}
```

这是**代数数据类型（ADT）**里的「和类型」（sum type）：一个 `Command` 要么是 `Set`，要么是 `Get`……不能同时是多个，也不可能是"别的什么"。

Java 17+ 要做等价建模，需要 `sealed interface Command permits Set, Get, ...` + 一堆 `record`。Java 5 的 enum 只是常量列表，**每个变体不能携带不同类型和数量的数据**。

配合 `match` 的**编译期穷尽性检查**，就形成了所谓"让非法状态无法表示"（make illegal states unrepresentable）——你没法写出"一个 Set 命令但没有 key"这种对象，因为构造不出来。

### 6.3 解析：`let-else` + 穷尽 match

```rust
pub fn parse(line: &str) -> Result<Self> {
    let mut tokens = tokenize(line);

    // let-else（Rust 1.65+）：取不到就提前返回，取到了 cmd 一定是 Some 的值
    let Some(first) = tokens.next() else {
        return Err(KvError::Protocol("空命令".into()));
    };

    match first.to_ascii_uppercase().as_str() {
        "SET" => {
            let key = require(tokens.next(), "SET 缺少 key")?;
            let value = require(tokens.next(), "SET 缺少 value")?;
            Ok(Self::Set { key: key.to_owned(), value: value.as_bytes().to_vec() })
        }
        "GET" => Ok(Self::Get { key: require(tokens.next(), "GET 缺少 key")?.to_owned() }),
        "DEL" => Ok(Self::Delete { key: require(tokens.next(), "DEL 缺少 key")?.to_owned() }),
        "EXISTS" => Ok(Self::Exists { key: require(tokens.next(), "EXISTS 缺少 key")?.to_owned() }),
        "KEYS" => Ok(Self::Keys { prefix: tokens.next().unwrap_or("").to_owned() }),
        "PING" => Ok(Self::Ping),
        "COMPACT" => Ok(Self::Compact),
        "QUIT" => Ok(Self::Quit),
        other => Err(KvError::Protocol(format!("未知命令: {other}"))),
    }
}
```

**三点值得注意：**

**① `let-else`** 是 Rust 1.65+ 的语法糖，≈ Java 的 `if (first == null) return ...; var cmd = first;`，但更紧凑，且**编译器保证**后续代码里 `first` 一定是有效值。

**② 解析时零拷贝，构造时才拿所有权**

`tokenize` 返回的是 `&str` 切片（零分配），但 `Command` 要拥有数据（因为要落盘、要跨线程），所以最后 `to_owned()`。**这是 Rust 里最常见的动作组合**：先借用着处理，最后一刻才分配。

**③ 匹配 `&str` 必须有 `_ =>` 兜底**（这里是 `other =>`），因为字符串有无限种可能。而对于 `Command` 这种有限变体的 enum，编译器允许你**不写**兜底，并强制穷尽。

辅助函数里的生命周期标注也值得看一眼：

```rust
fn require<'a>(token: Option<&'a str>, msg: &str) -> Result<&'a str> {
    token.ok_or_else(|| KvError::Protocol(msg.to_owned()))
}
```

`'a` 明确写了"返回值的借用来自 `token` 而不是 `msg`"。两个输入都是引用时，编译器无法猜你想返回哪一个，必须写明。Java 里根本没有这个概念——所有引用都由 GC 管着，不需要标注来源。

> 另外注意 `ok_or_else`（惰性）而不是 `ok_or`（立即构造 `String`）。这是 Rust 里很常见的微优化：错误路径才付代价。

### 6.4 零拷贝分词器

`split_whitespace()` 不认引号，带空格的值（`SET msg "hello world"`）会被切成两半。所以手写一个单趟扫描：

```rust
fn tokenize(line: &str) -> impl Iterator<Item = &str> {
    let chars = line.char_indices();
    let mut out: Vec<&str> = Vec::new();
    let mut start: Option<usize> = None;
    let mut in_quotes = false;

    for (i, c) in chars {
        match c {
            '"' => {
                if in_quotes {
                    if let Some(s) = start.take() { out.push(&line[s..i]); }
                    in_quotes = false;
                } else {
                    start = Some(i + 1);   // 跳过开头的引号
                    in_quotes = true;
                }
            }
            c if c.is_whitespace() && !in_quotes => {
                if let Some(s) = start.take() { out.push(&line[s..i]); }
            }
            _ => { start.get_or_insert(i); }
        }
    }
    if let Some(s) = start { out.push(&line[s..]); }
    out.into_iter()
}
```

签名 `fn tokenize(line: &str) -> impl Iterator<Item = &str>` 中，输出 `Item` 的生命周期被**省略规则**自动推导为和 `line` 一致——即"输出的切片来自输入，不会比输入活得久"。

对比 Java：`String.split()` 每次都新建一堆 `String` 对象，压力全给 GC。这里一次分配都没有（除了 `out` 这个 Vec）。

### 6.5 响应编码：RESP 风格的行协议

```rust
pub enum Response {
    Ok,
    Value(Option<Vec<u8>>),   // None 表示 nil（键不存在）
    Bool(bool),
    Keys(Vec<String>),
    Error(String),
    Pong,
}

impl Response {
    pub fn encode(&self) -> String {
        match self {
            Self::Ok => "+OK\r\n".to_owned(),
            Self::Value(Some(v)) => {
                // 二进制值可能含 \r\n，所以用长度前缀：$<len>\r\n<bytes>\r\n
                let mut out = format!("${}\r\n", v.len());
                out.push_str(&String::from_utf8_lossy(v));
                out.push_str("\r\n");
                out
            }
            Self::Value(None) => "$-1\r\n".to_owned(),
            Self::Bool(true) => ":1\r\n".to_owned(),
            Self::Bool(false) => ":0\r\n".to_owned(),
            Self::Keys(keys) => {
                let mut out = format!("*{}\r\n", keys.len());
                for k in keys {
                    let _ = fmt::Write::write_fmt(&mut out, format_args!("${}\r\n{k}\r\n", k.len()));
                }
                out
            }
            Self::Error(msg) => format!("-ERR {msg}\r\n"),
            Self::Pong => "+PONG\r\n".to_owned(),
        }
    }
}
```

| 前缀 | 含义 | 例子 |
|------|------|------|
| `+` | 简单字符串 | `+OK\r\n` |
| `$` | 批量字符串（带长度） | `$5\r\nhello\r\n`；`$-1` 表示 nil |
| `:` | 整数 / 布尔 | `:1\r\n` |
| `*` | 数组（元素个数） | `*2\r\n...` |
| `-` | 错误 | `-ERR 未知命令\r\n` |

注意 `Value(Option<Vec<u8>>)`：**嵌套的 Option 明确表达"键不存在"**，客户端拿到后必须匹配，不能像 Java 那样 `response.getValue().length` 直接 NPE。

`Keys` 分支里用 `write!` 往同一个 `String` 追加，而不是 `format!` 拼一串——≈ Java 里用 `StringBuilder.append` 而不是 `"a" + b + c`。

### 6.6 在边界处折叠错误：替代 `@ControllerAdvice`

```rust
pub fn from_result(r: Result<Option<Vec<u8>>>) -> Self {
    match r {
        Ok(v) => Self::Value(v),
        Err(e) => Self::Error(e.to_string()),
    }
}
```

这是 Rust 里替代"全局异常处理器"的常用手法：**在边界处一次性把 `Err` 折叠成协议错误，中间层不需要任何 try/catch**。第 12 章的 `apply()` 就是这么写的。

好处是错误处理的位置是**显式**的：你能从函数签名看出"这里会把引擎错误转成客户端响应"，而不是靠 AOP 在看不见的地方兜底。

### 6.7 编译器会教你的事：穷尽匹配的威力

源码里有个测试专门演示这点：

```rust
fn is_write(cmd: &Command) -> bool {
    match cmd {
        Command::Set { .. } | Command::Delete { .. } | Command::Compact => true,
        Command::Get { .. }
        | Command::Exists { .. }
        | Command::Keys { .. }
        | Command::Ping
        | Command::Quit => false,
    }
}
```

**现在给 `Command` 加一个新变体，这个函数会编译失败**，提醒你所有使用该 enum 的地方都要更新。Java 的 `switch` 只有在 sealed + 无 default 时才勉强有类似保障。

### 6.8 零成本抽象的一个可验证证据

```rust
use std::mem::size_of;
assert_eq!(size_of::<Option<&u8>>(), size_of::<&u8>());
```

这行断言会过。`Option<&T>` 和 `&T` **一样大**——编译器利用"引用不可能为 0"这个事实，把 `None` 编码成空指针（niche optimization）。

对比：

- Java 的 `Optional<T>` 是一个真实对象，有对象头、有装箱、有 GC 压力
- Rust 的 `Option<&T>` 零额外开销

但注意 `Option<Vec<u8>>` 就没法优化（`Vec` 没有空闲的 bit 模式可用）。所以"零成本"是**有条件的**，要看具体类型。

### 6.9 Java 对照

| Java (17+) | Rust |
|------------|------|
| `sealed interface Command permits ...` + 一堆 `record` | 一个 `enum` 搞定 |
| `switch` 模式匹配（Java 21 才稳定） | `match`，穷尽性是编译期强制的 |
| 忘记 default 分支 → 运行期 `MatchException` | 漏一个变体 → **编译失败** |
| `Optional<T>`：装箱对象，本身还能是 `null` | `Option<T>`：普通 enum，`Option<&T>` 和 `&T` 一样大 |
| `null` 检查靠人 + `@NonNull` 注解 | 根本没有 `null`，只能匹配 `Some`/`None` |
| enum 只是常量列表 | enum 是 ADT，每个变体能带不同类型和数量的数据 |

### 6.10 验证

```bash
$ cargo test --lib stage3
running 6 tests
test stage3_protocol::tests::encode_response_roundtrip_shape ... ok
test stage3_protocol::tests::exhaustive_match_is_enforced ... ok
test stage3_protocol::tests::option_is_zero_cost ... ok
test stage3_protocol::tests::parse_errors_are_values ... ok
test stage3_protocol::tests::parse_quoted_value ... ok
test stage3_protocol::tests::parse_set_and_get ... ok
test result: ok. 6 passed
```

`parse_errors_are_values` 这个测试体现了 Rust 的另一个优势：

```rust
assert!(matches!(Command::parse("SET onlykey"), Err(KvError::Protocol(_))));
```

**错误是"值"，可以直接断言**。Java 里要 `assertThrows(...)` 包一层，还得靠 lambda 捕获。

### 6.11 练习

1. 给 `Command` 加一个 `Expire { key: String, seconds: u64 }` 变体，观察 `Command::name()`、`apply()`、`is_read_only()` 等所有 `match` 处如何被编译器揪出来。
2. 实现 `Response` 的解析端（客户端），做到 `parse(encode(x)) == x` 的 round-trip 属性测试。
3. **延伸**：把 `Command::parse` 的失败路径改成返回结构化的 `ParseError { position: usize, expected: &'static str }`，让错误能精确指出出错的列号。

---

## 7. 阶段 4：抽象层 —— trait、泛型与静态/动态分发

**目标**：把阶段 2 的内存实现和后面阶段 5/6 的磁盘实现**统一到一个接口**下，让上层不关心底层是内存还是磁盘。对应 Java 的 `interface KvRepository` + 两个实现类 + Spring 注入。

**验收标准**：

```bash
$ cargo test --lib stage4
running 5 tests ... ok
```

### 7.1 涉及文件

`src/stage4_traits.rs`

### 7.2 trait 定义

```rust
pub trait KvStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>>;
    fn set(&mut self, key: &str, value: Vec<u8>) -> Result<()>;
    fn delete(&mut self, key: &str) -> Result<Option<Vec<u8>>>;
    fn keys(&self, prefix: &str) -> Result<Vec<String>>;
    fn compact(&mut self) -> Result<u64>;

    // ---- 默认方法（≈ Java 的 default method）----
    fn exists(&self, key: &str) -> Result<bool> {
        Ok(self.get(key)?.is_some())
    }

    fn batch_set(&mut self, pairs: &[(String, Vec<u8>)]) -> Result<()> {
        for (k, v) in pairs {
            self.set(k, v.clone())?;
        }
        Ok(())
    }
}
```

**三个关键设计点：**

**① `Send + Sync` 是超 trait（supertrait）**

≈ `interface KvStore extends Send, Sync`：

- `Send`：所有权可以跨线程转移
- `Sync`：`&T` 可以跨线程共享

标上这两个约束后，任何把 `KvStore` 实现体送进线程的代码都能通过编译检查，**且实现者也必须满足**。这是 Rust"无畏并发"的基石，Java 完全没有对应物。

**② 方法签名区分了读写**

读用 `&self`，写用 `&mut self`。这比 Java 的 `interface` 表达力强得多——**接口层面就区分了读写**，编译器天然知道哪些调用需要独占访问。

**③ 默认方法 ≈ Java 的 default method**

`exists` 的默认实现基于 `get`，但会**拷贝数据**（`get` 返回 `Option<Vec<u8>>`）。追求性能的实现者应该覆盖它——这就是默认方法与覆写的典型权衡。

### 7.3 为已有类型实现 trait

```rust
impl KvStore for InMemKv {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        Ok(self.get_owned(key))       // trait 要求所有权，所以用 get_owned
    }

    fn set(&mut self, key: &str, value: Vec<u8>) -> Result<()> {
        self.set(key, value);         // 注意：这里调用的是 InMemKv::set
        Ok(())
    }

    /// 名字撞车：外层的 KvStore::delete 和 InMemKv::delete 同名
    fn delete(&mut self, key: &str) -> Result<Option<Vec<u8>>> {
        Ok(InMemKv::delete(self, key))   // 必须显式限定，否则无限递归
    }

    fn keys(&self, prefix: &str) -> Result<Vec<String>> {
        Ok(self.scan_prefix(prefix).map(|(k, _)| k.to_owned()).collect())
    }

    fn compact(&mut self) -> Result<u64> { Ok(0) }   // 内存版没有可回收空间

    fn exists(&self, key: &str) -> Result<bool> {
        Ok(self.contains(key))        // 覆盖默认实现，避免无谓拷贝
    }
}
```

**注意 `impl` 块可以和类型定义不在同一个文件**——只要在同一个 crate。这和 Java「一个类必须写在一个 `.java` 文件里」不同，也意味着**你可以给第三方类型实现你的 trait**。

那个 `delete` 的坑值得单独说：trait 方法和固有方法同名时，直接写 `self.delete(key)` 会无限递归（编译器会警告 `function cannot return without recursing`）。必须显式写 `InMemKv::delete(self, key)`。

### 7.4 静态分发 vs 动态分发

这是本章的核心，也是 Rust 与 Java 差异最大的地方。

**静态分发（泛型）**：

```rust
pub fn run_commands<S: KvStore>(store: &mut S, cmds: &[Command]) -> Result<Vec<Response>> {
    // ...
}
```

`S: KvStore` 是 trait bound（≈ Java 的 `<S extends KvStore>`）。区别是：

- Java 编译后 `S` 被擦成 `KvStore`，运行期走 `invokeinterface`
- Rust 会为 `S = InMemKv`、`S = SegmentEngine` **各生成一份** `run_commands::<InMemKv>` 代码，调用是直接函数调用，可被内联

**动态分发（trait object）**：

```rust
pub struct Router {
    backends: Vec<Box<dyn KvStore>>,   // 异构集合
}
```

`Box<dyn KvStore>` 是**胖指针**（数据指针 + vtable 指针），≈ JVM 的对象头 + 方法表。用在需要"异构集合"或"运行时决定实现"的场景。

| | Java | Rust 泛型 | Rust `dyn` |
|--|------|-----------|-----------|
| 分发 | 永远动态 | 静态（编译期单态化） | 动态（vtable） |
| 内联 | JIT 可能做 | LLVM 直接做 | 不能 |
| 泛型参数是 primitive | 不行（要装箱） | 可以（`u64` 直接内联） | —— |
| 异构集合 | 天然支持 | 不支持 | 支持 |
| 编译产物 | 一份 | 每类型一份（体积变大） | 一份 |

> **经验法则：默认用泛型，需要异构集合或运行时切换实现时才用 `dyn`。**

### 7.5 装饰器是零成本的

```rust
pub struct Timed<S> {
    inner: S,
    pub total_calls: u64,
}

impl<S: KvStore> KvStore for Timed<S> {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let started = Instant::now();
        let r = self.inner.get(key);
        log::debug!("GET {key} 耗时 {:?}", started.elapsed());
        r
    }
    fn set(&mut self, key: &str, value: Vec<u8>) -> Result<()> {
        self.total_calls += 1;
        self.inner.set(key, value)
    }
    // ...其余转发
}
```

编译后 `Timed<InMemKv>` 的 `get` 会被内联展开，运行期开销为 **0**。

Java 做同样的事：要么动态代理（反射开销），要么手写包装类（样板代码）。这就是"零成本抽象"的具体含义——**你为了可读性引入的抽象层，编译器会帮你抹平**。

### 7.6 扩展 trait 与孤儿规则

```rust
/// 给**别人的类型**加方法
pub trait KeyNormalize {
    fn normalize_key(&self) -> String;
}

impl KeyNormalize for str {
    fn normalize_key(&self) -> String {
        self.trim().to_lowercase()
    }
}

// 于是：
assert_eq!("  Hello ".normalize_key(), "hello");
```

Java 里想给 `String` 加个方法只能写 `StringUtils.xxx(s)`。Rust 里可以为 `str` 实现自定义 trait，方法直接挂在类型上。

**孤儿规则（Orphan Rule）**限制了这件事：实现 trait 时，**trait 或类型至少要有一个是本地 crate 定义的**。

- ✅ `impl KvStore for HashMap<String, Vec<u8>>`（trait 是本地的）
- ❌ `impl serde::Serialize for std::net::IpAddr`（两个都是别人的）

Java 没这个概念，因为接口和实现必须在同一个类里声明。

### 7.7 Java 对照

| | Java | Rust |
|--|------|------|
| 抽象机制 | `interface`，调用走 `invokeinterface`（动态分发） | `trait`，默认**静态分发** |
| 泛型实现 | 类型擦除，`List<String>` 运行期就是 `List` | 单态化，`T` 可以是 `u64` |
| 给已有类型加能力 | 做不到（除非包装类 / 继承） | 可以（`impl MyTrait for str`） |
| 默认方法 | ✅ default method | ✅ trait 默认方法，且能调用其他方法 |
| 继承 | `extends` 多继承接口 | `trait A: B`（超 trait），不是继承 |
| 关联类型 | 没有，靠泛型参数 | `type Item;`，避免 `Foo<A, B, C>` 爆炸 |
| 运行时多态 | 所有引用都是多态 | 只有 `&dyn Trait` / `Box<dyn Trait>` |

### 7.8 验证

```bash
$ cargo test --lib stage4
running 5 tests ... ok
```

其中 `trait_object_allows_heterogeneous_backends` 展示了 Rust 里的"测试替身"：

```rust
struct Counting { sets: usize }

impl KvStore for Counting {
    fn get(&self, _key: &str) -> Result<Option<Vec<u8>>> { Ok(None) }
    fn set(&mut self, _key: &str, _value: Vec<u8>) -> Result<()> { self.sets += 1; Ok(()) }
    // ...
}
```

> **Rust 里手写 stub 往往比引 mock 框架更简单**，因为 trait 实现成本很低。这是和 Java（Mockito 几乎必装）很不一样的体验。

### 7.9 练习

1. 给 `Router` 加一致性哈希分片：多个后端按 key 路由。体会 `Box<dyn KvStore>` 为何在这种场景下不可避免。
2. 把 `KvStore::get` 的返回类型改成 `Result<Option<&[u8]>>`（借用版），你会发现 trait 需要加生命周期参数。思考为什么 GAT（泛型关联类型）能更好地解决这个问题。
3. **延伸**：给标准库的 `HashMap<String, Vec<u8>>` 实现 `KvStore`，体会孤儿规则允许什么、禁止什么。

---

## 8. 阶段 5：持久化 —— WAL、RAII 与位置读取

**目标**：把内存引擎改造成 **append-only 日志（WAL）+ 内存哈希索引**的 Bitcask 引擎，做到**进程重启后数据不丢**。

**验收标准**：

```bash
$ cargo test --lib stage5
running 6 tests ... ok
```

### 8.1 涉及文件

`src/stage5_wal.rs`

### 8.2 核心数据结构

```rust
/// 索引条目：键 → 记录在日志文件中的位置
#[derive(Debug, Clone, Copy)]
struct IndexEntry {
    offset: u64,
    len: u64,
}

pub struct WalEngine {
    dir: PathBuf,
    index: HashMap<String, IndexEntry>,   // 没有锁，阶段 7 才解决并发
    writer: File,                          // append 模式打开的写句柄
    write_pos: u64,
    dead_bytes: u64,                       // 已废弃但仍占磁盘的字节数
    lock: Option<File>,                    // 目录锁，Option 是为了 Drop 里先关再删
}
```

**Bitcask 的核心思想再强调一次**：磁盘上只有 append-only 日志，内存中只有"键 → 偏移"的哈希索引。于是

- 随机读退化成一次 seek + 一次顺序读
- 写永远是最快的 append
- 代价是删除和更新会产生垃圾（第 9 章的 compaction 负责回收）

### 8.3 帧编解码

```rust
const MAGIC: [u8; 4] = *b"MDB1";
const HEADER_LEN: usize = 12;   // magic(4) + key_len(4) + val_len(4)
const FOOTER_LEN: usize = 4;    // crc32
const MAX_RECORD: usize = 64 << 20;
const TOMBSTONE: u32 = u32::MAX;

pub(crate) fn encode_frame(key: &str, value: Option<&[u8]>) -> Vec<u8> {
    let key_len = u32::try_from(key.len()).expect("key 长度超过 4 GiB");
    let val_len = value
        .map_or(TOMBSTONE, |v| u32::try_from(v.len()).expect("value 长度超过 4 GiB"));

    let cap = (HEADER_LEN + FOOTER_LEN) + key.len() + value.map_or(0, <[u8]>::len);
    let mut buf = Vec::with_capacity(cap);   // 预分配，避免多次扩容

    buf.extend_from_slice(&MAGIC);
    buf.extend_from_slice(&key_len.to_le_bytes());
    buf.extend_from_slice(&val_len.to_le_bytes());
    buf.extend_from_slice(key.as_bytes());
    if let Some(v) = value { buf.extend_from_slice(v); }

    let crc = crc32(&buf);
    buf.extend_from_slice(&crc.to_le_bytes());
    buf
}
```

**为什么用 `u32::try_from(...).expect(...)` 而不是 `as`？**

32 位平台上 `usize as u32` 会**静默截断**，把一个超长 key 变成"看起来合法"的小数字，写下去就是数据损坏。Java 的 `(int) longValue` 截断也是静默的——这是 Rust 用类型系统替你堵住的一类漏洞。

**CRC32 表在编译期生成**：

```rust
const fn build_crc_table() -> [u32; 256] { /* ... */ }
static CRC_TABLE: [u32; 256] = build_crc_table();
```

`const fn` 在编译期求值，运行期零成本。Java 里只能写成 `static {}` 初始化块或硬编码数组。

### 8.4 关键坑 ①：活跃段不能用 `BufWriter`

这是本项目**真实踩过的 bug**，源码注释里留了案发现场：

> ⚠️ 活跃段同时被 append 写和按 offset 随机读。一旦加了用户态缓冲，"刚写完马上读"就会读到文件里的旧内容（甚至 EOF），然后被误判成"数据损坏"。

修复方案：活跃段直接用 `File::write_all`，把写入合并交给 **OS page cache**——`write(2)` 本身就是进内核缓存的，速度远比想象中快。

> 这个坑在 Java 里一模一样（`BufferedWriter` 混用 `RandomAccessFile`），区别是 Java 会**静默返回旧数据/半截数据**，而 Rust 会明确报 `Corrupted`。

### 8.5 关键坑 ②：`File::try_clone()` 不是独立游标

这是第二个真实踩过的坑，也是本章最重要的技术点。

`File::try_clone()` 底层是 `dup(2)` / `DuplicateHandle`，**新旧句柄共享同一个文件偏移量**。所以"每个线程 clone 一份句柄然后各自 seek"在并发下会互相踩，表现出来是随机出现「魔数不匹配」「校验和不匹配」这种看似玄学的错误。

**正确做法是用位置读取（positional read）**——一次性传入 offset，不修改文件游标：

```rust
pub(crate) fn read_exact_at(file: &File, buf: &mut [u8], offset: u64) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileExt;
        read_loop(|b, off| file.read_at(b, off), buf, offset)
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        read_loop(|b, off| file.seek_read(b, off), buf, offset)
    }

    #[cfg(not(any(unix, windows)))]
    {
        use std::io::{Read, Seek, SeekFrom};
        let mut f = file;
        f.seek(SeekFrom::Start(offset))?;
        f.read_exact(buf)
    }
}
```

三点：

1. `#[cfg]` 是 Rust 处理条件编译的标准方式（Java 里通常要靠运行时 `OsUtils.isWindows()` 判断 + 接口抽象）
2. 位置读取可能一次读不满，所以要 `read_loop` 循环补齐（和 `Read::read_exact` 同样语义）
3. 对应 Java 的 `FileChannel.read(ByteBuffer, position)`——同样不加锁也安全

**签名是 `&File` 而不是 `&mut File`**：位置读取不修改文件游标，所以不可变借用就够了。这意味着多个读操作可以**并发进行**，连 `RwLock` 的读锁都不需要——这是 Rust 类型系统直接带给并发的好处。

### 8.6 durability 三档

```rust
pub fn sync(&mut self) -> Result<()> {
    self.writer.sync_all()?;   // fsync
    Ok(())
}
```

| 档位 | 做法 | 崩溃后 | Java 对照 |
|------|------|--------|-----------|
| 1 | 什么都不做 | 进程崩溃不丢，**机器断电丢** | 默认 `FileOutputStream` |
| 2 | `sync_data()` | 刷数据不刷元数据 | `FileChannel.force(false)` |
| 3 | `sync_all()` | 机器断电也不丢，约 0.1~1ms | `FileChannel.force(true)` |

生产引擎默认走第 1 档（性能），提供 `sync` 命令让调用方按需升级到第 3 档。本项目为了教学清晰，在 `close()` 和 `Drop` 里都走第 3 档。

### 8.7 关键坑 ③：`Drop` 不能返回错误

`drop(&mut self)` 没有返回值。如果 fsync 失败了，你**没有任何办法通知调用方**，数据就静默丢了。

Rust 的惯用解法：

```rust
/// 显式关闭：消费 self，返回 Result
pub fn close(self) -> Result<()> {
    self.writer.sync_all()?;   // 这里能报错！
    drop(self);                // 触发 Drop；即使上面返回 Err，析构仍会发生
    Ok(())
}

impl Drop for WalEngine {
    fn drop(&mut self) {
        // 只能尽力而为：忽略错误，记日志
        if let Err(e) = self.writer.sync_all() {
            log::error!("WAL sync 失败（Drop 中）: {e}");
        }
        drop(self.lock.take());                              // 先关句柄
        let _ = fs::remove_file(self.dir.join("LOCK"));      // 再删文件（Windows 要求）
    }
}
```

**`close(self)` 消费所有权**，所以编译器保证**关闭后无法再使用**——比 Java 的 `IllegalStateException("connection closed")` 运行期检查强得多。

分工是：

- `Drop` 负责"尽力而为"的清理（关句柄，不能报错）
- `close(self)` 负责"必须成功"的收尾（flush + fsync）

### 8.8 目录锁

```rust
let lock = OpenOptions::new()
    .write(true)
    .create_new(true)                 // 文件已存在时失败，原子操作
    .open(dir.join("LOCK"))
    .map_err(|e| {
        if e.kind() == io::ErrorKind::AlreadyExists {
            KvError::Protocol(format!("数据目录已被占用: {}", dir.display()))
        } else {
            KvError::Io(e)
        }
    })?;
```

`create_new` ≈ Java 的 `Files.createFile`，已存在就报错，是原子的。

> **生产环境不要这么做**：`O_EXCL` 在进程崩溃后**不会自动释放**，锁文件会残留。生产实现应该用 `fs2::FileExt::try_lock_exclusive` 或 `file-lock` crate（OS 级 flock，进程退出由内核自动释放），或者把 pid 写进锁文件并在 `open` 时检查该 pid 是否还活着。

### 8.9 重放：索引靠重放日志重建

```rust
fn replay(&mut self) -> Result<()> {
    let file = OpenOptions::new().read(true).write(true).open(self.dir.join("000000001.log"))?;
    let mut pos = 0u64;
    let len = file.metadata()?.len();

    while pos < len {
        match read_frame_at(&file, pos) {
            Ok(Frame { key, value, consumed }) => {
                if value.is_some() {
                    if let Some(old) = self.index.insert(key, IndexEntry { offset: pos, len: consumed }) {
                        self.dead_bytes += old.len;   // 旧记录成了垃圾
                    }
                } else {
                    if let Some(old) = self.index.remove(&key) {
                        self.dead_bytes += old.len;
                    }
                    self.dead_bytes += consumed;
                }
                pos += consumed;
            }
            // 读到不完整的尾部（断电写了一半）：截断到最后一个完整帧
            Err(KvError::Corrupted { .. }) => {
                log::warn!("WAL 尾部损坏，截断到 offset {pos}");
                file.set_len(pos)?;
                break;
            }
            Err(e) => return Err(e),
        }
    }
    self.write_pos = pos;
    Ok(())
}
```

**crash recovery 的核心逻辑**：日志是 append-only 的，所以**最后一个不完整的帧一定是崩溃前的半次写，丢掉即可**。

注意重放用的是独立的**写模式**句柄——因为 `set_len` 需要写权限（见第 9 章的 Windows 坑）。

### 8.10 调试路径用 serde

```rust
pub fn dump(&self) -> Result<String> {
    // 把二进制 WAL 转成人类可读的 JSON 文本
    let json = serde_json::json!({
        "offset": pos,
        "key": f.key,
        "op": if f.value.is_some() { "set" } else { "del" },
        "bytes": f.consumed,
    });
    // ...
}
```

**热路径不用 serde，调试路径随便用**。这是 Rust 项目里 serde 最常见的定位（≈ Java 里只在 DEBUG 日志里开 Jackson）。

### 8.11 Java 对照

| Java | Rust |
|------|------|
| `try (var out = new BufferedWriter(...))` | `BufWriter` + `Drop`，作用域结束必释放 |
| `finally { close(); }` 写漏 → 句柄泄漏 | 没有 `finally`，不可能忘记 |
| `close()` 抛 `IOException` | `drop()` **不能**返回错误 → 惯用法是显式 `close(self) -> Result` |
| `RandomAccessFile.seek()` | `File::seek(SeekFrom::Start(n))`，需要 `&mut` |
| `FileChannel.read(buf, position)` | `read_at` / `seek_read`（`&File` 即可） |
| Jackson 序列化到 `byte[]` | 手写二进制帧（热路径）；serde 留给调试路径 |
| `FileLock` / `flock` | std 没有，用 `create_new` 做简易互斥（生产请用 `fs2`） |

### 8.12 验证

```bash
$ cargo test --lib stage5
running 6 tests
test stage5_wal::tests::corrupted_frame_is_detected ... ok
test stage5_wal::tests::frame_roundtrip ... ok
test stage5_wal::tests::positional_read_is_idempotent ... ok
test stage5_wal::tests::read_frame_at_offset_skips_previous_records ... ok
test stage5_wal::tests::tombstone_frame ... ok
test stage5_wal::tests::truncated_tail_is_detected ... ok
test result: ok. 6 passed
```

`positional_read_is_idempotent` 尤其重要：同一个 `File` 句柄连续读三次，结果必须一致——**这是并发读安全的前提**。

`corrupted_frame_is_detected` 和 `truncated_tail_is_detected` 展示了 CRC 的价值：改一个字节 / 砍掉 3 个字节，都会被检出。

### 8.13 练习

1. 写一个测试：先写 100 条记录，手动把第 50 条的第一个字节改掉，验证只有第 50 条被判定为损坏（前面的能正常读出）。
2. 实现 `WalEngine::truncate_after(offset)`，让调用方能手动截断。注意 Windows 上 `set_len` 需要写句柄这件事。
3. **延伸**：把帧格式里的 CRC32 换成 xxhash（`twox-hash` crate），写一个对比 benchmark。

---

## 9. 阶段 6：崩溃恢复、段滚动与合并

**目标**：把单段 WAL 升级成**多段（segment）+ 定期合并**的完整 Bitcask 引擎。这是存储引擎的核心工程部分。

**验收标准**：

```bash
$ cargo test --lib stage6
running 4 tests ... ok
```

### 9.1 涉及文件

`src/stage6_compact.rs`

### 9.2 为什么需要多段和合并

单段 WAL 有两个问题：

1. **文件无限增长**：所有历史记录都在一个文件里，永远不缩小
2. **垃圾占比上升**：同一个 key 写 100 次就留了 100 条记录，只有最后一条有效

compaction 就是"重写有效数据、丢弃垃圾"。这是 LevelDB/RocksDB 的 LSM 与 Bitcask 共同的思想。

而**多段**让合并可以增量做：只合并一部分旧段，不用每次重写整个库。

### 9.3 manifest：用 serde 持久化段清单

```rust
const MANIFEST_VERSION: u32 = 1;
const SEGMENT_MAX_BYTES: u64 = 1024 * 1024;   // 1 MiB，方便测试触发
const COMPACT_THRESHOLD: f64 = 0.3;

#[derive(Debug, Serialize, Deserialize)]
struct Manifest {
    version: u32,
    active_id: u64,
    frozen: Vec<u64>,   // 已冻结的只读段 id（升序）
}
```

`#[derive(Serialize, Deserialize)]` ≈ Jackson 的 `@Data` + `ObjectMapper`，但有本质区别：**没有反射**。宏在编译期生成 `to_json`/`from_json` 的代码，运行期就是普通的字段读写，还能被内联。

`MANIFEST_VERSION` ≈ Java 里序列化类的 `serialVersionUID`——格式变了就拒绝加载，避免读到乱码。

**原子写入**：

```rust
fn save_manifest(&self) -> Result<()> {
    let tmp = self.dir.join("manifest.json.tmp");
    {
        let mut f = BufWriter::new(File::create(&tmp)?);
        serde_json::to_writer(&mut f, &m)?;
        f.flush()?;
        f.get_ref().sync_all()?;
    }   // ← f 离开作用域，Drop 自动关闭文件（≈ try-with-resources）
    fs::rename(tmp, self.dir.join("manifest.json"))?;
    Ok(())
}
```

**先写临时文件再 rename**——`rename` 在同一文件系统内是原子的，所以永远不会出现"manifest 写了一半"的中间态。这个模式在本章会反复出现。

### 9.4 打开流程

```rust
pub fn open(dir: impl AsRef<Path>) -> Result<Self> {
    // 1. 目录锁（create_new 原子创建）
    // 2. 读取或推断 manifest
    let manifest = Self::load_manifest(&dir)?;

    // 3. 按 id 升序打开所有 frozen 段并重放
    for seg_id in manifest.frozen.iter().copied() {
        let file = File::open(Self::seg_path(&dir, seg_id))?;
        let (d, l) = replay_segment(&file, seg_id, &mut index, &path)?;
        dead_bytes += d;
        live_bytes += l;
        frozen.insert(seg_id, file);
    }

    // 4. 打开活跃段（append 模式）
    let active_path = Self::seg_path(&dir, manifest.active_id);
    let active_file = OpenOptions::new().create(true).read(true).append(true).open(&active_path)?;
    let active_clone = active_file.try_clone()?;
    let (d, l) = replay_segment(&active_clone, manifest.active_id, &mut index, &active_path)?;
    // ...
}
```

**为什么 `frozen` 用 `BTreeMap` 而不是 `HashMap`？** 因为段必须按 id 顺序重放（后写的覆盖先写的）。有序容器让这个语义显式化，也让 `frozen.keys()` 天然有序。

`load_manifest` 还有个向后兼容的兜底：目录里已有 `.log` 但没有 manifest 时，扫描文件名推断段 id。

### 9.5 段滚动

```rust
fn should_roll(&self) -> bool {
    self.active_pos >= SEGMENT_MAX_BYTES
}

fn roll(&mut self) -> Result<()> {
    self.active_writer.sync_all()?;            // 没有用户态缓冲要刷，直接 fsync

    let old_id = self.active_id;
    let reader = File::open(Self::seg_path(&self.dir, old_id))?;
    self.frozen.insert(old_id, reader);        // 冻结成只读段

    let new_id = old_id + 1;
    let f = OpenOptions::new().create(true).read(true).append(true)
        .open(Self::seg_path(&self.dir, new_id))?;
    self.active_writer = f;
    self.active_id = new_id;
    self.active_pos = 0;
    self.save_manifest()?;
    Ok(())
}
```

生产里 `SEGMENT_MAX_BYTES` 通常是 64 MiB ~ 1 GiB，本项目设成 1 MiB 是为了让测试能轻松触发滚动。

### 9.6 崩溃恢复：截断坏尾巴

```rust
Err(KvError::Corrupted { truncated_at, .. }) => {
    log::warn!("段 {seg_id} 在 offset {truncated_at} 处损坏，已截断");
    // 必须用**写模式**打开才能 set_len
    let writable = OpenOptions::new().write(true).open(path)?;
    writable.set_len(truncated_at)?;
    writable.sync_all()?;
    break;
}
```

**这个坑很隐蔽**：段文件平时以只读打开（更安全：防止误写历史段），所以截断这一步要临时换一个写句柄。

> 表现是 **Linux 上不报错、只在 Windows 上报 `PermissionDenied`**。跨平台开发时对权限差异要格外小心。

另外注意 `replay_segment` 里用了 `saturating_sub`：

```rust
live = live.saturating_sub(old.len);
```

因为旧记录可能在**另一个段**里，本段的 `live` 计数里没有它。debug 模式下整数溢出会 panic（Java 的 `long` 静默回绕），所以用 `saturating_sub` 显式表达"减到 0 就停"。

### 9.7 合并：每一步都要考虑"此时断电会怎样"

```rust
pub fn compact(&mut self) -> Result<u64> {
    if self.index.is_empty() { return Ok(0); }

    // 合并前先 fsync：确保待迁移的数据已经真正落盘
    self.active_writer.sync_all()?;

    let reclaimed = self.dead_bytes;
    let new_id = self.active_id + 1 + 1000;    // 明显更大的 id，避免冲突
    let tmp_path = self.dir.join(format!("{new_id:09}.log.compacting"));

    // 收集要保留的键并排序：保证多次合并结果一致
    let mut keys: Vec<String> = self.index.keys().cloned().collect();
    keys.sort();

    let mut new_index = HashMap::with_capacity(keys.len());
    {
        let file = File::create(&tmp_path)?;
        let mut w = BufWriter::new(file);
        let mut pos = 0u64;
        for key in &keys {
            let old_loc = self.index[key];
            if let Some(value) = self.read_at(old_loc)? {
                let bytes = frame::encode_frame(key, Some(&value));
                w.write_all(&bytes)?;
                new_index.insert(key.clone(), Location { seg: new_id, offset: pos, len: bytes.len() as u64 });
                pos += bytes.len() as u64;
            }
        }
        w.flush()?;
        w.get_ref().sync_all()?;
    }   // Drop 关闭文件

    fs::rename(&tmp_path, &Self::seg_path(&self.dir, new_id))?;

    // 删除旧段
    // ...

    // 合并出来的段是**只读**的，必须登记进 frozen，否则后续读会找不到段
    self.frozen.insert(new_id, File::open(&final_path)?);

    // 重建活跃段
    // ...
    self.save_manifest()?;
    Ok(reclaimed)
}
```

**断电分析表**（每一步都要能回答"此时断电会怎样"）：

| 步骤 | 断电后果 |
|------|----------|
| 1. 写到临时文件 | 临时文件是垃圾，旧数据完好 |
| 2. fsync 临时文件 | 同上 |
| 3. `rename` 覆盖 | 原子操作，要么全成要么全不成 |
| 4. 更新内存索引 | 纯内存操作（进程死了就重放） |
| 5. 删除旧段文件 | 最多留下垃圾文件，下次启动扫描时清理 |

**最容易漏的一步**：合并出来的段是**只读**的，必须登记进 `frozen`。忘了的话索引指向了新段、但段句柄表里没有它，读的时候会报"找不到段"。

> **compaction 前忘记 fsync 也是个经典 bug**：索引里的 offset 指向的数据还在缓冲区里，读出来会被误判成损坏。

### 9.8 借用检查器会逼你重构：拆自由函数

Java 开发者会本能地把重放逻辑写成 `SegmentEngine` 的私有方法。在 Rust 里这常常**编译不过**——因为方法里既想读 `self` 的字段，又想 `&mut self.index`，两个借用冲突。

**正解是拆成自由函数**：

```rust
// ✅ 自由函数：只借用需要的部分
fn replay_segment(
    file: &File,
    seg_id: u64,
    index: &mut HashMap<String, Location>,
    path: &Path,
) -> Result<(u64, u64)> {
    // ...
}
```

"把需要独占借用的部分拆出去"是化解借用冲突最干净的手段，比 `RefCell` 之类运行时检查好得多——后者会让类型变成 `!Sync`，第 10 章就哭了。

> 这是 Rust 和 Java 一个很不同的设计压力：**Java 鼓励你把一切塞进对象方法；Rust 鼓励你用自由函数显式声明"我只借用什么"**。

### 9.9 惰性迭代器与生命周期

```rust
pub fn iter(&self) -> impl Iterator<Item = Result<(String, Vec<u8>)>> + '_ {
    let mut keys: Vec<&String> = self.index.keys().collect();
    keys.sort();
    keys.into_iter().map(move |k| {
        let loc = self.index[k];
        // 这里借用 self（不可变），编译器保证迭代期间没人能 &mut self
        match self.read_at(loc) {
            Ok(Some(v)) => Ok((k.clone(), v)),
            Ok(None) => Err(KvError::KeyNotFound { key: k.clone() }),
            Err(e) => Err(e),
        }
    })
}
```

- `impl Iterator` 让调用方可以 `.map()` `.filter()` `.take()` 组合，编译后通常内联成一个手写循环
- `+ '_` 表示"这个迭代器借用了 `self`"，所以**不能比 `self` 活得久**

Java 的 `Stream` 做不到"借用检查"：你必须自己保证流没被逃逸出去。

测试里有一行专门证明惰性：

```rust
let first: Vec<_> = e.iter().take(1).collect();
assert_eq!(first.len(), 1);   // 只处理了一个元素
```

### 9.10 Java 对照

| 概念 | Java | Rust |
|------|------|------|
| 目录扫描 | `Files.list(dir)` 返回 `Stream<Path>` | `fs::read_dir` 返回 `Result<DirEntry>` 迭代器 |
| 原子替换 | `Files.move(src, dst, ATOMIC_MOVE)` | `fs::rename`（同一文件系统内原子） |
| 配置文件 | Jackson `readValue(new File(...))` | `serde_json::from_reader` |
| 资源持有 | `Map<Long, RandomAccessFile>` + 手动 close | `BTreeMap<u64, File>`，**结构体析构即全部关闭** |
| 迭代器 | `Iterator<T>`（对象，一次性） | `impl Iterator<Item = T>`（零成本，可组合） |
| 延迟计算 | `Stream`（有装箱开销） | `Iterator`（单态化，通常编译成裸循环） |

### 9.11 验证

```bash
$ cargo test --lib stage6
running 4 tests
test stage6_compact::tests::compaction_reclaims_space ... ok
test stage6_compact::tests::crash_mid_write_is_recoverable ... ok
test stage6_compact::tests::iterator_is_lazy_and_borrows_self ... ok
test stage6_compact::tests::segment_roll_and_recovery ... ok
test result: ok. 4 passed
```

四个测试分别覆盖：**段滚动 + 重启恢复**、**compaction 回收空间**、**断电半包可恢复**、**迭代器惰性**。

`crash_mid_write_is_recoverable` 的写法值得学习——它手动往文件尾部追加半个损坏的帧来模拟断电：

```rust
let mut f = OpenOptions::new().append(true).open(&seg)?;
f.write_all(&[0x4D, 0x44, 0x42, 0x31, 0x01, 0x00])?;   // 魔数 + 残缺长度
f.sync_all()?;
```

然后重开，验证好数据还在、坏尾巴被截掉。**这是测试崩溃恢复最实用的手法**。

### 9.12 练习

1. 把 `SEGMENT_MAX_BYTES` 调小到 4 KiB，用 `--exec` 写 1000 条数据，观察生成了多少个段文件，然后看 `manifest.json`。
2. 实现后台自动合并：写一个线程每 10 秒检查 `garbage_ratio()`，超过阈值就合并（第 10 章的 `spawn_compactor` 已经实现了，**先自己写一遍再对照**）。
3. **延伸**：给 compaction 加"节流"——限制每秒最多重写多少字节，避免合并拖垮前台读写。思考这个信号量该用什么类型。

---

## 10. 阶段 7：并发安全 —— Arc、RwLock 与 Send/Sync

**目标**：让引擎能被多个线程同时访问，并把它包装成一个 TCP 服务器。这是 Rust 最"值回票价"的部分。

**验收标准**：

```bash
$ cargo test --lib stage7
running 5 tests ... ok
```

### 10.1 涉及文件

`src/stage7_concurrent.rs`

### 10.2 Send / Sync 是什么

| 概念 | 含义 |
|------|------|
| `Send` | `T` 的所有权可以转移到另一个线程 |
| `Sync` | `&T` 可以同时被多个线程持有（即 `T: Send` 的引用版本） |

它们是 **auto trait**：编译器根据你的字段自动推导，不需要手写。于是"这个对象能不能跨线程用"这个问题，从**运行时的祈祷**变成了**编译期的证明**。

对照一下：Java 里 `ArrayList` 跨线程用会不会出问题？会，但编译器不管，只有线上报警才知道。`@ThreadSafe` 只是个注解/约定。

### 10.3 共享句柄

```rust
#[derive(Clone)]
pub struct SharedEngine {
    inner: Arc<RwLock<Engine>>,
}
```

- `Arc` ≈ Java 的"共享引用"，但它是**原子引用计数**的，且**不可变**——你拿不到 `&mut T`，所以必须配合 `RwLock`/`Mutex` 才能改数据
- 这就是 Rust 的核心设计：**共享不可变，可变不共享**
- `#[derive(Clone)]` 只增加引用计数，不拷贝引擎。所以 `clone()` 在这里非常便宜（一次原子加法），和 Java 里 `clone()` 通常意味着深拷贝的直觉**完全不同**

### 10.4 自动选择读锁 / 写锁

```rust
fn with_read<F, R>(&self, f: F) -> R where F: FnOnce(&Engine) -> R {
    let guard = self.inner.read().unwrap_or_else(std::sync::PoisonError::into_inner);
    f(&guard)
}

fn with_write<F, R>(&self, f: F) -> R where F: FnOnce(&mut Engine) -> R {
    let mut guard = self.inner.write().unwrap_or_else(std::sync::PoisonError::into_inner);
    f(&mut guard)
}

pub fn apply_cmd(&self, cmd: Command) -> Response {
    if is_read_only(&cmd) {
        self.with_read(|e| apply_read(e, cmd))     // 读锁：可并发
    } else {
        self.with_write(|e| apply(e, cmd))         // 写锁：独占
    }
}
```

**锁守卫（guard）是 RAII 的**：离开作用域自动解锁，**不可能忘记**。Java 里对应的样板代码是：

```java
lock.readLock().lock();
try {
    // ...
} finally {
    lock.readLock().unlock();   // 忘了就死锁
}
```

**锁中毒（poisoning）**是 Rust 独有的机制：如果上一个持锁的线程 panic 了，Rust 会把锁标记为"中毒"并返回 `Err`，逼你正视"数据可能处于不一致状态"。这里选择 `into_inner()` 继续服务（相信数据仍可用），但**你得显式做出这个选择**。

> Java 完全没有这个机制：`synchronized` 块里抛 `Error` 后锁照样释放，状态坏没坏没人知道。

### 10.5 后台合并线程

```rust
pub fn spawn_compactor(&self, every: Duration) -> (Arc<AtomicBool>, JoinHandle<()>) {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = Arc::clone(&stop);

    let handle = {
        let this = self.clone();
        thread::spawn(move || {          // move 把所有权移进线程
            while !stop_clone.load(Ordering::Relaxed) {
                thread::sleep(every);
                let ratio = this.with_read(Engine::garbage_ratio);
                if ratio > 0.3 {
                    this.with_write(|e| {
                        if let Err(err) = e.compact() { log::error!("合并失败: {err}"); }
                    });
                }
            }
        })
    };
    (stop, handle)
}
```

- `Arc<AtomicBool>` 是最简单的"停止信号"。**不需要 `volatile`**（Java 里必须），因为 `Ordering` 明确指定了内存序
- `move` 闭包：少了它就会编译报错（E0373: closure may outlive the current function），因为闭包可能比当前函数活得久
- Java 的 lambda 只要求 effectively final，但捕获的是引用，对象被多线程共享的状态没人管

### 10.6 阻塞式 TCP 服务器

```rust
pub fn bind_blocking(addr: &str, engine: SharedEngine) -> Result<(SocketAddr, JoinHandle<()>)> {
    let listener = TcpListener::bind(addr)?;
    let local = listener.local_addr()?;
    let handle = thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(s) => {
                    let eng = engine.clone();
                    thread::spawn(move || {          // 每连接一个线程
                        if let Err(e) = handle_conn(s, &eng) {
                            log::debug!("连接结束: {e}");
                        }
                    });
                }
                Err(e) => log::error!("accept 失败: {e}"),
            }
        }
    });
    Ok((local, handle))
}
```

Rust 的 OS 线程栈默认 2 MiB 且**按需提交**（虚拟内存），几千个连接也能扛——但仍不如第 11 章的异步方案省资源。

连接处理里有个小细节：

```rust
// 同一个 TcpStream 既要读又要写：Rust 要求 &mut 才能写
let mut reader = BufReader::new(stream.try_clone()?);
let mut writer = stream;

loop {
    line.clear();                          // 复用缓冲区，避免每行都分配
    let n = reader.read_line(&mut line)?;
    if n == 0 { break; }
    // ...
}
```

### 10.7 编译器会教你的三件事

源码里注释了三个**编译不过**的并发反例：

**❌ 反例 1：用 `Rc`（非原子引用计数）跨线程**

```rust
let data = Rc::new(vec![1, 2, 3]);
std::thread::spawn(move || {           // ❌ E0277: `Rc<Vec<i32>>` cannot be sent
    println!("{data:?}");
});
```

✅ 修复：换成 `Arc`。**编译器一句话告诉你问题在哪**，Java 里这只能靠 Code Review 发现。

**❌ 反例 2：闭包忘了 `move`**

```rust
let engine = String::from("engine");
std::thread::spawn(|| {                // ❌ E0373: closure may outlive the current function
    println!("{engine}");
});
```

**❌ 反例 3：把 `MutexGuard` 发送到别的线程**

```rust
let guard = m.lock().unwrap();
std::thread::spawn(move || {           // ❌ E0277: `MutexGuard` is not `Send`
    println!("{guard}");
});
```

✅ 修复：锁必须在**同一个作用域内**释放，不能跨线程转移所有权。

### 10.8 Java 对照

| Java | Rust |
|------|------|
| `ConcurrentHashMap` | `Arc<RwLock<HashMap<..>>>`（或 `dashmap::DashMap`） |
| `synchronized (this)` | `MutexGuard`（守卫离开作用域自动解锁） |
| `ReadWriteLock` + try/finally | `RwLock`（守卫自动释放，finally 是多余的） |
| `ExecutorService` + `Future` | `std::thread::spawn` + `JoinHandle`（1:1 OS 线程） |
| `@ThreadSafe` 只是注解/约定 | `Send`/`Sync` 是**编译期证明** |
| 锁中毒无感知 | `lock()` 返回 `Err(PoisonError)`，逼你正视 |
| `volatile boolean` 停止标志 | `Arc<AtomicBool>` + 显式 `Ordering` |
| lambda 只要求 effectively final | 闭包必须 `move`，否则编译报错 |

### 10.9 验证

```bash
$ cargo test --lib stage7
running 5 tests
test stage7_concurrent::tests::compactor_can_be_stopped ... ok
test stage7_concurrent::tests::concurrent_writes_are_consistent ... ok
test stage7_concurrent::tests::protocol_error_does_not_kill_connection ... ok
test stage7_concurrent::tests::read_locks_are_shared ... ok
test stage7_concurrent::tests::tcp_server_roundtrip ... ok
test result: ok. 5 passed
```

`concurrent_writes_are_consistent` 让 8 个线程各写 100 个 key，最后校验 800 个都在：

```rust
let resp = engine.apply_cmd(Command::Keys { prefix: String::new() });
let Response::Keys(keys) = resp else { panic!("期望 Keys 响应") };
assert_eq!(keys.len(), 800, "并发写入丢失了数据");
```

Java 里用 `HashMap` 这么干会得到丢失更新或 `ConcurrentModificationException`；Rust 里**编译期就保证了不会**。

`protocol_error_does_not_kill_connection` 体现了另一个优势：

```rust
assert!(matches!(engine.apply_line("NOPE"), Response::Error(_)));
assert_eq!(engine.apply_line("PING"), Response::Pong);   // 服务照常可用
```

对比 Java：如果 handler 里抛出未捕获异常，线程直接死掉，连接就断了。Rust 里 `Result` 强制你在**出问题的地方**就地处理。

### 10.10 练习

1. 把 `SharedEngine` 改成 `Arc<Mutex<Engine>>`（读写都用互斥锁），跑同一个并发测试，用 `Instant` 对比吞吐差异。
2. 故意写一个死锁：两个线程以相反顺序获取两把锁。观察它如何卡住（`Mutex` 没有超时；想一想为什么 Rust 社区更推崇「消息传递」而不是「共享内存 + 锁」）。
3. **延伸**：引入 `dashmap` 替换 `RwLock<HashMap>` 作为索引层，benchmark 一下高并发读的提升幅度。

---

## 11. 阶段 8：异步 —— tokio、Future 与 Actor 模式

**目标**：用 tokio 重写服务器，支持**上万并发连接**而不靠"一连接一线程"。这是 Java 开发者最容易踩坑的一章，因为心智模型和虚拟线程/线程池**完全不同**。

**验收标准**：

```bash
$ cargo test --lib stage8
running 3 tests ... ok

$ cargo run --bin minidb-server
minidb 监听 127.0.0.1:6379，数据目录 ./minidb-data
```

### 11.1 涉及文件

`src/stage8_async.rs`、`src/bin/minidb-server.rs`

### 11.2 三条必须记住的坑

在写代码之前，先把这三条刻进脑子：

1. **Future 是惰性的**：`let f = some_async_fn();` **什么都不会发生**，必须 `.await`。Java 的 `CompletableFuture.supplyAsync()` 提交即执行——这是最大的直觉冲突。
2. **async 里不能用 `std::sync::Mutex` 长时间持锁**，更不能跨 `.await` 持有——会导致整个 worker 线程被阻塞。要用 `tokio::sync::Mutex`，或干脆用消息传递。
3. **CPU 密集或阻塞 IO 要用 `spawn_blocking`**，否则会拖垮整个 reactor。

### 11.3 为什么选 Actor 模式

引擎是"带阻塞磁盘 IO 的状态"。在 async 里直接持有它，每一条命令都会阻塞 worker 线程。

**Actor 模式的解法**：让**单个 OS 线程**独占引擎，其他人通过消息访问它。

```
   tokio task A ─┐
   tokio task B ─┼─→ mpsc channel ─→ [ 专用 OS 线程 ] ─→ Engine
   tokio task C ─┘                          │
        ↑                                   │
        └────────── oneshot ────────────────┘
```

好处：

- 引擎永远只被一个 OS 线程持有 → **根本不需要锁**
- 客户端通过 channel 发消息，用 `oneshot` 收回响应
- async 侧 `.await` 结果，不阻塞 tokio 的 worker

Java 对照：这就是 Akka/Erlang 的 actor，或 `Executors.newSingleThreadExecutor()` + `CompletableFuture`。区别是 Rust 用**类型系统**保证引擎不会被两个线程同时拿到。

### 11.4 消息与句柄

```rust
enum Msg {
    ReadOnly(Command, oneshot::Sender<Response>),
    Write(Command, oneshot::Sender<Response>),
    Shutdown,
}

#[derive(Clone)]
pub struct EngineHandle {
    tx: Sender<Msg>,        // std::sync::mpsc 的同步 Sender
}

impl EngineHandle {
    pub async fn send(&self, cmd: Command) -> Result<Response> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let msg = if is_read_only(&cmd) {
            Msg::ReadOnly(cmd, resp_tx)
        } else {
            Msg::Write(cmd, resp_tx)
        };

        // actor 线程一直在 recv() 上等着，所以 send 几乎立刻返回，不阻塞 reactor
        self.tx.send(msg).map_err(|_| KvError::Closed)?;

        // 这里 await 的是 tokio 的 oneshot，**不会占用线程**
        resp_rx.await.map_err(|_| KvError::Closed)
    }
}
```

**注意这里混用了两种 channel**：

- `std::sync::mpsc`（同步）发命令：actor 线程一直在 `recv()` 上阻塞等着，所以发送几乎立刻返回
- `tokio::sync::oneshot`（异步）收响应：`.await` 挂起任务而不阻塞线程

这是"同步原语 + 异步接口"混合的经典写法。`EngineHandle` 内部只有一个 `Sender`，所以它是 `Send + Sync` 的，想送进 `tokio::spawn` 的任务里毫无阻碍。

### 11.5 启动 actor

```rust
pub fn spawn_engine_actor<P: AsRef<Path>>(dir: P) -> Result<(EngineHandle, JoinHandle<()>)> {
    let dir: PathBuf = dir.as_ref().to_path_buf();
    // 先在**当前线程**打开引擎（open 失败能立刻返回 Err，不用跨线程传错误）
    let engine = Engine::open(&dir)?;
    let (tx, rx) = channel::<Msg>();

    let handle = thread::spawn(move || {
        let mut engine = engine;
        loop {
            match rx.recv() {
                Ok(Msg::ReadOnly(cmd, resp)) => { let r = apply_read(&engine, cmd); let _ = resp.send(r); }
                Ok(Msg::Write(cmd, resp))    => { let r = apply(&mut engine, cmd);   let _ = resp.send(r); }
                Ok(Msg::Shutdown) => {
                    if let Err(e) = engine.close() { log::error!("关闭引擎失败: {e}"); }
                    break;
                }
                Err(_) => break,   // 所有发送端都 drop 了 → 退出
            }
        }
    });

    Ok((EngineHandle { tx }, handle))
}
```

**为什么用独立 OS 线程而不是 `tokio::task::spawn_blocking`？** 因为引擎的生命周期和整个服务一样长，且有状态；一个常驻线程比反复 `spawn_blocking` 更清晰、也更省。

### 11.6 tokio TCP 服务器

```rust
pub async fn bind_async(addr: &str, handle: EngineHandle) -> Result<SocketAddr> {
    let listener = TcpListener::bind(addr).await?;
    let local = listener.local_addr()?;
    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((socket, peer)) => {
                    let h = handle.clone();
                    tokio::spawn(async move {          // spawn 一个**任务**，不是线程
                        if let Err(e) = handle_conn(socket, h).await {
                            log::debug!("连接结束: {e}");
                        }
                    });
                }
                Err(e) => log::error!("accept 失败: {e}"),
            }
        }
    });
    Ok(local)
}

async fn handle_conn(socket: TcpStream, handle: EngineHandle) -> Result<()> {
    let (reader, mut writer) = socket.into_split();
    let mut lines = BufReader::new(reader).lines();

    while let Some(line) = lines.next_line().await? {
        let resp = match Command::parse(&line) {
            Ok(cmd) => handle.send(cmd).await?,
            Err(e) => Response::Error(e.to_string()),
        };
        writer.write_all(resp.encode().as_bytes()).await?;
        writer.flush().await?;      // 必须 flush：tokio 的 write 也是先写进缓冲
    }
    Ok(())
}
```

`BufReader::lines()` 是 tokio 提供的**异步**行读取：读到半行时会挂起当前任务、让出线程给其他任务。**这是异步 IO 的核心价值：一个线程能同时"等"上万个 socket。**

对比内存开销：1 万个连接用任务方案约几十 MB，用线程方案要 20 GB+。

### 11.7 二进制入口

```rust
#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();
    let cli = Cli::parse();

    let (handle, actor_thread) = spawn_engine_actor(&cli.dir)?;
    let addr = bind_async(&cli.addr, handle.clone()).await?;
    println!("minidb 监听 {addr}，数据目录 {}", cli.dir.display());

    tokio::signal::ctrl_c().await?;        // ≈ Runtime.addShutdownHook()
    println!("收到 SIGINT，正在优雅关闭...");

    handle.shutdown();
    // join 一个 OS 线程会阻塞 worker，所以放 spawn_blocking
    let _ = tokio::task::spawn_blocking(move || actor_thread.join()).await;

    Ok(())
}
```

注意最后那行 `spawn_blocking`——**这是本章第 3 条铁律的示范**：`JoinHandle::join()` 是阻塞调用，直接放在 async 里会卡死 worker 线程。退出路径上短暂阻塞尚可接受，但也最好包一层。

### 11.8 反面教材：在 async 里做阻塞 IO

这段代码能编译，但会把 tokio 的 worker 线程卡住，吞吐量直接崩掉：

```rust
std::thread::sleep(Duration::from_secs(1));            // ❌ 阻塞整个 worker
tokio::time::sleep(Duration::from_secs(1)).await;      // ✅ 正确
```

同理，`std::sync::Mutex` 在 async 里跨 `.await` 持锁也是禁止的：任务被挂起时锁没释放，另一个任务再拿同一把锁就会**死锁整个线程池**。

三种正确做法：

1. 缩短临界区，不在持锁时 `.await`
2. 用 `tokio::sync::Mutex`
3. 用消息传递（本文件的 Actor 方案）

### 11.9 Java 对照

| Java | Rust |
|------|------|
| `CompletableFuture<T>` | `Future<Output = T>`（但是**惰性的**） |
| `supplyAsync()` 立刻在线程池跑 | `async fn` 只是构造状态机，**不 `.await` 就不执行** |
| `ExecutorService`（JDK 自带） | 标准库**没有**运行时，必须选 tokio / async-std / smol / glommio |
| Project Loom 虚拟线程（JDK 21） | 没有内建等价物；但 Future 更轻（几百字节的状态机），代价是"async 染色" |
| `BlockingQueue` 传递消息 | `tokio::sync::mpsc`（有界/无界 channel） |
| Akka Actor | 手写的小模式（本项目约 60 行） |

### 11.10 验证

```bash
$ cargo test --lib stage8
running 3 tests
test stage8_async::tests::actor_handles_commands ... ok
test stage8_async::tests::async_server_roundtrip ... ok
test stage8_async::tests::concurrent_requests_via_actor ... ok
test result: ok. 3 passed
```

端到端手测：

```bash
# 终端 1
$ cargo run --bin minidb-server -- --dir ./data --addr 127.0.0.1:6379

# 终端 2
$ printf 'SET a 1\r\nGET a\r\n' | nc 127.0.0.1 6379
+OK
$1
1
```

> Windows 上没有 `nc`？用 `telnet`，或者写一行 Rust/Python 的 TCP 客户端。也可以直接跑 `cargo test --lib stage8`，里面有完整的端到端测试。

> **关于 `#[tokio::test]`**：它默认是**单线程**运行时。有些依赖多线程的代码行为会不同，需要显式写 `#[tokio::test(flavor = "multi_thread")]`。这是 Rust 异步测试最常见的坑之一。

### 11.11 练习

1. 在 `handle_conn` 里加一行 `std::thread::sleep(Duration::from_secs(1))`，用两个并发连接压测，观察第二个连接如何被拖住。再换成 `tokio::time::sleep` 对比。
2. 把 mpsc channel 换成**有界**的（`sync_channel(1024)`），思考背压（backpressure）在这个架构里怎么传递。
3. **延伸**：实现完整的优雅关闭——收到 SIGINT 时先停止 accept，等已有连接处理完，最后发送 `Msg::Shutdown` 并 join actor 线程。

---

## 12. 阶段 9：整合打磨与完整可运行示例

**目标**：把前面 8 个阶段的产物整合成**生产形态的公开 API**，加上可观测的统计指标，最后跑通一个端到端的完整示例。

**验收标准**：

```bash
$ cargo test                                    # 45 个测试全绿
$ cargo test --release -- --ignored --nocapture # 性能冒烟通过
$ cargo run --example mini_kv                   # 单文件完整示例跑通
```

### 12.1 涉及文件

`src/engine.rs`、`src/bin/minidb-cli.rs`、`src/bin/minidb-server.rs`、`examples/mini_kv.rs`

### 12.2 Engine：组合而不是继承

```rust
pub struct Engine {
    inner: SegmentEngine,   // 持有，而不是 extends
    stats: Stats,
    config: Config,
    started_at: Instant,
}
```

**设计要点：组合而不是继承。** `Engine` 持有 `SegmentEngine`，只暴露想暴露的方法。Rust 没有 `extends`，也就没有"父类改了子类崩"的问题。

对外只暴露这些方法：

```rust
impl Engine {
    pub fn open(dir: impl AsRef<Path>) -> Result<Self>;
    pub fn with_config(dir: impl AsRef<Path>, config: Config) -> Result<Self>;
    pub fn get(&self, key: &str) -> Result<Option<Vec<u8>>>;
    pub fn set(&mut self, key: &str, value: impl Into<Vec<u8>>) -> Result<()>;
    pub fn delete(&mut self, key: &str) -> Result<Option<Vec<u8>>>;
    pub fn exists(&self, key: &str) -> Result<bool>;
    pub fn keys(&self, prefix: &str) -> Result<Vec<String>>;
    pub fn compact(&mut self) -> Result<u64>;
    pub fn stats(&self) -> &Stats;
    pub fn uptime(&self) -> std::time::Duration;
    pub fn garbage_ratio(&self) -> f64;
    pub fn close(self) -> Result<()>;
}
```

`set` 的参数是 `impl Into<Vec<u8>>`：调用方可以传 `Vec<u8>`、`&[u8]`、`String`，不需要像 Java 那样写三个重载。

### 12.3 配置：Rust 里不需要建造者模式

```rust
#[derive(Debug, Clone)]
pub struct Config {
    pub segment_max_bytes: u64,
    pub compact_threshold: f64,
}

impl Default for Config {
    fn default() -> Self {
        Self { segment_max_bytes: 64 * 1024 * 1024, compact_threshold: 0.3 }
    }
}
```

**为什么不用 `@Builder`？** 因为结构体字面量 + `..Default::default()` 就能表达"只覆盖关心的字段"：

```rust
let config = Config { compact_threshold: 0.5, ..Config::default() };
```

而且**编译器会检查字段是否齐全**——建造者模式在 Java 里解决的"可选参数"问题，在 Rust 里由 `Default` + 结构体更新语法解决。

> 需要**必填字段**时才用 builder（比如 `typed-builder` crate）。大部分场景下 `Default` 就够了。

### 12.4 统计指标

```rust
#[derive(Debug, Default, Serialize)]
pub struct Stats {
    pub gets: AtomicU64,
    pub sets: AtomicU64,
    pub deletes: AtomicU64,
    pub compactions: AtomicU64,
}

impl Stats {
    fn incr(c: &AtomicU64) {
        c.fetch_add(1, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> StatsSnapshot {
        StatsSnapshot {
            gets: self.gets.load(Ordering::Relaxed),
            // ...
        }
    }
}
```

- `AtomicU64` ≈ `AtomicLong` / `LongAdder`，语义基本一致
- `Ordering::Relaxed` 只保证原子性、不保证顺序——计数器场景够用了，比 `SeqCst` 便宜
- `#[derive(Serialize)]` 让你能直接把快照导出成 JSON（`AtomicU64` 也能序列化）
- 导出**快照**而不是直接暴露原子量：读取时各字段是同一时刻的一致视图

### 12.5 为什么 `apply` 和 `apply_read` 要拆成两个函数

```rust
pub fn apply(engine: &mut Engine, cmd: Command) -> Response;       // 需要写锁
pub fn apply_read(engine: &Engine, cmd: Command) -> Response;      // 只需要读锁
```

两个理由：

1. **并发服务器要靠它区分读锁和写锁**（第 10 章的 `apply_cmd`）。只读命令拿 `RwLock::read()` 可以并发执行；写命令才需要独占的 write 锁。Java 里通常靠 `@Transactional(readOnly = true)` 这类**约定**，Rust 直接把"可并发"写进了函数签名。
2. **协议处理和引擎实现解耦**。第 10 章（线程服务器）和第 11 章（异步服务器）复用同一个函数，保证两种服务器行为完全一致——这在测试上很有价值。

**错误处理策略**：把 `Err` 转成 `Response::Error` 而不是向上传播。协议层的错误应该回给客户端，而不是让整个进程退出。

### 12.6 完整的 CLI

```rust
fn main() -> Result<()> {
    env_logger::init();   // 日志实现只在二进制里初始化（库只依赖 log facade）

    let cli = Cli::parse();
    let mut engine = Engine::open(&cli.dir)?;

    if cli.compact {
        let reclaimed = engine.compact()?;
        println!("合并完成，回收 {reclaimed} 字节");
    }

    if let Some(line) = cli.exec {
        // 单命令模式：适合脚本调用（≈ redis-cli SET a 1）
        print!("{}", run(&mut engine, &line));
        io::stdout().flush()?;
    } else {
        // 交互 REPL 模式
        for line in io::stdin().lock().lines() {
            let line = line?;
            let is_quit = line.trim().eq_ignore_ascii_case("QUIT");
            print!("{}", run(&mut engine, &line));
            io::stdout().flush()?;   // 不加这行交互时看不到输出
            if is_quit { break; }
        }
    }

    engine.close()?;   // 显式关闭：fsync 可能失败，Drop 没法告诉你
    Ok(())
}
```

### 12.7 性能要点

1. **能借用就别拷贝**：`get(&self, key: &str)` 而不是 `get(&self, key: String)`
2. **预分配容量**：`Vec::with_capacity`、`HashMap::with_capacity`
3. **一定要用 release 构建**：`cargo build --release`，debug 版慢数倍到数十倍
4. **热路径避免锁竞争**：见第 10、11 章的并发设计
5. **零拷贝读**：真实引擎会用 `mmap` 或 `Bytes`（引用计数切片）避免 `Vec` 拷贝

性能冒烟测试（默认被 `#[ignore]` 跳过）：

```rust
#[test]
#[ignore = "性能测试，用 --release 运行"]
fn write_throughput_smoke() {
    let start = Instant::now();
    for i in 0..20_000u64 {
        e.set(&format!("key{i}"), b"value".to_vec()).unwrap();
    }
    let qps = 20_000.0 / start.elapsed().as_secs_f64();
    println!("写入 20000 条耗时 {elapsed:?}，约 {qps:.0} ops/s");
    assert!(qps > 1000.0, "写入性能异常（是不是忘了 --release？）");
}
```

> ≈ JMH 的简化版：**先看量级对不对，再决定要不要上 `criterion`**。断言里的错误提示直接写了"是不是忘了 --release"，因为这是最常见的误判来源。

### 12.8 可运行示例 A：跑完整项目

```bash
cd tracks/rust/projects/minidb

# ① 全量测试（39 单元 + 6 集成 + 1 忽略）
cargo test
# test result: ok. 39 passed; 0 failed; 1 ignored
# test result: ok. 6 passed; 0 failed        ← tests/integration.rs

# ② 单命令模式
cargo run --bin minidb-cli -- --dir ./data --exec "SET name minidb"
# +OK
cargo run --bin minidb-cli -- --dir ./data --exec "GET name"
# $6
# minidb
cargo run --bin minidb-cli -- --dir ./data --exec "KEYS "
# *1
# $4
# name

# ③ 交互模式
cargo run --bin minidb-cli -- --dir ./data
# minidb 交互模式，输入 QUIT 退出
# 支持: SET/GET/DEL/EXISTS/KEYS/PING/COMPACT
minidb> SET user:1 alice
# +OK
minidb> KEYS user:
# *1
# $6
# user:1
minidb> QUIT
# +OK

# ④ 异步 TCP 服务器
cargo run --bin minidb-server -- --dir ./data --addr 127.0.0.1:6379
# 另开终端：printf 'SET a 1\r\nGET a\r\n' | nc 127.0.0.1 6379

# ⑤ 手动触发合并
cargo run --bin minidb-cli -- --dir ./data --compact --exec "PING"

# ⑥ 性能冒烟（务必 --release）
cargo test --release -- --ignored --nocapture
```

### 12.9 可运行示例 B：单文件最小版 `mini_kv.rs`

如果你想**彻底搞懂 Bitcask 的骨架**，最好的办法是看一个去掉了所有"工程放大器"的版本。

`examples/mini_kv.rs` 就是这样的东西：**约 200 行、只依赖标准库**，保留了 5 个核心机制——append-only 日志、内存哈希索引、重启重放、CRC 校验 + 尾部截断、墓碑删除。

运行：

```bash
cargo run --example mini_kv
```

预期输出：

```text
== mini_kv 自验证 demo（数据文件: ./mini_kv_demo.db）==

[1] 写入完成，当前键: ["lang", "name"]
[2] 重启后键: ["lang", "name"]
    重放后数据完好 ✓
[recover] 发现损坏尾部，截断到 offset 130
[4] 崩溃恢复后仍可读写 ✓

[5] 数据文件大小: 162 字节
    用 `xxd ./mini_kv_demo.db | head` 可以看到 MKV1 魔数和 CRC32 尾部

全部断言通过 ✓
```

它也可以完全脱离 cargo，用 `rustc` 直接编译（因为零依赖）：

```bash
rustc examples/mini_kv.rs -o mini_kv && ./mini_kv
```

完整源码：

```rust
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;

/// 帧头魔数：用来快速判断"这里是不是一条合法记录"。
const MAGIC: [u8; 4] = *b"MKV1";
/// 定长头：magic(4) + key_len(4) + val_len(4)。
const HEADER_LEN: usize = 12;
/// 定长尾：crc32(4)。
const FOOTER_LEN: usize = 4;
/// `val_len` 取这个哨兵值时表示"删除墓碑"。
const TOMBSTONE: u32 = u32::MAX;

/// 一个最小可用的 Bitcask 引擎。
struct MiniKv {
    /// 读写句柄。真实引擎会用位置读取（`read_at`）避免文件游标竞争，
    /// 这里为了少几行代码用 seek + read，因此方法都是 `&mut self`。
    file: File,
    /// 键 -> (记录起始偏移, 记录总字节数)
    index: HashMap<String, (u64, u64)>,
    /// 下一次写入的位置（= 当前文件长度）。
    pos: u64,
}

impl MiniKv {
    /// 打开（或创建）数据文件，并在必要时重放日志重建索引。
    fn open(path: impl AsRef<Path>) -> io::Result<Self> {
        // 注意：**不用** append 模式，而是 read + write，写入前手动 seek 到文件末尾。
        // 原因（跨平台坑）：Windows 上 append 模式只申请了 FILE_APPEND_DATA 权限，
        // 没有 FILE_WRITE_DATA，于是 `set_len` 会报 PermissionDenied。
        // 完整版 minidb 的做法是"平时只读，截断时临时换一个写句柄"。
        let mut file = OpenOptions::new().create(true).read(true).write(true).open(path)?;
        let len = file.metadata()?.len();
        let mut index: HashMap<String, (u64, u64)> = HashMap::new();
        let mut pos = 0u64;

        // ---- 重放：索引不落盘，靠重放日志重建 ----
        while pos < len {
            match read_frame(&mut file, pos) {
                Ok(frame) => {
                    if frame.value.is_some() {
                        index.insert(frame.key, (pos, frame.consumed));
                    } else {
                        index.remove(&frame.key); // 墓碑：删除
                    }
                    pos += frame.consumed;
                }
                // 读到一个不完整/校验失败的帧：说明上次写了一半就崩了。
                // 日志是 append-only 的，所以坏的一定在最后，截断即可。
                Err(_) => {
                    eprintln!("[recover] 发现损坏尾部，截断到 offset {pos}");
                    file.set_len(pos)?;
                    file.sync_all()?;
                    break;
                }
            }
        }
        Ok(Self { file, index, pos })
    }

    fn set(&mut self, key: &str, value: &[u8]) -> io::Result<()> {
        self.append(key, Some(value))
    }

    fn delete(&mut self, key: &str) -> io::Result<()> {
        self.append(key, None)?;
        self.index.remove(key);
        Ok(())
    }

    fn append(&mut self, key: &str, value: Option<&[u8]>) -> io::Result<()> {
        let frame = encode_frame(key, value);
        let offset = self.pos;
        self.file.seek(SeekFrom::End(0))?; // 等价于 O_APPEND（单线程下安全）
        self.file.write_all(&frame)?;
        self.pos += frame.len() as u64;
        if value.is_some() {
            self.index.insert(key.to_owned(), (offset, frame.len() as u64));
        }
        Ok(())
    }

    /// 读取一个键。随机读 = 一次 seek + 一次顺序读。
    fn get(&mut self, key: &str) -> io::Result<Option<Vec<u8>>> {
        let Some(&(offset, _)) = self.index.get(key) else {
            return Ok(None);
        };
        Ok(read_frame(&mut self.file, offset)?.value)
    }

    fn keys(&self) -> Vec<String> {
        let mut out: Vec<String> = self.index.keys().cloned().collect();
        out.sort();
        out
    }

    fn close(self) -> io::Result<()> {
        self.file.sync_all()
    }
}

struct Frame {
    key: String,
    value: Option<Vec<u8>>,
    consumed: u64,
}

/// 编码一帧：[magic | key_len | val_len | key | value | crc32]
fn encode_frame(key: &str, value: Option<&[u8]>) -> Vec<u8> {
    let key_len = u32::try_from(key.len()).expect("key 太长");
    let val_len = value.map_or(TOMBSTONE, |v| u32::try_from(v.len()).expect("value 太长"));

    let mut buf = Vec::with_capacity(HEADER_LEN + FOOTER_LEN + key.len() + value.map_or(0, <[u8]>::len));
    buf.extend_from_slice(&MAGIC);
    buf.extend_from_slice(&key_len.to_le_bytes());
    buf.extend_from_slice(&val_len.to_le_bytes());
    buf.extend_from_slice(key.as_bytes());
    if let Some(v) = value {
        buf.extend_from_slice(v);
    }
    buf.extend_from_slice(&crc32(&buf).to_le_bytes());
    buf
}

/// 从指定偏移读取并校验一帧。
fn read_frame(file: &mut File, offset: u64) -> io::Result<Frame> {
    file.seek(SeekFrom::Start(offset))?;
    let mut header = [0u8; HEADER_LEN];
    file.read_exact(&mut header)?; // 读不满就返回 UnexpectedEof，调用方视为"损坏"

    if header[..4] != MAGIC {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "魔数不匹配"));
    }
    let key_len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    let val_len = u32::from_le_bytes([header[8], header[9], header[10], header[11]]);

    // 读不可信数据（磁盘上的字节）时必须有边界检查：
    // 直接 `vec![0; val_len]` 遇到损坏的长度字段会试图分配 4 GiB。
    let val_bytes = if val_len == TOMBSTONE { None } else { Some(val_len as usize) };
    let mut body = vec![0u8; key_len + val_bytes.unwrap_or(0)];
    file.read_exact(&mut body)?;
    let mut crc_bytes = [0u8; FOOTER_LEN];
    file.read_exact(&mut crc_bytes)?;

    // 校验和覆盖 header + key + value
    let mut check = Vec::with_capacity(HEADER_LEN + body.len());
    check.extend_from_slice(&header);
    check.extend_from_slice(&body);
    if crc32(&check) != u32::from_le_bytes(crc_bytes) {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "校验和不匹配"));
    }

    let key = String::from_utf8(body[..key_len].to_vec())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "key 不是合法 UTF-8"))?;
    let value = val_bytes.map(|n| body[key_len..key_len + n].to_vec());
    let consumed = (HEADER_LEN + FOOTER_LEN) as u64 + key_len as u64 + value.as_ref().map_or(0, |v| v.len() as u64);
    Ok(Frame { key, value, consumed })
}

// ---- CRC32（IEEE 802.3 多项式），查表在编译期生成 --------------------------

const fn build_crc_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut i = 0u32;
    while i < 256 {
        let mut c = i;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            k += 1;
        }
        table[i as usize] = c;
        i += 1;
    }
    table
}

static CRC_TABLE: [u32; 256] = build_crc_table();

fn crc32(data: &[u8]) -> u32 {
    let mut c = 0xFFFF_FFFFu32;
    for &b in data {
        c = CRC_TABLE[((c ^ u32::from(b)) & 0xFF) as usize] ^ (c >> 8);
    }
    c ^ 0xFFFF_FFFF
}

// ---- 自验证 demo -----------------------------------------------------------

fn main() -> io::Result<()> {
    let path = std::env::args().nth(1).unwrap_or_else(|| "./mini_kv_demo.db".to_owned());
    // 每次 demo 都从干净状态开始（忽略"文件不存在"这种预期错误）
    let _ = std::fs::remove_file(&path);
    println!("== mini_kv 自验证 demo（数据文件: {path}）==\n");

    // ---- 1. 写入 + 覆盖 + 删除 ----
    {
        let mut kv = MiniKv::open(&path)?;
        kv.set("name", b"minidb")?;
        kv.set("lang", b"rust")?;
        kv.set("name", b"minidb-v2")?; // 覆盖：旧记录变成垃圾
        kv.set("tmp", b"to-be-deleted")?;
        kv.delete("tmp")?; // 写墓碑
        println!("[1] 写入完成，当前键: {:?}", kv.keys());
        assert_eq!(kv.get("name")?.as_deref(), Some(b"minidb-v2".as_slice()));
        assert_eq!(kv.get("tmp")?, None);
        kv.close()?;
    }

    // ---- 2. 重启：索引靠重放重建 ----
    {
        let mut kv = MiniKv::open(&path)?;
        println!("[2] 重启后键: {:?}", kv.keys());
        assert_eq!(kv.get("name")?.as_deref(), Some(b"minidb-v2".as_slice()));
        assert_eq!(kv.get("lang")?.as_deref(), Some(b"rust".as_slice()));
        assert_eq!(kv.get("tmp")?, None, "删除的键不能复活");
        println!("    重放后数据完好 ✓");
        kv.close()?;
    }

    // ---- 3. 模拟断电：往文件尾部追加半个损坏的帧 ----
    {
        let mut f = OpenOptions::new().append(true).open(&path)?;
        f.write_all(b"MKV1\x02\x00")?; // 魔数 + 残缺长度
        f.sync_all()?;
    }

    // ---- 4. 恢复：好数据保留，坏尾巴被截断 ----
    {
        let mut kv = MiniKv::open(&path)?;
        assert_eq!(kv.get("name")?.as_deref(), Some(b"minidb-v2".as_slice()));
        kv.set("after", b"recovery-ok")?; // 恢复后还能继续写
        assert_eq!(kv.get("after")?.as_deref(), Some(b"recovery-ok".as_slice()));
        println!("[4] 崩溃恢复后仍可读写 ✓");
        kv.close()?;
    }

    // ---- 5. 数据文件长什么样 ----
    let size = std::fs::metadata(&path)?.len();
    println!("\n[5] 数据文件大小: {size} 字节");
    println!("    用 `xxd {path} | head` 可以看到 MKV1 魔数和 CRC32 尾部");
    println!("\n全部断言通过 ✓");
    Ok(())
}
```

**把它和完整版对比着读，你会看清楚"工程放大器"到底是什么：**

| mini_kv | 完整版 minidb | 为什么完整版需要它 |
|---------|--------------|-------------------|
| 单个日志文件 | 多段 + manifest + 滚动 | 单文件只会增长，无法增量回收 |
| 没有 compaction | 段合并 + 垃圾统计 | 覆盖写会产生垃圾，磁盘会爆 |
| `seek + read` | 位置读取 `read_at` | 多线程共享游标会互相踩 |
| 单线程 | `Arc<RwLock<>>` / Actor | 真实服务要并发 |
| 无服务器 | 同步 + 异步两种 TCP 服务 | 要能被远程访问 |
| 无统计 | `Stats` + `Config` | 线上要可观测、可调参 |

### 12.10 端到端验收清单

照着跑一遍，全绿说明你真的做出来了：

```bash
# 1. 全量测试
cargo test                                   # ok. 39 passed / ok. 6 passed
cargo clippy --all-targets                   # 无 error
cargo fmt --check                            # 无 diff

# 2. 持久化 + 重启
cargo run --bin minidb-cli -- --dir ./data --exec "SET a 1"
cargo run --bin minidb-cli -- --dir ./data --exec "GET a"      # $1 / 1

# 3. 删除不复活
cargo run --bin minidb-cli -- --dir ./data --exec "DEL a"
cargo run --bin minidb-cli -- --dir ./data --exec "EXISTS a"   # :0

# 4. 合并
cargo run --bin minidb-cli -- --dir ./data --compact --exec "PING"

# 5. 并发（集成测试已覆盖）
cargo test --test integration                # ok. 6 passed

# 6. 异步服务
cargo run --bin minidb-server -- --dir ./data &
printf 'PING\r\n' | nc 127.0.0.1 6379        # +PONG

# 7. 性能
cargo test --release -- --ignored --nocapture
```

### 12.11 练习

1. 引入 `criterion` 建立正式 benchmark，对比 debug vs release 的差距（通常是 10 倍以上）。
2. 给 `Config` 加上 `fsync_on_write: bool`，benchmark 开启前后（这是数据库最重要的一组权衡数字）。
3. **延伸**：实现 TTL——在帧格式里加一个 8 字节的 `expire_at`，读取时惰性删除，compaction 时物理清除。思考过期检查该放在读路径还是后台线程。

---

## 13. 常见问题、陷阱与调试方法

这一章是"踩坑合集"。前 8 条是**编译错误**（Rust 独有，Java 没有对应物），后 6 条是**运行时/工程问题**。

### 13.1 编译错误速查表

Rust 的编译器报错以"啰嗦但准确"著称。遇到报错**先完整读一遍**，它通常已经告诉你怎么改了。

| 错误码 | 典型信息 | 你在 Java 里会怎么写 | 修复 |
|--------|----------|---------------------|------|
| **E0502** | `cannot borrow X as mutable because it is also borrowed as immutable` | `var v = map.get(k); map.put(k2, v2);` | ① 用 `{}` 缩短借用作用域 ② `get_owned()` 拿所有权 ③ 先收集再修改 |
| **E0515** | `cannot return reference to local variable` | `return localObj;`（GC 兜底，没问题） | 返回值改成拥有所有权（`Vec<u8>` 而不是 `&[u8]`） |
| **E0382** | `use of moved value` | `var b = a;`（引用赋值，a 还能用） | ① `clone()`（真要两份）② `&a`（只是借用）③ 用 `Rc`/`Arc` 共享 |
| **E0277** | `X cannot be sent between threads safely` | 随便往线程池里丢对象 | 换 `Arc`（而不是 `Rc`）；检查类型是否 `Send + Sync` |
| **E0373** | `closure may outlive the current function` | lambda 捕获局部变量 | 闭包加 `move` |
| **E0597** | `borrowed value does not live long enough` | 把局部对象存进字段 | 存 `String` 而不是 `&str`；或加生命周期参数 |
| **E0308** | `mismatched types` | 自动装箱/向上转型 | 显式转换；注意 `&str` vs `String`、`&[u8]` vs `Vec<u8>` |
| **E0061** | `this function takes N arguments but M were supplied` | 重载会帮你选 | Rust 没有重载，改参数或用泛型 |

**四个标准修复手法**（按优先级）：

1. **缩短借用作用域** —— 最常用，NLL 会在最后一次使用后自动结束借用
2. **需要数据就拿所有权** —— `get_owned()` / `to_owned()` / `clone()`
3. **先收集再修改** —— 把借用和修改在时间上分开
4. **拆自由函数** —— 同时借用一个结构体的两个字段时最干净

> **不要急着上 `RefCell` / `Rc` / `clone()`。** 它们要么把错误推到运行期，要么引入不必要开销。**先读懂编译器的报错。**

### 13.2 陷阱 1：`String` 与 `&str` 混淆

| 你想表达 | 该用的类型 |
|----------|-----------|
| 函数只需要读一下字符串 | `&str` |
| 需要拥有数据（存进结构体、跨线程） | `String` |
| 结构体里存字符串 | `String`（不是 `&'a str`，除非你明确要借用） |
| 想兼容两种 | `impl AsRef<str>` |
| 路径 | `PathBuf` / `impl AsRef<Path>`，不要用 `String` |

**常见错误**：给结构体加生命周期参数 `struct Foo<'a> { name: &'a str }`。这通常意味着你想省一次分配，但会让整个结构体被生命周期"传染"。

> **先写 `String`，profile 之后再优化。**

`&String` 参数几乎永远是错的（clippy 的 `ptr_arg` 会警告），用 `&str`。

### 13.3 陷阱 2：用 `clone()` 当创可贴

编译器说 "value moved here"，第一反应往往是加 `.clone()`。**停下来问自己三个问题**：

1. 我真的需要两份数据吗？→ 多半只要借用 `&`
2. 是不是该把参数改成引用？→ `fn f(s: &str)` 而不是 `fn f(s: String)`
3. 是不是该用 `Cow<'_, T>`？→ 大部分时候不需要拷贝，偶尔需要

在热路径上，每一次 `clone()` 都是一次堆分配。本项目的 `Cargo.toml` 里开了 `clippy::clone_on_ref_ptr`（对 `Arc::clone` 误用报警）帮你盯着。

### 13.4 陷阱 3：异步运行时的选择

**这是 Java 开发者最容易低估的复杂度。** JVM 自带线程池，Rust 标准库**没有**运行时。

```text
只是 CLI / 批处理？
  └─ 不需要 async，直接同步代码（比什么都简单）
IO 密集（网络 / 大量并发连接）？
  └─ tokio（生态最大，axum / hyper / reqwest / sqlx 都基于它）
需要极致控制 & io_uring？
  └─ glommio / monoio
嵌入到已有事件循环？
  └─ smol / async-executor
```

**配套铁律**：

- CPU 密集或阻塞 IO → `tokio::task::spawn_blocking`
- async 里禁止用 `std::sync::Mutex` 跨 `.await` 持锁 → 改 `tokio::sync::Mutex`，或更好地：**用消息传递**（本项目的 Actor 就是例子）
- `#[tokio::test]` 默认是**单线程**运行时，需要显式 `#[tokio::test(flavor = "multi_thread")]`

### 13.5 陷阱 4：以为 `dyn Trait` 和 Java 接口一样便宜

```rust
fn f(x: &impl Trait)     // 静态分发：单态化，可内联 —— 默认选这个
fn f(x: &dyn Trait)      // 动态分发：vtable 查表 ≈ Java invokeinterface
```

**经验：默认泛型，需要异构集合或运行时切换实现时才用 `dyn`。**

另外注意：trait 方法必须 `use` 进来才能调用。这比 Java 麻烦，但它消灭了"两个接口都有同名方法、编译器悄悄帮你选了一个"这类问题。

### 13.6 陷阱 5：`unwrap()` 到处飞

```rust
let v = map.get(&k).unwrap();   // panic 风险
```

| 场景 | 正确写法 |
|------|---------|
| 库代码 | `Result` / `Option` 往外传 |
| 应用层主流程 | `?` 传播 |
| 真的"不可能失败" | `expect("这里不可能失败，因为 X")` —— **写下原因** |
| 测试代码 | `unwrap()` 完全 OK |

对比 Java：`Optional.get()` 会抛 `NoSuchElementException`。Rust 的 `unwrap` 会 panic。差别是 Rust 有 clippy lint 可以 `unwrap_used = "deny"` **全局禁掉**。

### 13.7 陷阱 6：`Box<dyn Error>` 大杂烩

```rust
// ❌ 库代码用这个，调用方只能靠 downcast_ref 猜类型
fn load(path: &str) -> Result<Data, Box<dyn Error>>;
```

```rust
// ✅ 库代码：定义 enum，让调用方能穷尽匹配
#[derive(Error)]
pub enum LoadError { Io(#[from] io::Error), Parse { line: usize, msg: String } }
```

```rust
// ✅ 应用层（bin）：anyhow 图快可以接受
use anyhow::Result;
```

**分界线很清楚：库定 enum，应用用 anyhow。**

### 13.8 陷阱 7：忘了 release 构建

Rust 的 debug 构建**非常慢**，通常是 release 的 5~50 倍差距。

```bash
cargo build --release              # 开启 LTO + 单一 codegen unit
cargo test --release -- --ignored  # benchmark 一定要 release
cargo bench                        # criterion
```

本项目 `Cargo.toml` 的 `[profile.release]` 已经配好 `lto = true`、`codegen-units = 1`、`panic = "abort"`。

### 13.9 陷阱 8：把 Java 的分层 / DI 设计照搬过来

- **不需要 DI 容器**：依赖显式传（`Engine::open(dir)`），依赖图一眼可见
- **不需要 `Repository<T>` 这种万能接口**：Rust 的 trait 更常用作能力约束（bounds）而不是运行时多态
- **不需要为每个 DTO 写 getter/setter**：字段 `pub` 就够了，没有"以后可能要加逻辑"这种 Java 式焦虑
- **模块 ≠ 类**：Rust 的可见性单位是模块，一个 `.rs` 文件里放几个小结构体比拆成 5 个文件更清楚

### 13.10 陷阱 9：整数溢出在 debug 下 panic

```rust
let x: u64 = 0;
x - 1;   // debug 构建 panic，release 构建静默回绕
```

Java 的 `long` 永远静默回绕。Rust 的 debug 溢出检查是**特性**不是 bug。需要回绕用 `wrapping_sub`，不确定时用 `checked_sub` / `saturating_sub`（`stage6_compact::replay_segment` 里就用了后者）。

### 13.11 陷阱 10：跨平台权限差异

这是本项目踩得最疼的一类，三个真实案例：

| 现象 | 平台差异 |
|------|----------|
| `set_len` 报 PermissionDenied | Windows 上只读/append 句柄没有 `FILE_WRITE_DATA`，Linux 不报错 |
| 无法删除仍打开的文件 | Windows 禁止；Linux 允许（所以锁文件要先 `take()` 关闭句柄再删） |
| `try_clone()` 共享文件游标 | 两个平台都一样坑，但表现是随机的"魔数不匹配" |

**对策**：跨平台代码里涉及文件截断/删除的地方，一律显式处理句柄权限；位置读取用 `read_at` / `seek_read` 而不是 `seek + read`。

### 13.12 运行时问题排查

| 症状 | 原因 | 排查 |
|------|------|------|
| `数据目录已被占用` | 上次进程被 `kill -9`，`LOCK` 残留 | 确认没有其它实例后删除 `LOCK` 文件；生产用 `fs2` 的 flock |
| 打开时报 `数据文件损坏` | 上次写了一半崩溃 | 这是**正常的恢复路径**，看日志里"已截断到 offset N"；确认好数据还在 |
| 随机出现"魔数不匹配" | 多线程共享文件游标（用了 `try_clone` + `seek`） | 换位置读取 `read_at` |
| 刚写完读不到 | 活跃段加了 `BufWriter` | 去掉用户态缓冲，交给 OS page cache |
| CLI 交互模式看不到输出 | stdout 块缓冲没 flush | 每次 print 后 `io::stdout().flush()?` |
| `cargo test` 很慢 | debug 构建 + 增量编译 | 用 `cargo test --release`；或 `cargo nextest run`（第三方，并行更快） |

### 13.13 调试工具箱

```bash
# panic 时打印完整调用栈（≈ Java 的异常栈，但默认不显示）
RUST_BACKTRACE=1 cargo test
RUST_BACKTRACE=full cargo test          # 连标准库内部帧也显示

# 分级日志（env_logger，运行时改级别，不用改代码重启）
RUST_LOG=debug cargo run --bin minidb-server
RUST_LOG=minidb::stage6_compact=trace cargo test -- --nocapture

# 只在测试失败时打印 println!/dbg! 的输出
cargo test -- --nocapture

# 单线程跑测试（调试依赖顺序的 bug）
cargo test -- --test-threads=1

# 快速打印变量（比 println! 少打字，带文件和行号）
dbg!(&self.index);

# 看宏展开后的代码（理解 derive 宏在干什么）
cargo expand            # 需要 cargo install cargo-expand

# 依赖树（≈ mvn dependency:tree）
cargo tree
cargo tree -i serde     # 谁依赖了 serde

# 覆盖率
rustup component add llvm-tools
cargo install cargo-llvm-cov
cargo llvm-cov --html
```

> **Java 对照**：`RUST_BACKTRACE` ≈ 默认的异常栈；`RUST_LOG` ≈ logback 的 `<logger level>`，但更简单——环境变量直接生效；`dbg!` ≈ IDE 的"evaluate expression"。

### 13.14 测试技巧

```bash
cargo test --lib stage5        # 只跑名字含 stage5 的单元测试
cargo test --test integration  # 只跑集成测试
cargo test -- --ignored        # 跑被 #[ignore] 的测试
cargo test -- --list           # 列出所有测试
```

**Rust 测试的三个特点**（和 JUnit 对比）：

| JUnit | Rust |
|-------|------|
| `@Test` | `#[test]` |
| `assertEquals` | `assert_eq!` |
| `assertThrows` | `#[should_panic]` 或直接断言 `Err`（错误是值） |
| `@BeforeEach` | **没有**——每个测试函数独立，共享状态用 `tempfile::TempDir` 隔离 |
| `@TempDir` | `tempfile::tempdir()`（dev-dependency） |
| `@Disabled` | `#[ignore]` |
| 测试可以抛异常 | 测试可以返回 `Result`，内部用 `?` |

**最有价值的一条**：测试函数返回 `Result` + 内部用 `?`，失败时报出的错误比 `unwrap()` 清楚得多。

### 13.15 性能排查

```bash
# 第一步永远是：确认你在用 release
cargo build --release && ./target/release/minidb-cli --dir ./data --exec "PING"

# 性能冒烟
cargo test --release -- --ignored --nocapture

# 火焰图（需要 cargo install flamegraph）
cargo flamegraph --bin minidb-cli -- --dir ./data --compact --exec "PING"

# 看编译产物大小 / 反汇编（零成本抽象的验证手段）
cargo rustc --release -- --emit asm
```

**性能问题 Checklist**：

1. 是不是用了 debug 构建？（90% 的"性能问题"是这个）
2. 热路径有没有无谓的 `clone()`？
3. 有没有预分配 `Vec::with_capacity` / `HashMap::with_capacity`？
4. 迭代是用 `Iterator` 组合（会被内联）还是手动 `for` + 中间 `Vec`？
5. 锁的粒度是不是太大？（读写锁用上了吗？）

---

## 14. 进阶扩展方向

按**投入产出比**排序。每个方向标注了改动点、涉及文件、和验收方式。

### 14.1 TTL / 过期键

**改动点**：

1. 帧格式加一个 8 字节的 `expire_at`（`u64` 毫秒时间戳，0 表示永不过期）
2. `Command` 加 `Expire { key, seconds }` 变体
3. 读路径：拿到值后检查 `expire_at`，过期就返回 `None`（惰性删除）
4. compaction：物理清除已过期的记录

**涉及文件**：`stage5_wal.rs`（帧格式）、`stage3_protocol.rs`（命令）、`engine.rs`（读路径）

**思考题**：过期检查该放在读路径还是后台线程？
（提示：读路径简单但"从不访问的键永远不会消失"；后台线程能真正回收空间，但要扫全量索引。）

**验收**：`SET k v` → `EXPIRE k 1` → sleep 2 → `GET k` 返回 `$-1`。

### 14.2 LSM-Tree 化（支持范围查询）

把哈希索引换成有序结构（`BTreeMap` 内存索引 + 磁盘 SSTable），就能支持 `RANGE a z` 这样的范围查询。这是 RocksDB 的路子，也是"从 Bitcask 到 LSM"的自然演进。

**改动点**：索引从 `HashMap` 换成 `BTreeMap`；段内数据按 key 排序落盘；读路径变成"先查内存 MemTable，再查 SSTable"。

**涉及文件**：新增 `src/lsm/` 模块，`stage6_compact.rs` 的合并逻辑可以复用

**验收**：`RANGE user: user:~` 返回按字典序排列的键。

### 14.3 mmap 读路径

用 `memmap2` 把段文件映射到内存，消除读路径的系统调用和一次内核→用户态拷贝。

**注意**：mmap 不是银弹——它把"什么时候淘汰页面"的控制权交给了 OS，会带来不可预测的 page fault 停顿。真实引擎（如 RocksDB）通常只在只读段上用 mmap。

**涉及文件**：`stage6_compact.rs` 的 `read_at`

**验收**：benchmark 对比 mmap 前后随机读的 P99 延迟。

### 14.4 零拷贝值

引入 `bytes::Bytes`（引用计数切片），让 `get` 返回 `Bytes` 而不是 `Vec<u8>`。多个读者共享同一份数据，没有拷贝。

**涉及文件**：`stage4_traits.rs`（trait 签名）、`engine.rs`

**思考题**：trait 的 `get` 返回 `Bytes` 之后，`InMemKv` 的实现要怎么改？（提示：`Bytes::from_owner` 或 `Bytes::copy_from_slice`）

### 14.5 完整 RESP 协议

让 `redis-cli` 能直连 minidb。这需要支持：内联命令、`*N` 数组格式、错误类型前缀、`INFO`/`COMMAND` 等元命令。

**涉及文件**：`stage3_protocol.rs`

**验收**：`redis-cli -p 6379 SET a 1` 能成功。

### 14.6 组提交（group commit）

把 N 次 fsync 合并成 1 次——这是数据库性能最关键的优化之一。

**设计思路**：写请求先 append 到 WAL 并进入一个队列；一个后台线程每秒（或凑够 N 条）做一次 fsync，然后一次性唤醒所有等待的请求。

**涉及文件**：`stage5_wal.rs` + 新增 `src/group_commit.rs`

**验收**：benchmark 对比开启前后的写 QPS（通常有数量级提升）。

### 14.7 复制与一致性

主写从读，用 tokio 做异步复制。这会把项目从"单进程存储引擎"升级成"分布式系统"，复杂度上一个台阶——但也是最有价值的方向。

**涉及文件**：新增 `src/replication/`，`stage8_async.rs`

**思考题**：异步复制下，主节点写入成功后崩溃，从节点还没收到这条日志，怎么办？（提示：这涉及到 ack 策略和 leader lease，是 Raft/Paxos 的核心问题。）

### 14.8 和教程章节的对应关系

| 扩展方向 | 需要掌握的章节 | 难度 |
|----------|---------------|------|
| TTL | 6（协议）、8（帧格式）、12（引擎） | ⭐ |
| 完整 RESP | 6（协议层） | ⭐⭐ |
| 零拷贝值 | 7（trait）、12（引擎） | ⭐⭐ |
| mmap 读路径 | 8（持久化）、13（性能排查） | ⭐⭐⭐ |
| 组提交 | 8（WAL）、10（并发） | ⭐⭐⭐ |
| LSM-Tree 化 | 9（段合并） | ⭐⭐⭐⭐ |
| 复制与一致性 | 11（异步） | ⭐⭐⭐⭐⭐ |

### 14.9 和理论教程的配合

`../*.md`（01~12 章）是概念讲解，本项目是**把这些概念焊在一起**的地方：

| 理论章节 | 在本项目的落地位置 |
|----------|-------------------|
| 01 环境搭建与语言基础 | 本文第 2 章 |
| 02 所有权与生命周期 | 第 5 章（`stage2_inmem.rs`）、第 9 章（`iter()` 的 `+ '_`） |
| 03 类型系统与模式匹配 | 第 6 章（`stage3_protocol.rs`） |
| 04 集合、字符串与函数式 | 第 5 章的 `scan_prefix`、第 9 章的迭代器 |
| 05 工程化特性 | 第 3 章（`error.rs`）、第 2 章（`Cargo.toml`） |
| 06 异步编程与生态 | 第 11 章（`stage8_async.rs`） |
| 07 测试调试与质量工具 | 每章的"验证"小节 + 第 13 章 |
| 08 并发编程专题 | 第 10 章（`stage7_concurrent.rs`） |
| 09 从 Java 项目到 Rust 项目的实战迁移 | 全文（每章的"Java 对照"） |
| 10 性能、unsafe 与 FFI | 第 12 章的性能冒烟 + 第 8 章的编译期 CRC 表 |
| 11 实战项目 Todo API | 对比着看：同一套语言特性在"CRUD Web"和"系统组件"两种场景下的不同取舍 |
| 12 部署与发布 | 第 2 章的 `[profile.release]` |

---

**祝你在 Rust 里玩得开心。如果这份文档让你少撞了一次借用检查器，那就值了。**

