# 写给 Java 程序员的 Rust 入门（九）：从 Java 项目到 Rust 项目的实战迁移

> 本文是系列第九篇。前面八篇讲了 Rust 的语言、生态、测试和并发。这一篇从真实项目角度出发：如果你脑子里已经有一个 Spring Boot 服务、一个 Maven 多模块项目、一个 Service/Repository 分层应用，迁移到 Rust 时应该怎么组织代码、怎么做依赖注入、怎么处理配置、错误、日志和 Web API。

## 一、先不要照搬 Spring

很多 Java 程序员写 Rust 的第一反应是：

```text
Controller -> Service -> Repository -> Entity -> DTO
```

这个分层没有错，但 Rust 不需要 Spring 那样的容器来管理一切。Rust 更偏向：

- 显式构造依赖。
- 用 struct 表达状态。
- 用 trait 表达可替换边界。
- 用 module 控制可见性。
- 用函数和小类型组合业务逻辑。

Spring Boot 风格：

```java
@RestController
class UserController {
    private final UserService userService;

    UserController(UserService userService) {
        this.userService = userService;
    }
}
```

Rust 风格：

```rust
#[derive(Clone)]
struct AppState {
    user_service: UserService,
}

async fn create_user(
    axum::extract::State(state): axum::extract::State<AppState>,
) {
    state.user_service.create_user().await;
}
```

依赖从“容器自动注入”变成“构造时显式传入”。

## 二、项目结构推荐

一个小型 Web API 可以这样组织：

```text
user-api/
├── Cargo.toml
├── src/
│   ├── main.rs
│   ├── lib.rs
│   ├── config.rs
│   ├── error.rs
│   ├── state.rs
│   ├── user/
│   │   ├── mod.rs
│   │   ├── model.rs
│   │   ├── request.rs
│   │   ├── response.rs
│   │   ├── repository.rs
│   │   ├── service.rs
│   │   └── handler.rs
│   └── web/
│       ├── mod.rs
│       └── router.rs
└── tests/
    └── user_api_test.rs
```

对应 Java：

```text
src/main/java/com/example/user
├── controller
├── service
├── repository
├── entity
├── dto
└── config
```

Rust 不强制按技术层分包。对中小项目，更推荐按业务模块聚合：

```text
user/
  model.rs
  service.rs
  repository.rs
  handler.rs
```

这样和 `user` 相关的代码住在一起，模块边界更清楚。

## 三、binary crate 和 library crate

Java 应用通常有一个 `main` 类，其他类被它启动。Rust 项目可以同时有：

- `src/main.rs`：二进制入口。
- `src/lib.rs`：可复用库代码。

推荐把大部分业务代码放进 `lib.rs` 暴露的模块，`main.rs` 只负责启动：

```rust
// src/main.rs
use user_api::{config::Config, web::build_router};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let config = Config::from_env()?;
    let app = build_router(config).await?;

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    axum::serve(listener, app).await?;

    Ok(())
}
```

```rust
// src/lib.rs
pub mod config;
pub mod error;
pub mod state;
pub mod user;
pub mod web;
```

这样集成测试可以直接引用 `user_api::web::build_router`。

**Java 程序员注意**：不要把所有代码都塞进 `main.rs`。把业务逻辑放进 library crate，测试和复用都会容易很多。

## 四、DTO、Entity、Domain Model 怎么分

Java 常见：

```text
UserEntity    // 数据库表
UserDto       // API 返回
CreateUserRequest
User          // 领域对象，有时省略
```

Rust 也可以这样分，但不要为了“像 Java”而过度拆分。一个常见做法：

```rust
// user/model.rs
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct User {
    pub id: i64,
    pub name: String,
    pub email: String,
}
```

```rust
// user/request.rs
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub name: String,
    pub email: String,
}
```

```rust
// user/response.rs
use serde::Serialize;

use super::model::User;

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: i64,
    pub name: String,
    pub email: String,
}

impl From<User> for UserResponse {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            name: user.name,
            email: user.email,
        }
    }
}
```

**Java 程序员注意**：Rust 的 `From`/`Into` 很适合表达 DTO 转换，比到处写 `UserMapper.toDto(user)` 更贴近类型系统。

## 五、Service 层怎么写

Java Service 通常是一个 Spring Bean：

```java
@Service
class UserService {
    private final UserRepository repository;
}
```

Rust 可以用 struct：

```rust
use std::sync::Arc;

use super::{model::User, repository::UserRepository};
use crate::error::AppError;

#[derive(Clone)]
pub struct UserService<R> {
    repository: Arc<R>,
}

impl<R> UserService<R>
where
    R: UserRepository,
{
    pub fn new(repository: Arc<R>) -> Self {
        Self { repository }
    }

    pub async fn find_user(&self, id: i64) -> Result<User, AppError> {
        self.repository
            .find_by_id(id)
            .await?
            .ok_or(AppError::UserNotFound { id })
    }
}
```

