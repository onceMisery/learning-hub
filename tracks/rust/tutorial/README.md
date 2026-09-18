# 写给 Java 程序员的 Rust 入门

这是一套写给 Java 开发者看的 Rust 入门文档。默认你已经熟悉 JVM、Maven/Gradle、泛型、Lambda、异常、并发和常见 Web 开发模式，所以这里不会从“什么是变量”开始，而是把 Rust 概念放到你已经有的 Java 经验旁边讲。

Rust 真正难的通常不是语法，而是心智模型：所有权、借用、生命周期、`Option`/`Result`、trait、宏、异步运行时。读这套文档时，可以一直带着两个问题看：Rust 为什么要这么设计？写真实项目时，我该怎么选工具、怎么组织代码？

## 适合谁阅读

- 有 Java 后端、工具链、服务端或基础设施开发经验。
- 熟悉 Maven/Gradle、JUnit、Spring、Jackson、SLF4J、线程池等常见生态。
- 想从 Java 迁移到 Rust，或者想把 Rust 用在 CLI、Web API、系统工具、性能敏感服务中。
- 不要求有 C/C++ 经验，但如果你熟悉 RAII、指针或零成本抽象，会更容易理解部分内容。

## 阅读路线

建议按顺序读。前六篇先把语言模型搭起来，后六篇再补测试、并发、项目迁移、性能边界、实战项目和部署发布。附录不用硬背，遇到概念卡住时再回来查。

| 顺序 | 文档 | 你会学到什么 | Java 对照 |
|------|------|--------------|-----------|
| 1 | [环境搭建与语言基础](01-环境搭建与语言基础.md) | rustup、Cargo、变量、类型、函数、控制流 | JDK、Maven、基础语法 |
| 2 | [所有权与生命周期](02-所有权与生命周期.md) | move、borrow、引用、生命周期、Clone/Copy | GC 引用模型、对象传参 |
| 3 | [类型系统与模式匹配](03-类型系统与模式匹配.md) | struct、enum、Option、Result、泛型、trait | class、enum、Optional、Exception、interface |
| 4 | [集合、字符串与函数式编程](04-集合字符串与函数式编程.md) | Vec、HashMap、String、闭包、迭代器 | List、Map、StringBuilder、Lambda、Stream |
| 5 | [工程化特性](05-工程化特性.md) | 智能指针、模块系统、宏、错误处理实践 | package、Lombok、注解处理器、异常体系 |
| 6 | [异步编程与生态](06-异步编程与生态.md) | async/await、tokio、serde、reqwest、sqlx、axum | CompletableFuture、虚拟线程、Spring 生态 |
| 7 | [测试调试与质量工具](07-测试调试与质量工具.md) | cargo test、集成测试、mock、clippy、rustfmt、调试 | JUnit、Mockito、SpotBugs、IDE debugger |
| 8 | [并发编程专题](08-并发编程专题.md) | thread、Arc、Mutex、RwLock、channel、Send/Sync | Thread、ExecutorService、synchronized、BlockingQueue |
| 9 | [从 Java 项目到 Rust 项目的实战迁移](09-从 Java 项目到 Rust 项目的实战迁移.md) | 项目结构、分层建模、DI 替代、配置、Web API 组织 | Spring Boot 项目实践 |
| 10 | [性能、unsafe 与 FFI 边界](10-性能unsafe与FFI边界.md) | benchmark、release 构建、性能误区、unsafe、FFI | JMH、JNI、native 优化 |
| 11 | [实战项目：Todo API](11-实战项目TodoAPI.md) | 从零写一个 axum API、测试、日志、质量门禁 | Spring Boot CRUD |
| 12 | [部署与发布](12-部署与发布.md) | release 构建、Docker、GitHub Actions、配置、日志 | jar、容器镜像、CI/CD |
| 附录 | [Java 到 Rust 速查表](附录-Java到Rust速查表.md) | 常见概念、类型、工具、生态映射 | 快速查表 |
| 附录 | [依赖安全与供应链](附录-依赖安全与供应链.md) | cargo audit、cargo deny、crate 选择、许可证检查 | OWASP Dependency-Check、Maven Enforcer |

## Java 到 Rust 的核心心智转换

| Java 习惯 | Rust 习惯 |
|-----------|-----------|
| 对象默认在堆上，由 GC 回收 | 值默认按所有权管理，离开作用域自动释放 |
| 引用可以随处复制，生命周期由 GC 保证 | 引用必须满足借用规则和生命周期检查 |
| `null` 表示没有值 | `Option<T>` 显式表示可能为空 |
| 异常可以跨层抛出 | `Result<T, E>` 把错误放进类型系统 |
| interface 默认动态分发 | trait 默认静态分发，需要时才用 `dyn Trait` |
| 多线程安全主要靠约定和运行时同步 | `Send`/`Sync` 在编译期约束跨线程行为 |
| Spring 通过容器装配对象 | Rust 更偏显式组合、构造函数和 trait 抽象 |
| Lombok/注解处理器生成样板代码 | derive 宏和过程宏在编译期生成代码 |

## 推荐练习顺序

学 Rust 最怕只读不写。建议每读两篇就做一个小练习：

1. 写一个命令行工具：读取文件、解析参数、统计文本。
2. 写一个 JSON 配置加载器：用 `serde`、`Result`、`thiserror`。
3. 写一个内存版 Todo API：用 `axum`、`tokio`、`Arc<Mutex<T>>`。
4. 给 API 补测试：单元测试、集成测试、错误路径测试。
5. 把共享状态替换成 channel 或数据库访问，体会并发模型差异。
6. 给热点函数写 benchmark，确认优化前后真的有差异。

## 常用命令速查

```bash
# 创建项目
cargo new hello_rust
cargo new hello_lib --lib

# 日常开发
cargo check
cargo test
cargo run
cargo fmt
cargo clippy -- -D warnings

# 文档和依赖
cargo doc --open
cargo tree
cargo update

# 发布构建
cargo build --release
```

## 读这套文档时的建议

- 不要急着绕过 borrow checker。先看懂编译器为什么拒绝你。
- 少用 `clone()` 逃避所有权问题。确认你真的需要复制数据。
- 先用标准库和主流 crate，不要一上来写宏或 unsafe。
- 应用代码可以用 `anyhow` 简化错误处理，库代码优先定义清晰错误类型。
- 并发代码先明确“共享状态”还是“消息传递”，再选 `Arc<Mutex<T>>` 或 channel。
- Web 项目不要照搬 Spring 的层级和 DI 容器，Rust 更适合显式依赖和小模块组合。

## 学完之后可以做什么

读完之后，你应该可以：

- 看懂常见 Rust 项目的 `Cargo.toml`、模块结构和错误处理方式。
- 写中小型 CLI 工具、HTTP 客户端、REST API、数据处理程序。
- 使用 `cargo test`、`clippy`、`rustfmt` 建立基本质量门禁。
- 理解什么时候用 `String`、`&str`、`Vec<T>`、`HashMap<K, V>`、`Arc<Mutex<T>>`。
- 把 Java 里的 DTO、Service、Repository、异常、配置、日志迁移到 Rust 的表达方式。

刚开始写 Rust 会觉得编译器管得很细。先别急着和它对抗，很多报错其实是在把 Java 项目里运行时才爆的问题，提前拉到编译期说清楚。
