# 附录：Java 到 Rust 速查表

这篇不是新知识，而是给 Java 程序员快速查映射用的。读教程时遇到熟悉的 Java 概念，可以先在这里找到 Rust 对应物，再回到正文看细节。

## 一、语言概念速查

| Java | Rust | 说明 |
|------|------|------|
| class | struct + impl | 数据和方法分开写 |
| interface | trait | 可做泛型约束，也可做动态分发 |
| enum | enum | Rust enum 可以携带数据 |
| record | struct | 配合 derive 很接近 |
| null | Option<T> | 编译期强制处理空值 |
| exception | Result<T, E> | 错误是返回值 |
| RuntimeException | panic! | 不可恢复错误 |
| generic | generic | Rust 默认单态化 |
| lambda | closure | 捕获分 Fn/FnMut/FnOnce |
| annotation | attribute / macro | 例如 `#[derive(Debug)]` |
| package | mod | Rust 模块和文件路径相关但不完全等同 |
| jar | crate | 编译单元或发布包 |
| static final | const | 编译期常量 |
| static field | static | 全局静态变量 |
| local variable | `let` | 默认不可变 |
| mutable variable | `let mut` | 必须显式可变 |
| method overload | trait / 不同函数名 | Rust 没有传统重载 |
| `toString()` | `Display` / `Debug` | 用户展示 / 调试输出 |
| `equals()` | `PartialEq` / `Eq` | 相等比较 |
| `hashCode()` | `Hash` | HashMap/HashSet key |
| `Comparable` | `Ord` / `PartialOrd` | 排序比较 |
| Lombok `@Data` | `#[derive(...)]` | 常见 trait 自动实现 |

## 二、常用类型速查

| Java | Rust |
|------|------|
| `String` | `String` / `&str` |
| `List<T>` | `Vec<T>` |
| `Map<K, V>` | `HashMap<K, V>` / `BTreeMap<K, V>` |
| `Set<T>` | `HashSet<T>` / `BTreeSet<T>` |
| `Optional<T>` | `Option<T>` |
| `Either<T, E>` | `Result<T, E>` |
| `byte[]` | `Vec<u8>` / `&[u8]` |
| `int` | `i32` |
| `long` | `i64` |
| `boolean` | `bool` |
| `char` | `char`，表示 Unicode 标量值 |
| `Object` | trait object 或泛型 |
| `BigDecimal` | `rust_decimal::Decimal` |
| `LocalDateTime` | `chrono::NaiveDateTime` / `time` crate |

## 三、集合 API 速查

| Java | Rust |
|------|------|
| `new ArrayList<>()` | `Vec::new()` |
| `List.of(1, 2, 3)` | `vec![1, 2, 3]` |
| `list.add(x)` | `vec.push(x)` |
| `list.get(i)` | `vec.get(i)` |
| `list.size()` | `vec.len()` |
| `list.isEmpty()` | `vec.is_empty()` |
| `map.put(k, v)` | `map.insert(k, v)` |
| `map.get(k)` | `map.get(&k)` |
| `map.computeIfAbsent(k, f)` | `map.entry(k).or_insert_with(f)` |
| `stream().map()` | `iter().map()` |
| `stream().filter()` | `iter().filter()` |
| `stream().collect()` | `iter().collect()` |

## 四、所有权和引用速查

| 你想做什么 | Rust 写法 |
|------------|-----------|
| 函数只读字符串 | `fn f(s: &str)` |
| 函数只读数组 | `fn f(items: &[T])` |
| 函数要修改调用者的数据 | `fn f(value: &mut T)` |
| 函数要拿走所有权 | `fn f(value: T)` |
| 多个地方共享只读数据 | `Rc<T>` 或 `Arc<T>` |
| 单线程共享可变数据 | `Rc<RefCell<T>>` |
| 多线程共享可变数据 | `Arc<Mutex<T>>` |
| 明确复制一份 | `value.clone()` |
| 小类型按位复制 | 实现或派生 `Copy` |

简单判断：

```text
只读？优先 &
要改？用 &mut
要保存或跨线程？拿所有权
要共享？Rc/Arc
要共享且修改？RefCell/Mutex/RwLock
```

## 五、错误处理速查