Repository 用 trait 表达。为了让代码更接近 Java interface 的直觉，这里使用 `async-trait`：

```toml
[dependencies]
async-trait = "0.1"
```

```rust
use async_trait::async_trait;

use super::model::User;
use crate::error::AppError;

#[async_trait]
pub trait UserRepository: Send + Sync + 'static {
    async fn find_by_id(&self, id: i64) -> Result<Option<User>, AppError>;
}
```

现代 Rust 已经支持在 trait 里写 `async fn`，但如果你需要 `dyn UserRepository` 这种 trait object，`async-trait` 仍然是更直接的工程选择。

**Java 程序员注意**：Rust 不是所有地方都需要 interface。只有当你真的需要替换实现、隔离测试、隐藏外部系统时，再引入 trait。

这里的 `UserService<R>` 是泛型写法，性能好，编译期能看见具体类型。小项目很舒服，但服务多了以后，`AppState` 可能变成一串泛型参数。真实 Web 项目里也常见另一种写法：把 repository 存成 trait object。

```rust
#[derive(Clone)]
pub struct UserService {
    repository: Arc<dyn UserRepository>,
}

impl UserService {
    pub fn new(repository: Arc<dyn UserRepository>) -> Self {
        Self { repository }
    }
}
```

简单判断：只有一个实现、类型关系很清楚，用泛型；要运行时替换实现、AppState 不想泄漏一堆泛型、测试里经常换 fake，用 `Arc<dyn Trait>`。

## 六、Repository 层和数据库

用 `sqlx` 写 PostgreSQL repository：

```rust
use sqlx::PgPool;

use super::{model::User, repository::UserRepository};
use crate::error::AppError;

#[derive(Clone)]
pub struct PgUserRepository {
    pool: PgPool,
}

impl PgUserRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait::async_trait]
impl UserRepository for PgUserRepository {
    async fn find_by_id(&self, id: i64) -> Result<Option<User>, AppError> {
        let user = sqlx::query_as::<_, User>(
            "select id, name, email from users where id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(user)
    }
}
```

`sqlx::query!` 和 `query_as!` 宏可以做编译期 SQL 检查，但需要数据库连接或离线缓存。

对应 Java：

| Java | Rust |
|------|------|
| JPA Entity | `sqlx::FromRow` struct |
| Repository interface | trait |
| JdbcTemplate | `sqlx::query` |
| MyBatis mapper | `sqlx::query_as` |
| Flyway/Liquibase | sqlx migrate、refinery |

## 七、依赖注入怎么替代

Rust 没有主流 Spring 式 DI 容器。推荐手动组装：

```rust
use std::sync::Arc;

use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub user_service: UserService<PgUserRepository>,
}

pub async fn build_state(database_url: &str) -> anyhow::Result<AppState> {
    let pool = PgPool::connect(database_url).await?;
    let user_repository = Arc::new(PgUserRepository::new(pool));
    let user_service = UserService::new(user_repository);

    Ok(AppState { user_service })
}
```

这个函数就相当于 Spring 的配置类：

```java
@Configuration
class AppConfig {
    @Bean
    UserService userService(UserRepository repository) {
        return new UserService(repository);
    }
}
```

**Java 程序员注意**：显式装配看起来啰嗦，但依赖图清晰、启动快、没有反射、没有运行时注入失败。

## 八、配置读取

Java 常用 `application.yml` + `@ConfigurationProperties`。

Rust 可以用环境变量和 `config` crate：

```toml
[dependencies]
serde = { version = "1", features = ["derive"] }
config = "0.14"
```

```rust
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub server_addr: String,
    pub database_url: String,
}

impl Config {
    pub fn load() -> Result<Self, config::ConfigError> {
        config::Config::builder()
            .add_source(config::File::with_name("config/default").required(false))
            .add_source(config::Environment::with_prefix("APP").separator("__"))
            .build()?
            .try_deserialize()
    }
}
```

环境变量：

```bash
APP__SERVER_ADDR=0.0.0.0:8080
APP__DATABASE_URL=postgres://postgres:postgres@localhost/app
```

更小的 CLI 工具也可以直接用 `std::env`：

```rust
pub fn database_url() -> anyhow::Result<String> {
    std::env::var("DATABASE_URL")
        .map_err(|_| anyhow::anyhow!("DATABASE_URL is not set"))
}
```

## 九、错误边界

Java 里常见：

```java
throw new UserNotFoundException(id);
```

