# 写给 Java 程序员的 Rust 入门（十一）：实战项目 Todo API

> 本文是系列第十一篇。前面已经讲了语言、工程化、异步、测试和项目迁移，这一篇把它们串起来：从零写一个内存版 Todo REST API。
>
> 和上一版不同，这一篇**假设你刚看完前十篇、还不太熟练**：每个 Rust 专有概念第一次出现时都会先解释它是什么、为什么需要它，再讲它在项目里怎么用，最后给出「如果写错了编译器会说什么」。所有代码和报错都在 axum 0.8 / thiserror 2 / Rust 1.98 上实测过。
>
> 目标不是做一个生产级系统，而是让你完整走一遍 Rust Web 开发闭环：建项目 → 定义模型 → 写业务 → 接路由 → 处理错误 → 加日志 → 写测试 → 跑门禁 → 排查编译错误。

---

## 一、读这一篇之前：需要哪些前置知识

### 1.1 你应该已经看过

| 章节 | 本文会用到的东西 |
|------|-----------------|
| 第二篇 所有权与生命周期 | 借用 `&` / `&mut`、move 语义、为什么不能同时有两个 `&mut` |
| 第三篇 类型系统与模式匹配 | `enum`、`match`、`Option`、`Result` |
| 第四篇 集合字符串与函数式编程 | `Vec<T>`、迭代器 `iter().map().collect()` |
| 第五篇 工程化特性 | `Arc<T>`、trait、`#[derive(...)]`、`?` 运算符、thiserror / anyhow |
| 第六篇 异步编程与生态 | `async` / `.await`、`#[tokio::main]`、serde 的 `Serialize` / `Deserialize` |
| 第八篇 并发编程专题 | `Mutex`、`Send` / `Sync` |
| 第九篇 项目迁移 | 目录结构、模块拆分思路 |

如果某个概念卡住了，先回到对应章节看一眼再回来。这篇不会再重复讲它们的基础语法。

### 1.2 本文会用到的概念速查表

先过一遍，后面遇到时就不陌生了：

| 概念 | 一句话解释 | Java 类比 |
|------|-----------|----------|
| **所有权** | 每个值有且只有一个所有者；所有者离开作用域，值被释放 | 没有对应物，最接近 RAII / try-with-resources 的自动 close |
| **借用 `&T`** | 只读借用，可以有多个同时存在 | 传引用，但编译器保证不会有人同时改它 |
| **可变借用 `&mut T`** | 独占借用，同一时刻只能有一个 | 无对应物；Java 里任何引用都能改 |
| **move** | 赋值/传参默认转移所有权，原变量不能再用 | Java 里赋值只是复制引用；Rust 里原变量失效 |
| **`String` vs `&str`** | `String` 拥有堆上的字符串，可以改、可以长期持有；`&str` 是借来的一段字符串切片，只读 | `String` ≈ `String`；`&str` ≈ 只读的 `CharSequence` 视图 |
| **生命周期 `'static`** | "这份数据活得和整个程序一样久" | 无对应物 |
| **trait** | 一组方法契约，类似接口，但可以自带默认实现、可以泛型分发 | `interface`，但可以静态分发（无虚表开销） |
| **`#[derive(...)]`** | 让编译器**生成**一段实现代码（不是运行时反射） | Lombok 的 `@Data`、Jackson 的序列化，但在编译期完成 |
| **`impl Trait for Type`** | 给某个类型实现某个 trait | `class X implements Y` |
| **`?` 运算符** | 遇到 `Err` 就提前返回，否则取出 `Ok` 里的值 | 隐式 `throw`，但返回类型是显式的 `Result` |
| **Cargo 依赖 `x = "1"`** | 语义化版本：`"1"` ≈ `>=1.0.0, <2.0.0` | Maven 的 version range，但默认就启用 |
| **`features = [...]`** | 一个 crate 的可选功能模块，按需编译 | Maven 的 optional dependency / profile |
| **`[dev-dependencies]`** | 只在测试、示例、bench 里用到的依赖 | `<scope>test</scope>` |
| **`async fn` / `.await`** | 异步函数；`.await` 挂起当前任务、让出线程 | `CompletableFuture`，但 Future 是**惰性**的 |
| **`Arc<T>`** | 原子引用计数的共享指针，可以多处共享同一个 `T` | 无直接对应；≈ 一个线程安全的共享引用 |
| **`Mutex<T>`** | 互斥锁，拿到守卫才能访问里面的 `T` | `synchronized` / `ReentrantLock`，但守卫离开作用域自动解锁 |
| **`Send` / `Sync`** | 编译器自动推导的标记：能否跨线程转移 / 共享 | `@ThreadSafe` 注解，但这个是**编译期强制**的 |

### 1.3 这篇会用到的 crate

| crate | 干什么 | Spring 里对应什么 |
|-------|--------|------------------|
| `axum` | Web 框架（路由 + 参数提取 + 响应） | Spring WebMVC |
| `tokio` | 异步运行时（Rust 标准库不带运行时） | JDK 自带的线程池（Rust 必须自己选一个） |
| `serde` | 序列化/反序列化框架，编译期生成代码 | Jackson / Gson |
| `serde_json` | JSON 格式实现 + `json!` 宏 | Jackson 的 `ObjectMapper` |
| `thiserror` | 用 `#[derive]` 生成错误类型 | 自定义的异常继承树 |
| `anyhow` | 应用层"我不关心具体错误类型"的错误盒子 | `throws Exception` 的懒人版 |
| `tracing` | 结构化日志门面 | SLF4J |
| `tracing-subscriber` | 日志的具体实现与过滤 | Logback |
| `tower`（dev） | 提供 `ServiceExt::oneshot`，测试里直接调用路由 | MockMvc |

---

## 二、项目目标与 API 设计

我们实现一个简单 Todo API：