| Java | Rust |
|------|------|
| `throw new BizException()` | `return Err(AppError::Biz)` |
| `try/catch` | `match result` |
| `throws IOException` | `-> Result<T, io::Error>` |
| `foo()` 传播受检异常 | `foo()?` |
| `finally` | Drop / 作用域自动释放 |
| `assertThrows` | `unwrap_err()` / `matches!` |
| 全局异常处理器 | Web 层实现错误到响应的转换 |

常见写法：

```rust
fn load_config() -> Result<Config, ConfigError> {
    let content = std::fs::read_to_string("config.toml")?;
    let config = toml::from_str(&content)?;
    Ok(config)
}
```

应用层可以用 `anyhow`：

```rust
fn run() -> anyhow::Result<()> {
    let content = std::fs::read_to_string("config.toml")?;
    println!("{content}");
    Ok(())
}
```

库代码优先用 `thiserror` 定义具体错误。

## 六、并发速查

| Java | Rust |
|------|------|
| `Thread` | `std::thread` |
| `ExecutorService` | tokio runtime / rayon / 线程池 crate |
| `Future<T>` | `JoinHandle<T>` / `Future<Output = T>` |
| `synchronized` | `Mutex<T>` |
| `ReentrantReadWriteLock` | `RwLock<T>` |
| `AtomicInteger` | `AtomicI32` / `AtomicUsize` |
| `BlockingQueue` | channel |
| `CompletableFuture.allOf` | `tokio::join!` |
| 谁先完成 | `tokio::select!` |
| parallelStream | rayon |

选择建议：

- CPU 密集数据并行：rayon。
- 高并发 IO：tokio。
- 简单多线程：`std::thread`。
- 共享可变状态：`Arc<Mutex<T>>`。
- 生产者消费者：channel。

## 七、工程工具速查

| Java | Rust |
|------|------|
| JDK | rustup + rustc |
| Maven / Gradle | Cargo |
| `pom.xml` | `Cargo.toml` |
| dependency lock | `Cargo.lock` |
| multi module | workspace |
| JUnit | `cargo test` |
| Mockito | trait fake / mockall |
| google-java-format | rustfmt |
| SpotBugs / Error Prone | clippy |
| Javadoc | rustdoc / `cargo doc` |
| JMH | criterion |
| SLF4J | tracing / log |

常用命令：

```bash
cargo check
cargo test
cargo fmt
cargo clippy --all-targets --all-features -- -D warnings
cargo doc --open
cargo build --release
```

## 八、Web 生态速查

| Java | Rust |
|------|------|
| Spring Boot | axum / actix-web |
| Jackson | serde |
| OkHttp | reqwest |
| Hibernate/JPA | diesel / sea-orm |
| JdbcTemplate/MyBatis | sqlx |
| Flyway/Liquibase | sqlx migrate / refinery |
| `@RestController` | handler function |
| `@ControllerAdvice` | error `IntoResponse` |
| `application.yml` | config crate / env |
| Logback | tracing-subscriber |

## 九、常见问题

### Rust 没有 class，怎么写业务对象？

用 `struct` 存数据，用 `impl` 写方法：

```rust
struct User {
    id: u64,
    name: String,
}

impl User {
    fn rename(&mut self, name: String) {
        self.name = name;
    }
}
```

### 没有继承怎么办？

优先用组合和 trait。Rust 不鼓励深继承树。

### 没有 Spring DI 怎么办？

手动构造依赖，把共享状态放进 `AppState`。依赖图更显式，启动时少很多魔法。

### 什么时候用 `String`，什么时候用 `&str`？

函数参数只读时用 `&str`。需要拥有、保存、修改、跨线程移动时用 `String`。

### 什么时候用 `Box<dyn Trait>`？

当你需要运行时多态，或者要把不同具体类型放进同一个集合时使用。普通函数参数优先用泛型或 `impl Trait`。

### Rust 适合替代所有 Java 服务吗？

不一定。Rust 适合性能敏感、资源敏感、部署形态简单、边界清晰的模块。大量依赖 Spring 生态的 CRUD 系统，整体迁移收益未必高。

## 十、迁移时最重要的三句话

1. 不要照搬 Java 的对象模型，先接受所有权模型。
2. 不要照搬 Spring 的容器模型，优先显式组合。
3. 不要为了绕过编译器而 `clone`、`Arc<Mutex>`、`unsafe` 三件套乱用。

Rust 的门槛主要在前期，但一旦这些映射建立起来，很多 Java 项目里靠规范和 code review 兜底的东西，会自然进入类型系统和编译器检查。