Rust 推荐库和业务层定义明确错误：

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("user {id} not found")]
    UserNotFound { id: i64 },

    #[error("database error")]
    Database(#[from] sqlx::Error),
}
```

Web 层把错误转成 HTTP 响应：

```rust
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AppError::UserNotFound { .. } => (StatusCode::NOT_FOUND, self.to_string()),
            AppError::Database(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal server error".to_string(),
            ),
        };

        (status, Json(json!({ "error": message }))).into_response()
    }
}
```

Handler 可以直接返回 `Result`：

```rust
pub async fn get_user(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::extract::Path(id): axum::extract::Path<i64>,
) -> Result<axum::Json<UserResponse>, AppError> {
    let user = state.user_service.find_user(id).await?;
    Ok(axum::Json(user.into()))
}
```

**Java 程序员注意**：这相当于 `@ControllerAdvice`，但没有异常穿透调用栈。错误是返回值，HTTP 转换是显式实现。

错误类型也要分层：库/业务边界用 `thiserror` 定义清楚的枚举，应用入口和命令式 glue code 可以用 `anyhow::Result` 加 `.context()`。不要把 `anyhow::Error` 从核心业务层一路传到 HTTP 响应层，否则调用者只知道“有错”，不知道是什么错；也不要在 `main` 里为每个 IO 错误都手写一套 enum，太啰嗦。

## 十、Handler 和 Router

Axum 路由：

```rust
use axum::{routing::get, Router};

use crate::{state::AppState, user::handler::get_user};

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/users/{id}", get(get_user))
        .with_state(state)
}
```

axum 0.8 用 `{id}` 表示路径参数；旧版文章里的 `:id` 不要直接复制。

Handler：

```rust
use axum::{extract::{Path, State}, Json};

use crate::{error::AppError, state::AppState};
use super::response::UserResponse;

pub async fn get_user(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<UserResponse>, AppError> {
    let user = state.user_service.find_user(id).await?;
    Ok(Json(user.into()))
}
```

对应 Spring：

```java
@GetMapping("/users/{id}")
UserResponse getUser(@PathVariable long id) {
    return userService.findUser(id);
}
```

Rust 的 handler 参数由 extractor 提供，类型写在函数签名里。

## 十一、日志和可观测性

Java 常用 SLF4J + Logback。Rust Web 服务建议用 `tracing`：

```toml
[dependencies]
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
```

```rust
pub fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,user_api=debug".into()),
        )
        .json()
        .init();
}
```

使用：

```rust
use tracing::{info, instrument};

#[instrument(skip(state))]
pub async fn get_user(
    state: AppState,
    id: i64,
) -> Result<UserResponse, AppError> {
    info!(user_id = id, "fetching user");
    let user = state.user_service.find_user(id).await?;
    Ok(user.into())
}
```

**Java 程序员注意**：`tracing` 不只是日志，它更接近结构化事件和 span，适合异步服务。

## 十二、Builder Pattern

Java 常用 Lombok：

```java
@Builder
class ClientConfig {
    private String baseUrl;
    private int timeoutMillis;
}
```

Rust 可以手写 builder：

```rust
#[derive(Debug, Clone)]
pub struct ClientConfig {
    pub base_url: String,
    pub timeout_millis: u64,
}

pub struct ClientConfigBuilder {
    base_url: Option<String>,
    timeout_millis: u64,
}

impl ClientConfigBuilder {
    pub fn new() -> Self {
        Self {
            base_url: None,
            timeout_millis: 3000,
        }
    }