| 方法 | 路径 | 作用 | 成功响应 |
|------|------|------|---------|
| `GET` | `/health` | 健康检查 | `200 ok` |
| `GET` | `/todos` | 查询全部 Todo | `200 [ {...} ]` |
| `POST` | `/todos` | 创建 Todo | `201 { ... }` |
| `PATCH` | `/todos/{id}/complete` | 标记完成 | `200 { ... }` |
| `DELETE` | `/todos/{id}` | 删除 Todo | `204` 无 body |

失败时：标题为空 → `400`，id 不存在 → `404`，都返回 `{"error": "..."}`。

Java/Spring Boot 里你可能会写这些类：

```text
TodoController      ← 接 HTTP
TodoService         ← 业务规则
TodoRepository      ← 持久化
TodoEntity          ← 领域模型
CreateTodoRequest   ← 入参 DTO
TodoResponse        ← 出参 DTO
```

Rust 里我们也保留类似边界，但**依赖关系全部显式**：没有容器扫描，没有 `@Autowired`，谁创建谁、谁能用谁，都在代码里看得见。

---

## 三、创建项目

```bash
cargo new todo-api
cd todo-api
```

`cargo new` 会生成：

```text
todo-api/
├── Cargo.toml     ← 项目清单（≈ pom.xml）
└── src/
    └── main.rs    ← 入口（≈ main 方法所在类）
```

> **注意**：新版 Cargo 默认生成 `edition = "2024"`。本系列统一用 **2021 edition**（`2024` 的一些新规则，比如 `unsafe` 属性，会在第十篇讲到）。如果你的 `Cargo.toml` 里是 `2024`，改成 `2021` 即可——本文所有代码都按 2021 验证过。

### 3.1 `Cargo.toml` 逐行解释

```toml
[package]
name = "todo-api"
version = "0.1.0"
edition = "2021"

[dependencies]
anyhow = "1"
axum = "0.8"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
tokio = { version = "1", features = ["macros", "rt-multi-thread", "signal", "net"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

[dev-dependencies]
tower = { version = "0.5", features = ["util"] }
```

一处一处说清楚：

| 行 | 为什么 |
|----|--------|
| `edition = "2021"` | edition 决定语**法**和部分语义（不是版本号）。2021 是目前最稳的选择；2024 改了一些细节（见第十篇） |
| `axum = "0.8"` | 版本号 `"0.8"` 的意思是 `>=0.8.0, <0.9.0`。**注意**：对 `0.x` 的 crate，Cargo 认为 `0.8 → 0.9` 是**不兼容**升级，所以 `"0.8"` 不会自动升到 0.9 |
| `serde = { version = "1", features = ["derive"] }` | `features = ["derive"]` 打开 `#[derive(Serialize, Deserialize)]` 支持。**不开这个 feature 就用不了 derive**，这是新手最常踩的坑之一 |
| `thiserror = "2"` | 写本文时 thiserror 已到 2.x；1.x 的写法完全一样，只是版本号不同 |
| `tokio = { features = [...] }` | tokio 是**按需编译**的，每个 feature 的含义：`macros` = `#[tokio::main]` / `#[tokio::test]`；`rt-multi-thread` = 多线程运行时；`signal` = Ctrl+C 信号；`net` = `TcpListener` 等网络类型 |
| `tracing-subscriber` 的 `env-filter` | 让我们能用 `RUST_LOG=debug` 环境变量控制日志级别 |
| `[dev-dependencies]` 里的 `tower` | 只在测试里用（把 Router 当服务直接调用），**不会打进生产二进制** |

**为什么 tokio 要显式声明 feature？** 这是 Rust 和 Java 很大的不同：Rust **没有运行时**（没有 JVM 那样的线程池和调度器），异步运行时是普通库。好处是你可以不付任何不用的成本；代价是配错 feature 就会编译失败，报"找不到 `#[tokio::main]`"之类。

### 3.2 依赖是怎么被拉下来的

```bash
cargo build          # 第一次会解析依赖、生成 Cargo.lock
cargo tree           # 看依赖树（≈ mvn dependency:tree）
```

`Cargo.lock` 记录了**精确到补丁号**的版本，作用和 Maven 里"把所有版本写死"一样：保证团队里每个人、每次 CI 构建都用同一套依赖。**二进制项目（比如我们这个）应该提交 `Cargo.lock`**；库项目通常不提交（让别人也能解析出自己的版本组合）。

---

## 四、目录结构

```text
todo-api/
├── Cargo.toml
├── src/
│   ├── main.rs      ← 可执行入口：只负责「启动」
│   ├── lib.rs       ← 库入口：把模块暴露出去，给集成测试用
│   ├── error.rs     ← 错误类型 + HTTP 映射
│   ├── state.rs     ← 共享应用状态
│   ├── todo.rs      ← 模型、请求/响应 DTO、业务逻辑
│   └── web.rs       ← 路由和 handler
└── tests/
    └── api_test.rs  ← 集成测试
```

**为什么要同时有 `main.rs` 和 `lib.rs`？**

这是 Rust Web 项目的标准做法，也和 Maven 的 `src/main` 单目录不同：

- `src/main.rs` 编译出一个**二进制**，它 `use todo_api::...` 引用同名的库；
- `src/lib.rs` 编译出一个**库 crate**，名字就是包名 `todo-api`（连字符自动变成下划线 `todo_api`）；
- `tests/` 里的集成测试**只能引用库 crate**，不能引用二进制。

所以：想让 `tests/api_test.rs` 能 `use todo_api::web::build_router`，就必须有 `lib.rs`。这也是为什么很多 Rust 项目"明明是个服务，却还有个 lib.rs"。

---

## 五、定义模型：`src/todo.rs`

### 5.1 三个 struct 和一个 `From`

```rust
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Todo {
    pub id: u64,
    pub title: String,
    pub completed: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateTodoRequest {
    pub title: String,
}

#[derive(Debug, Serialize)]
pub struct TodoResponse {
    pub id: u64,
    pub title: String,
    pub completed: bool,
}

impl From<Todo> for TodoResponse {
    fn from(todo: Todo) -> Self {
        Self {
            id: todo.id,
            title: todo.title,
            completed: todo.completed,
        }
    }
}
```

**为什么要三个 struct，不能直接用一个？**

Java 里很多人会写一个 `Todo` 到处用。Rust 里**用类型区分"入参 / 领域 / 出参"是常态**，因为：

- `CreateTodoRequest` 只 `Deserialize`（进来的 JSON 只需要 `title`）——客户端多传一个 `id` 也没用，因为我们根本不读它；
- `TodoResponse` 只 `Serialize`（出去的 JSON 由我们决定字段）；
- `Todo` 两者都有（我们把它存在内存里）。

这样做的好处是**编译期就能挡住一类错误**：比如以后给 `Todo` 加了 `created_at` 字段，只要没加进 `TodoResponse`，它就**不会**被返回给客户端——不需要任何注解或 `@JsonIgnore`。

### 5.2 `#[derive(...)]` 到底生成了什么

- `Debug`：`{:?}` 打印。没有它，`println!("{:?}", todo)` 会编译失败。
- `Clone`：允许 `.clone()` 显式复制。**Rust 不会自动帮你深拷贝**，想要拷贝必须写出来。
- `Serialize` / `Deserialize`：serde 在**编译期**生成 `to_json` / `from_json` 代码。运行期没有反射、没有 `setAccessible`，性能和手写差不多。
- `PartialEq` / `Eq`：允许 `==` 比较，测试里 `assert_eq!(error, AppError::InvalidTodoTitle)` 需要它。

> **Java 程序员注意**：`#[derive]` 不是注解。注解在运行期被读取，`#[derive]` 在**编译期展开成真实的 Rust 代码**。想看展开结果：`cargo expand`（第五篇讲过）。

### 5.3 `impl From<Todo> for TodoResponse`

这是标准库的 `From` trait：**"怎么把一个 `Todo` 变成一个 `TodoResponse`"**。

实现它之后，`.into()` 就能用（标准库有一条" blanket impl"：实现了 `From<A> for B` 就自动得到 `A: Into<B>`）。所以后面 handler 里写 `todo.into()` 就够了。

Java 里对应的是写一个 `TodoResponse.from(Todo)` 静态方法，或者 MapStruct 生成的转换器。

### 5.4 业务逻辑

```rust
#[derive(Debug, Default)]
pub struct TodoService {
    next_id: AtomicU64,
}

impl TodoService {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU64::new(1),
        }
    }

    pub fn create(&self, todos: &mut Vec<Todo>, title: String) -> Result<Todo, AppError> {
        let title = title.trim().to_string();
        if title.is_empty() {
            return Err(AppError::InvalidTodoTitle);
        }

        let todo = Todo {
            id: self.next_id.fetch_add(1, Ordering::Relaxed),
            title,
            completed: false,
        };

        todos.push(todo.clone());
        Ok(todo)
    }

    pub fn complete(&self, todos: &mut [Todo], id: u64) -> Result<Todo, AppError> {
        let todo = todos
            .iter_mut()
            .find(|todo| todo.id == id)
            .ok_or(AppError::TodoNotFound { id })?;

        todo.completed = true;
        Ok(todo.clone())
    }

    pub fn delete(&self, todos: &mut Vec<Todo>, id: u64) -> Result<(), AppError> {
        let index = todos
            .iter()
            .position(|todo| todo.id == id)
            .ok_or(AppError::TodoNotFound { id })?;

        todos.remove(index);
        Ok(())
    }
}
```

逐点解释：

**① `AtomicU64` 和 `Ordering::Relaxed`**

`fetch_add(1, ...)` 是原子的"取当前值并加一"——多线程下也不会拿到重复 id。`Ordering::Relaxed` 表示"只保证原子性，不保证和其他内存操作的顺序"。对自增 id 这种"只要不重复就行"的场景够用，也比默认的 `SeqCst` 便宜。

（想深入：第八篇讲过 `Ordering`。Java 里对应 `AtomicLong.incrementAndGet()`，但 Java 没有"内存序"这个概念可以选择。）

**② 为什么 `create` 用 `&mut Vec<Todo>`，`complete` 用 `&mut [Todo]`？**

- `&mut Vec<Todo>`：需要**增删元素**（`push` / `remove`），只有 `Vec` 有这些方法。
- `&mut [Todo]`：只需要**修改已有元素**，不需要改变长度。切片 `[Todo]` 比 `Vec<Todo>` 更"宽松"——`&mut Vec<Todo>` 可以自动转成 `&mut [Todo]`（ Deref 强制转换），反过来不行。

这是 Rust 的 API 设计习惯：**参数类型用"能满足需求的最宽泛的那个"**。Java 里对应"入参声明成 `List<T>` 而不是 `ArrayList<T>`"。

**③ `&self` 而不是 `&mut self`**

`create` 明明会改数据，为什么接收 `&self`？因为改的是**传进来的 `todos`**，`self` 里只有 `AtomicU64`，而 `fetch_add` 只需要 `&self`（内部可变性）。这让 `TodoService` 可以被多个线程共享而不加锁。

**④ `ok_or(...)?`**

`find()` 返回 `Option<&mut Todo>`。`.ok_or(AppError::TodoNotFound { id })?` 的意思是：

- 有值 → 取出 `&mut Todo`；
- 是 `None` → **立刻 `return Err(AppError::TodoNotFound { id })`**。

`?` 就是"出错就提前返回"的语法糖。Java 里要写 `if (x == null) throw new NotFoundException();`。

**⑤ `todos.push(todo.clone()); Ok(todo)` —— 为什么要 `clone()`？**