    pub fn base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = Some(base_url.into());
        self
    }

    pub fn timeout_millis(mut self, timeout_millis: u64) -> Self {
        self.timeout_millis = timeout_millis;
        self
    }

    pub fn build(self) -> Result<ClientConfig, &'static str> {
        Ok(ClientConfig {
            base_url: self.base_url.ok_or("base_url is required")?,
            timeout_millis: self.timeout_millis,
        })
    }
}
```

也可以用 crate：

```toml
[dependencies]
derive_builder = "0.20"
```

```rust
#[derive(derive_builder::Builder)]
pub struct ClientConfig {
    pub base_url: String,
    #[builder(default = "3000")]
    pub timeout_millis: u64,
}
```

**Java 程序员注意**：Rust 里很多时候不需要 builder。字段少时直接构造 struct 更清晰。

## 十三、Workspace 和多模块项目

Java Maven 多模块：

```text
parent/
├── pom.xml
├── common/
├── user-service/
└── order-service/
```

Rust workspace：

```text
platform/
├── Cargo.toml
├── crates/
│   ├── common/
│   ├── user-api/
│   └── order-api/
```

根 `Cargo.toml`：

```toml
[workspace]
members = [
    "crates/common",
    "crates/user-api",
    "crates/order-api",
]
resolver = "2"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
thiserror = "1"
```

子 crate 引用 workspace 依赖：

```toml
[dependencies]
serde = { workspace = true }
tokio = { workspace = true }
```

常用命令：

```bash
cargo test --workspace
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo build --workspace --release
```

## 十四、迁移时的取舍

不是所有 Java 项目都适合整体迁移。推荐按边界切：

| Java 项目部分 | 是否适合先迁移到 Rust | 原因 |
|---------------|----------------------|------|
| CLI 工具 | 很适合 | 发布成单文件二进制，启动快 |
| 数据处理任务 | 适合 | 性能好，内存可控 |
| 网关/代理 | 适合 | 高并发 IO，资源占用低 |
| 核心业务 CRUD | 视情况 | Spring 生态成熟，迁移收益未必大 |
| 大量依赖 JVM 中间件的系统 | 谨慎 | 生态替换成本高 |
| 性能瓶颈模块 | 很适合 | 可以局部重写，通过 HTTP/FFI/消息集成 |

**Java 程序员注意**：Rust 不是 Spring 的平替。它更适合你需要高性能、低资源占用、强类型边界、可部署性好的场景。

## 十五、一个迁移清单

从一个 Java 服务迁移到 Rust，可以按这个顺序：

1. 定义边界：迁移整个服务，还是迁移一个独立模块。
2. 建 Cargo 项目：先拆 `main.rs` 和 `lib.rs`。
3. 建配置：环境变量、配置文件、启动参数。
4. 建错误类型：业务错误、数据库错误、外部服务错误。
5. 建领域模型和 DTO：先少拆，等复杂度上来再细分。
6. 建 repository trait：隔离数据库或外部依赖。
7. 建 service struct：显式传入依赖。
8. 建 handler/router：暴露 HTTP API。
9. 加日志和 tracing：保证线上可观察。
10. 加单元测试和集成测试：先覆盖业务规则和错误路径。
11. 加质量门禁：`fmt`、`clippy`、`test`。
12. 再考虑 workspace、多 crate、宏、复杂抽象。

## 十六、常见反模式

### 1. 为每个 struct 都写 trait

Java 里常见 `UserService` + `UserServiceImpl`。Rust 不需要这样：

```rust
// 如果只有一个实现，不需要 trait
pub struct UserService {
    // ...
}
```

只有需要替换实现时再抽 trait：

```rust
pub trait EmailSender {
    async fn send(&self, email: Email) -> Result<(), AppError>;
}
```

### 2. 到处使用 Arc<Mutex<T>>

`Arc<Mutex<T>>` 是工具，不是默认架构。优先考虑：

- 能不能让数据不可变？
- 能不能把所有权交给单个 owner？
- 能不能用 channel 传消息？
- 能不能把状态放到数据库？

### 3. 滥用 clone

看到 borrow checker 报错就 `clone()`，会让性能和语义都变差。先问自己：

- 这个函数真的需要拥有数据吗？
- 能不能接收 `&str` 而不是 `String`？
- 能不能接收 `&[T]` 而不是 `Vec<T>`？

### 4. 把 Java 异常思维带过来

Rust 错误应该在函数签名里：

```rust
fn load_config() -> Result<Config, ConfigError>
```

而不是到处 `panic!`。

### 5. 一开始就拆成很多 crate

先用 module。等边界稳定、复用需求明确，再拆 crate 或 workspace。

## 十七、Java vs Rust 项目映射总表

| Java / Spring | Rust |
|---------------|------|
| `pom.xml` / `build.gradle` | `Cargo.toml` |
| parent module | workspace |
| package | module |
| class | struct + impl |
| interface | trait |
| enum | enum，比 Java enum 更强 |
| Optional | Option |
| Exception | Result / thiserror |
| Controller | axum handler |
| `@ControllerAdvice` | `IntoResponse` for error |
| Service Bean | service struct |
| Repository Bean | repository struct + trait |
| DI container | 显式构造 AppState |
| `application.yml` | config crate / env |
| Jackson | serde |
| JUnit | cargo test |
| Mockito | trait fake / mockall |
| SLF4J | tracing |
| ExecutorService | thread pool crate / rayon / tokio |

## 小结

这一篇把 Rust 放进真实项目语境里：

- Rust 项目不要照搬 Spring 容器模型，优先显式依赖。
- 小项目用 module，大项目再考虑 workspace。
- `main.rs` 负责启动，`lib.rs` 承载业务代码，方便测试。
- DTO 转换适合用 `From`/`Into`。
- Repository 边界可以用 trait，但不要为抽象而抽象。
- Web 错误可以通过 `IntoResponse` 显式映射成 HTTP 响应。
- 配置、日志、测试、质量门禁要从项目初期就建立。

读完这一篇，项目迁移这条主线就完整了。真正掌握 Rust 的方法还是写项目：先写小工具，再写 API，再把某个你熟悉的 Java 模块用 Rust 重写一遍。编译器会很严格，但它也会是你最稳定的搭档。