`push` 会把 `todo` 的**所有权**转移进 `Vec`。如果之后再 `Ok(todo)`，就是在用一个已经被 move 走的值——编译器会拒绝（见第十四节"错误 3"）。这里两个办法：

- `push(todo.clone())` 然后返回原来的 `todo`（本项目）；
- 或者 `todos.push(todo)` 之后返回 `todos.last().unwrap().clone()`。

`clone()` 在这里是一次深拷贝（标题字符串会复制一份）。对 demo 无所谓；如果你在意，可以让 `create` 返回 `&Todo` 或者返回索引。

### 5.5 单元测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_rejects_empty_title() {
        let service = TodoService::new();
        let mut todos = Vec::new();

        let error = service.create(&mut todos, "   ".to_string()).unwrap_err();

        assert_eq!(error, AppError::InvalidTodoTitle);
    }

    #[test]
    fn complete_marks_todo_as_done() {
        let service = TodoService::new();
        let mut todos = vec![Todo {
            id: 1,
            title: "learn rust".to_string(),
            completed: false,
        }];

        let todo = service.complete(&mut todos, 1).unwrap();

        assert!(todo.completed);
        assert!(todos[0].completed);
    }
}
```

- `#[cfg(test)]`：**条件编译**——这块代码只在 `cargo test` 时编译，不会进生产二进制。（Java 里测试代码在 `src/test/java`，物理隔离；Rust 是编译期隔离，可以和操作对象写在一起。）
- `mod tests`：一个内联模块。`use super::*;` 把外层的所有名字引进来。
- `unwrap_err()`：断言这个 `Result` 一定是 `Err`，并取出错误值。

**为什么把测试写在业务代码旁边？** 因为 `tests` 是私有模块，可以测私有方法。集成测试（`tests/` 目录）只能测公开 API。

---

## 六、应用状态：`src/state.rs`

```rust
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::todo::{Todo, TodoService};

#[derive(Clone)]
pub struct AppState {
    pub todos: Arc<Mutex<Vec<Todo>>>,
    pub todo_service: Arc<TodoService>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            todos: Arc::new(Mutex::new(Vec::new())),
            todo_service: Arc::new(TodoService::new()),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
```

### 6.1 为什么需要 `Arc`

axum 的每个请求都会拿到一份 `AppState`。如果 `AppState` 里直接放 `Vec<Todo>`，每个请求拿到的就是**一份拷贝**——A 请求创建的 Todo，B 请求看不到。

`Arc<T>`（Atomic Reference Counted）是**原子引用计数的共享指针**：多个 `Arc` 指向**同一个** `T`。

- `AppState` 上的 `#[derive(Clone)]`：`clone()` 一个 `AppState` 时，里面的 `Arc` 只做一次**原子加法**（加引用计数），**不拷贝数据**。
- 这和 Java 的直觉相反：Java 里 `clone()` 通常意味着深拷贝，Rust 里 `Arc::clone()` 极其廉价。

### 6.2 为什么是 `Mutex`，而且是 `tokio::sync::Mutex`

- `Mutex` 保证同一时刻只有一个请求能改 `todos`；
- 用 **`tokio::sync::Mutex`** 而不是 `std::sync::Mutex`，因为它的 `lock()` 是**异步**的：等锁时不占住操作系统线程。

> **这条规则要记牢**：在 `async fn` 里，**绝不能**跨 `.await` 持有 `std::sync::Mutex` 的守卫。任务挂起时锁没释放，另一个任务再拿同一把锁就会死锁整个线程池。而且编译器会直接拒绝（见第十四节"错误 6"）。

### 6.3 `impl Default` 是什么

实现 `Default` trait 后，`AppState::default()` 可用，而且 clippy 会**建议**所有有 `new()` 无参构造的类型都实现它（lint 名：`new_without_default`）。这是一个"顺手满足编译器建议"的例子。

### 6.4 这个设计的局限

`Arc<Mutex<Vec<Todo>>>` 意味着**所有写请求串行**。真实项目里 Todo 应该放数据库（并发由数据库保证），`Mutex<Vec<T>>` 只适合 demo、测试或读多写少的配置类数据。

---

## 七、错误处理：`src/error.rs`

```rust
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AppError {
    #[error("todo title cannot be empty")]
    InvalidTodoTitle,

    #[error("todo {id} not found")]
    TodoNotFound { id: u64 },
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match self {
            AppError::InvalidTodoTitle => StatusCode::BAD_REQUEST,
            AppError::TodoNotFound { .. } => StatusCode::NOT_FOUND,
        };

        let body = Json(json!({
            "error": self.to_string()
        }));

        (status, body).into_response()
    }
}
```

### 7.1 为什么用 enum 表达错误

因为调用方可以**穷尽匹配**所有错误，而且编译器会检查你有没有漏掉某一种。Java 里 `catch (Exception e)` 一把梭，或者漏掉某个子类要到运行期才知道。

`#[error("todo {id} not found")]` 是 thiserror 的属性：它自动生成 `Display` 实现，`{id}` 会被替换成字段值。所以 `self.to_string()` 就是 `"todo 999 not found"`。

### 7.2 `IntoResponse` 是什么

这是 **axum 定义的 trait**："我能把自己变成一个 HTTP 响应"。任何实现了 `IntoResponse` 的类型，都可以作为 handler 的返回值。

axum 已经为 `String`、`&'static str`、`StatusCode`、`Json<T>`、`(StatusCode, T)` 等常见类型实现了它。我们自己给 `AppError` 实现一次，就等于告诉 axum："这个错误应该变成什么 HTTP 响应"。

**这相当于 Spring 的 `@ControllerAdvice` + `@ExceptionHandler`，但差别很大**：

| Spring | axum |
|--------|------|
| 异常在调用栈上抛，被全局处理器接住 | 错误是 `Result` 的 `Err` 值，沿 `?` 返回 |
| 漏写一个 `@ExceptionHandler` 会返回 500 | 没实现 `IntoResponse` 的类型**编译不过** |
| 运行时匹配异常类型 | 编译期匹配 trait 实现 |

### 7.3 `json!` 宏

`json!({ "error": ... })` 是 `serde_json` 提供的宏，在编译期构造一个 JSON 值。等价于 Java 里 `Map.of("error", msg)` + Jackson 序列化，但一行搞定。

---

## 八、路由和 Handler：`src/web.rs`

```rust
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, patch},
    Json, Router,
};
use tracing::info;

use crate::{
    error::AppError,
    state::AppState,
    todo::{CreateTodoRequest, TodoResponse},
};

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/todos", get(list_todos).post(create_todo))
        .route("/todos/{id}/complete", patch(complete_todo))
        .route("/todos/{id}", delete(delete_todo))
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}

async fn list_todos(State(state): State<AppState>) -> Json<Vec<TodoResponse>> {
    let todos = state.todos.lock().await;
    let response = todos.iter().cloned().map(TodoResponse::from).collect();
    Json(response)
}

async fn create_todo(
    State(state): State<AppState>,
    Json(request): Json<CreateTodoRequest>,
) -> Result<(StatusCode, Json<TodoResponse>), AppError> {
    let mut todos = state.todos.lock().await;
    let todo = state.todo_service.create(&mut todos, request.title)?;

    info!(todo_id = todo.id, "todo created");

    Ok((StatusCode::CREATED, Json(todo.into())))
}

async fn complete_todo(
    State(state): State<AppState>,
    Path(id): Path<u64>,
) -> Result<Json<TodoResponse>, AppError> {
    let mut todos = state.todos.lock().await;
    let todo = state.todo_service.complete(&mut todos, id)?;

    info!(todo_id = id, "todo completed");

    Ok(Json(todo.into()))
}

async fn delete_todo(
    State(state): State<AppState>,
    Path(id): Path<u64>,
) -> Result<StatusCode, AppError> {
    let mut todos = state.todos.lock().await;
    state.todo_service.delete(&mut todos, id)?;

    info!(todo_id = id, "todo deleted");

    Ok(StatusCode::NO_CONTENT)
}
```

### 8.1 handler 参数不是"魔法"，是 trait

Spring MVC 里 `@RequestBody`、`@PathVariable` 是框架解析注解。axum 里，handler 就是一个普通的 `async fn`，参数类型只要实现了 **`FromRequestParts` / `FromRequest`** trait（统称 **extractor**），axum 就能自动构造它。

| 写法 | 含义 |
|------|------|
| `State(state): State<AppState>` | 取出 `.with_state()` 放进去的应用状态 |
| `Path(id): Path<u64>` | 从路径 `/todos/{id}` 里取出 `id`，并**解析成 `u64`** |
| `Json(request): Json<CreateTodoRequest>` | 把请求体当 JSON 解析成 `CreateTodoRequest` |

注意 `State(state)` 这种写法叫**解构模式匹配**：`Path(id)` 把 `Path<u64>` 里的 `u64` 绑定到变量 `id`。（第三篇讲过模式匹配。）

**路径解析失败会怎样？** 比如 `/todos/abc`，`Path<u64>` 解析不出来，axum **自动返回 400**，你的 handler 根本不会被调用。这是"把校验前移到类型系统"的典型收益——Java 里你要么靠 `@Valid`，要么在方法体里 try-catch 转换异常。

### 8.2 extractor 的顺序规则（重要）

> **消费请求体的 extractor 必须放在最后一个参数。**

`Json` 会读走整个请求体，后面的 extractor 就没得读了。所以：

```rust
// ✅ 正确：State 在前，Json 在最后
async fn create_todo(
    State(state): State<AppState>,
    Json(request): Json<CreateTodoRequest>,
) -> ...

// ❌ 错误：Json 在 State 前面
async fn create_todo(
    Json(request): Json<CreateTodoRequest>,
    State(state): State<AppState>,
) -> ...
```

写反了会得到一个很长的编译错误（见第十四节"错误 1"）。这是新手在 axum 上遇到的**第一名**问题。

### 8.3 路由写法：`{id}` 不是 `:id`

```rust
.route("/todos/{id}", delete(delete_todo))   // ✅ axum 0.8
.route("/todos/:id",  delete(delete_todo))   // ❌ axum 0.7 的写法，0.8 已移除
```

如果你照着旧教程写 `:id`，axum 0.8 会在**运行时启动路由时 panic**（不是编译错误）：

```text
thread 'main' panicked at .../matchit-0.8.4/src/lib.rs:...
invalid route: "/todos/:id" — use "{id}" instead
```

排查要点：**路由 panic 发生在启动时**，看到 `matchit` 相关的 panic 就去查路径语法。

### 8.4 `.route("/todos", get(list_todos).post(create_todo))`

`get(...)` 返回一个 `MethodRouter`，它自带 `.post()` / `.put()` / `.delete()` 等方法，可以链式挂载。所以同一路径的不同方法可以写在一行。

> 顺带一个真实的编译警告：如果你 `use axum::routing::{delete, get, patch, post}`，**`post` 会是未使用的**，因为这里用的是 `MethodRouter::post` 方法而不是 `post` 自由函数。编译器会提示 `unused import: post`。两种改法：删掉 import 里的 `post`，或者拆成两行 `.route("/todos", get(list_todos))` + `.route("/todos", post(create_todo))`。

### 8.5 返回值：`Result<T, AppError>` 也能当 handler 返回

因为 axum 为 `Result<T, E>` 实现了 `IntoResponse`：

- `Ok(t)` → 用 `t` 的 `IntoResponse`（这里我们额外套了 `StatusCode::CREATED`）；
- `Err(e)` → 用 `e` 的 `IntoResponse`（也就是我们在 `error.rs` 里写的那个实现）。

所以 handler 里可以直接用 `?`，业务错误会自动变成对应的 HTTP 状态码。

### 8.6 日志：`info!(todo_id = todo.id, "todo created")`

这是 `tracing` 的**结构化日志**：除了消息文本，还带一个字段 `todo_id`。输出形如：

```text
2026-09-16T14:28:18.123456Z  INFO todo_api::web: todo created todo_id=1
```

Java 里对应 SLF4J 的 MDC 或者 `log.info("todo created, id={}", id)`，但结构化字段可以被日志系统直接索引（ELK、Loki 等）。

---

## 九、入口：`src/lib.rs` 和 `src/main.rs`

`src/lib.rs`：

```rust
pub mod error;
pub mod state;
pub mod todo;
pub mod web;
```

`src/main.rs`：

```rust
use anyhow::Context;
use todo_api::{state::AppState, web::build_router};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let app = build_router(AppState::new());
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080")
        .await
        .context("failed to bind 0.0.0.0:8080")?;

    tracing::info!("listening on http://0.0.0.0:8080");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server failed")?;

    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("failed to install Ctrl+C handler");
}
```

### 9.1 `#[tokio::main]` 展开成什么

`async fn main()` 本身是不合法的（Rust 的 `main` 不能是 async）。`#[tokio::main]` 是一个**属性宏**，它把你的代码改写成：

```rust
fn main() -> anyhow::Result<()> {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            // ← 你写的 async main 的内容
        })
}
```

也就是说：**它创建一个 tokio 运行时，然后用 `block_on` 阻塞当前线程驱动你的异步 main**。（第六篇讲过。）

### 9.2 `anyhow::Result<()>` 和 `.context(...)`

- `anyhow` 的错误类型是"我不关心具体是什么错，只要能打印出来"；
- `.context("failed to bind ...")` 给错误**附加上下文**，打印时会显示成一条链：

```text
Error: failed to bind 0.0.0.0:8080

Caused by:
    Address already in use (os error 10048)
```

Java 里对应 `throw new RuntimeException("failed to bind 8080", e)`，但 `anyhow` 会自动维护这条链，不用手写 `super(msg, cause)`。

### 9.3 优雅关闭

`with_graceful_shutdown(shutdown_signal())` 的意思是：当 `shutdown_signal()` 这个 Future 完成时，停止接收新连接、等待正在处理的请求结束、然后退出。

**为什么需要它？** 因为直接 `Ctrl+C` 会杀掉进程，正在写的响应会被截断。生产服务必须优雅关闭（第十二篇还会讲）。

---

## 十、跑起来并用 curl 验证

```bash
cargo run
```

另开一个终端，**实测输出**（这些是真实跑出来的，不是编的）：

```text
$ curl -i http://127.0.0.1:8080/health
HTTP/1.1 200 OK
content-type: text/plain; charset=utf-8
content-length: 2

ok

$ curl -i -X POST http://127.0.0.1:8080/todos \
    -H "content-type: application/json" \
    -d '{"title":"learn rust"}'
HTTP/1.1 201 Created
content-type: application/json
content-length: 47

{"id":1,"title":"learn rust","completed":false}

$ curl -i -X POST http://127.0.0.1:8080/todos \
    -H "content-type: application/json" \
    -d '{"title":"   "}'
HTTP/1.1 400 Bad Request
content-type: application/json
content-length: 38

{"error":"todo title cannot be empty"}

$ curl http://127.0.0.1:8080/todos
[{"id":1,"title":"learn rust","completed":false}]

$ curl -i -X PATCH http://127.0.0.1:8080/todos/1/complete
HTTP/1.1 200 OK
content-type: application/json
content-length: 46

{"id":1,"title":"learn rust","completed":true}

$ curl -i -X PATCH http://127.0.0.1:8080/todos/999/complete
HTTP/1.1 404 Not Found
content-type: application/json
content-length: 30

{"error":"todo 999 not found"}

$ curl -i -X DELETE http://127.0.0.1:8080/todos/1
HTTP/1.1 204 No Content

$ curl http://127.0.0.1:8080/todos
[]
```

几个值得核对的点：

- **`POST` 返回 201**，`DELETE` 返回 **204 且没有 body**——都是我们在代码里显式指定的。
- **空标题被 trim 后判空**（`"   "` → 400），说明 `title.trim()` 生效了。
- **id 不存在的 404 消息里带着 id**：`todo 999 not found`，来自 `#[error("todo {id} not found")]`。
- **日志**：服务端终端会打出 `INFO todo_api::web: todo created todo_id=1`。想看更详细的：`RUST_LOG=debug cargo run`。

---

## 十一、集成测试：`tests/api_test.rs`

```rust
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::json;
use todo_api::{state::AppState, web::build_router};
use tower::ServiceExt;

#[tokio::test]
async fn create_and_list_todos() {
    let app = build_router(AppState::new());

    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/todos")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "title": "learn rust" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(create_response.status(), StatusCode::CREATED);

    let list_response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/todos")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(list_response.status(), StatusCode::OK);
}

#[tokio::test]
async fn empty_title_returns_bad_request() {
    let app = build_router(AppState::new());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/todos")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "title": "" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
```

### 11.1 `oneshot` 是什么

`ServiceExt::oneshot` 把 `Router` 当成一个服务，**直接喂一个请求进去、拿一个响应回来**——完全不经过网络。

这就是 MockMvc 的定位：`mockMvc.perform(post("/todos")...)`。

### 11.2 为什么要 `app.clone()`

`oneshot` 会**消费**（move）这个 Router。一次测试里要发两个请求，所以第一个用 `app.clone()`（Router 的 `clone` 很便宜，内部是 `Arc`）。

### 11.3 `#[tokio::test]`

等价于 `#[tokio::main]` 的测试版：给这个 `async fn` 创建一个 tokio 运行时。

注意：**`#[tokio::test]` 默认是单线程运行时**。如果你的代码依赖多线程（比如某些 `tokio::spawn` 的并发行为），要写 `#[tokio::test(flavor = "multi_thread")]`。

### 11.4 跑测试

```bash
cargo test
```

实测输出：

```text
running 2 tests
test todo::tests::create_rejects_empty_title ... ok
test todo::tests::complete_marks_todo_as_done ... ok
test result: ok. 2 passed; 0 failed

running 2 tests
test empty_title_returns_bad_request ... ok
test create_and_list_todos ... ok
test result: ok. 2 passed; 0 failed
```

---

## 十二、质量门禁

日常开发建议跑这三条：

```bash
cargo fmt --all --check                          # 格式化检查（≈ checkstyle）
cargo clippy --all-targets --all-features -- -D warnings   # lint，警告当错误
cargo test                                       # 单元 + 集成 + 文档测试
```

| 命令 | Java 对照 | 说明 |
|------|----------|------|
| `cargo fmt` | google-java-format / spotless | Rust 社区几乎不争论格式，直接用官方的 |
| `cargo clippy` | SpotBugs + ErrorProne + SonarLint | 非常有教育意义，会教你更地道的写法 |
| `cargo test` | `mvn test` | 包含单元测试、集成测试和**文档测试**（`///` 注释里的代码） |

想模拟 `mvn verify`，写个脚本串起来即可（第十二篇会给 CI 配置）。

> **注意 clippy 会挑这些刺**：`new()` 但没有 `impl Default`（我们实现了）；`&String` 参数应该写成 `&str`；多余的 `clone()`。它的建议通常是对的，值得逐条读。

---

## 十三、常见编译错误与排查

这一节的报错**全部是真实编译输出**（Rust 1.98 + axum 0.8.9）。建议先自己写一遍踩踩坑，再回来看。

### 错误 1：extractor 顺序写反了

```text
error[E0277]: the trait bound `fn(Json<CreateTodoRequest>, ...) -> ... {create_todo}: Handler<_, ...>` is not satisfied
 --> src\web.rs:18:47
```

**怎么读**：axum 说"你这个 `create_todo` 函数不满足 `Handler` trait"。

**为什么**：`Json` 消费了请求体，必须放最后一个参数。

**排查套路**：看到 `the trait bound ... Handler<...> is not satisfied`，九成是 handler 的**参数或返回类型**有问题（不是函数体）。

### 错误 2：忘记 `.await`

```text
error[E0599]: no method named `iter` found for opaque type `impl Future<Output = tokio::sync::MutexGuard<'_, Vec<Todo>>>`
 --> src\web.rs:30:26
```

**怎么读**：`state.todos.lock()` 返回的是一个 `impl Future`（还没执行的异步操作），你直接对它调 `.iter()`。

**为什么**：异步的 `lock()` 必须 `.await` 才真正拿到 `MutexGuard`。

**这是 Rust 异步最常见的错误**。看到 `opaque type impl Future` 出现在类型里，第一反应就是"少了个 `.await`"。

### 错误 3：值被 move 之后又用

```text
error[E0382]: use of moved value: `todo`: value used here after move
 --> src\todo.rs:61:12
```

**怎么读**：`todo` 已经被移走了（进了 `Vec`），后面又想用。

**修复**：`todos.push(todo.clone())`（先拷一份再 push），或者调整顺序先拿返回值。

**Java 程序员特别注意**：Java 里 `list.add(todo); return todo;` 完全没问题，因为 `todo` 是引用。Rust 里 `push` 默认**转移所有权**。这是"所有权"最常咬人的地方之一。

### 错误 4：返回类型没实现 `IntoResponse`

```text
error[E0277]: the trait bound `fn() -> impl Future<Output = Todo> {health}: Handler<_, _>` is not satisfied
 --> src\web.rs:17:31
```

**为什么**：`Todo` 没有实现 `IntoResponse`，axum 不知道怎么把它变成 HTTP 响应。

**修复**：要么返回 `Json<Todo>`，要么给 `Todo` 加 `#[derive(Serialize)]` 后包一层 `Json`，或者直接返回 `Json(TodoResponse::from(todo))`。

### 错误 5：忘了 `.with_state(state)`

```text
error[E0308]: mismatched types: expected `Router`, found `Router<AppState>`
 --> src\web.rs:16:5
```

**怎么读**：`Router` 其实是 `Router<()>`，但你的函数返回了 `Router<AppState>`。

**为什么**：`with_state(state)` 的作用就是把 `Router<AppState>` 变成 `Router<()>`（把状态"烧"进路由里）。忘了这一步，状态类型还挂在 `Router` 上。

**这是理解 axum 状态机制的关键**：`Router<S>` 的 `S` 是"还缺什么状态"。`with_state` 之后变成 `Router<()>`，表示"什么都不缺了，可以直接 serve"。

### 错误 6：在 async 里用 `std::sync::Mutex` 且守卫跨 `.await`

```text
error: future cannot be sent between threads safely
  --> examples\not_send.rs:11:18
   |
11 |     tokio::spawn(hold_across_await(&m));
   |                  ^^^^^^^^^^^^^^^^^^^^^ future returned by `hold_across_await` is not `Send`
   |
   = help: within `impl Future<Output = ()>`, the trait `Send` is not implemented for `std::sync::MutexGuard<'_, i32>`
note: future is not `Send` as this value is used across an await
```

**怎么读**：`MutexGuard` 不是 `Send`（不能跨线程转移），而它跨过了一个 `.await`，于是整个 Future 不是 `Send`，`tokio::spawn` 拒绝接受。

**修复**：换成 `tokio::sync::Mutex`；或者缩短锁的作用域，让守卫在 `.await` **之前**就被 drop：

```rust
let value = {
    let guard = std_lock.lock().unwrap();
    guard.clone()
};              // ← 守卫在这里就释放了
do_something_async(value).await;
```

**这条不是 axum 特有的**，所有异步 Rust 代码都适用。

### 排查工具箱

| 场景 | 命令 |
|------|------|
| 报错太长看不清 | `cargo build --message-format short`（每条错误一行） |
| 看完整错误解释 | `rustc --explain E0382` |
| 想让 clippy 直接修 | `cargo clippy --fix` / `cargo fix` |
| 怀疑是缓存问题 | `cargo clean && cargo build` |
| 想知道宏展开成啥 | `cargo expand` |
| 依赖版本冲突 | `cargo tree -d`（看重复依赖） |

---

## 十四、这个 demo 离生产还差什么

| 缺口 | 怎么做 |
|------|--------|
| **数据会丢** | 内存 `Vec` 重启即失。换 `sqlx`（编译期检查 SQL）或 `diesel`（ORM） |
| **配置写死** | 端口 `8080` 硬编码。用 `config` crate 或环境变量（第十二篇讲） |
| **没有认证** | JWT（`jsonwebtoken`）、OAuth2，或者交给网关 |
| **校验太弱** | 加 `validator` crate，或者用 `garde`；至少限制标题长度 |
| **一次返回全部** | 加分页（`/todos?page=1&size=20`） |
| **没有可观测性** | 请求 ID 中间件、Prometheus metrics、OpenTelemetry |
| **没有超时和限流** | `tower::timeout::TimeoutLayer`、`tower::limit` |
| **状态是全局锁** | 见第六节；真并发要靠数据库 |

> **Java 程序员注意**：不要因为 Rust 写起来"显式"，就把所有逻辑塞进 handler。handler 只负责**协议适配**（取参数、转响应），业务规则仍然放在 service 或领域函数里。我们这个例子里 `web.rs` 每个 handler 都只有几行，真正的规则在 `todo.rs`。

---

## 十五、Java 程序员注意事项总结

### 依赖注入

- Rust 没有容器、没有扫描、没有运行时注入。
- 依赖关系在 `main` 里显式构造：`AppState::new()` → `build_router(state)`。
- 好处：看 `main.rs` 就知道整个应用的装配关系；坏处：大型项目要写不少"接线"代码（可以用 `axum` 的 `Extension` 或手动的 `AppContext` 缓解）。

### 错误处理

- 不用异常。错误是 `Result` 的值，`?` 提前返回。
- 库用 `thiserror`（定义自己的错误 enum），应用入口用 `anyhow`（统一兜底）。
- HTTP 映射通过 `impl IntoResponse` 完成，编译期检查。

### 并发

- `Arc` 共享，`Mutex` 保护；异步代码用 `tokio::sync::Mutex`。
- 守卫离开作用域自动释放，**不可能忘记解锁**。
- 但"忘记缩短锁作用域"仍然是性能问题——用 `{ ... }` 块显式控制范围。

### 测试

- 单元测试写在源码里（`#[cfg(test)] mod tests`），集成测试写在 `tests/`。
- 集成测试依赖 `lib.rs`，所以 Web 项目也要有库入口。
- `tower::ServiceExt::oneshot` 让我们不需要真的起服务器就能测路由。

---

## 小结

这一篇完成了一个最小 Rust Web API，并且**每一步都跑通了**：

- 用 `axum` 写 REST 路由，路径参数用 `{id}`（不是 `:id`）；
- 用 `serde` 的 `#[derive]` 处理 JSON（编译期生成，无反射）；
- 用 `thiserror` 定义错误 enum，用 `impl IntoResponse` 映射成 HTTP 状态码；
- 用 `Arc<Mutex<Vec<Todo>>>` 管理 demo 共享状态，异步里必须用 `tokio::sync::Mutex`；
- 用 `tracing` 打结构化日志；
- 用 `cargo test` 同时跑单元测试（源码内）和集成测试（`tests/` + `oneshot`）；
- 用 `fmt` / `clippy` / `test` 建立质量门禁。

如果你来自 Spring Boot，这个项目最大的差异不是语法，而是**依赖关系全部显式**：没有容器扫描，没有运行时注入，没有反射魔法。刚开始会觉得手动，但边界也因此更清楚——而且相当一部分错误（参数绑定、错误映射、类型不匹配）从"运行时 500"变成了"编译期报错"。

---

## 延伸练习

**基础（改一改就能跑）**

1. 加一个 `PUT /todos/{id}` 修改标题的接口。需要新增 `UpdateTodoRequest` 和 `TodoService::rename`。
2. 给 `GET /todos` 加一个可选的 `?completed=true` 过滤（用 axum 的 `Query` extractor）。
3. 把 `AppError` 加一种新错误 `TodoTitleTooLong { max: usize }`，映射成 `400`。

**进阶（需要查文档）**

4. 加一个**请求日志中间件**（`tower_http::TraceLayer`），观察每个请求的耗时。
5. 给所有 handler 加**超时**（`tower::timeout::TimeoutLayer`），超时返回 `408`。
6. 把内存 `Vec` 换成 `sqlx` + SQLite，体会"状态从 `Arc<Mutex<Vec<T>>>` 变成数据库连接池"之后 handler 有什么变化。
7. 写一个**并发测试**：起 8 个 tokio 任务同时 `POST /todos`，断言最后 id 没有重复（体会 `AtomicU64` 的作用）。

**思考题**

8. `TodoService` 的方法接收 `&mut Vec<Todo>` 作为参数，而不是把 `Vec` 放在 `TodoService` 里。这两种设计各自的优劣是什么？如果放进 `TodoService`，`&self` 还能保持吗？

9. 如果把 `Arc<Mutex<Vec<Todo>>>` 换成 `Arc<RwLock<Vec<Todo>>>`，`GET /todos` 会变快吗？在什么负载下会？
