//! # minidb 的异步 TCP 服务器
//!
//! 这是**阶段 8 的产物**：tokio 运行时 + Actor 模式的完整服务器。
//! 和 Java 的对照：
//! - `#[tokio::main]` ≈ `SpringApplication.run()`，但它创建的是异步运行时而非 Bean 容器
//! - `tokio::spawn` ≈ `ExecutorService.submit()`，但调度单位是任务不是线程
//! - `ctrl_c().await` ≈ `Runtime.addShutdownHook()`
//!
//! 关键设计：**引擎跑在独立的 OS 线程里**（Actor），tokio 只负责网络 IO。
//! 这样引擎的阻塞磁盘 IO 永远不会卡住 reactor，同时引擎本身不需要任何锁。

use std::path::PathBuf;

use clap::Parser;
use minidb::error::Result;
use minidb::stage8_async::{bind_async, spawn_engine_actor};

/// minidb 异步服务器。
#[derive(Debug, Parser)]
#[command(name = "minidb-server", version, about = "minidb 的 TCP 服务器（tokio 异步版）")]
struct Cli {
    /// 监听地址
    #[arg(long, default_value = "127.0.0.1:6379")]
    addr: String,

    /// 数据目录
    #[arg(long, default_value = "./minidb-data")]
    dir: PathBuf,
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();
    let cli = Cli::parse();

    // 先在同步上下文里打开引擎：失败可以直接返回 Err，不用跨线程传递
    let (handle, actor_thread) = spawn_engine_actor(&cli.dir)?;

    // 起异步服务器；engine handle 是 Clone 的，每个连接任务拿一份
    let addr = bind_async(&cli.addr, handle.clone()).await?;
    println!("minidb 监听 {addr}，数据目录 {}", cli.dir.display());
    println!("用 `printf 'SET a 1\\r\\nGET a\\r\\n' | nc 127.0.0.1 {}` 测试", addr.port());

    // 等待关闭信号。注意：这里 await 的是 tokio 的 signal future，
    // **不会阻塞**任何 worker 线程——换成 std::thread::park() 就会出事。
    tokio::signal::ctrl_c().await?;
    println!("收到 SIGINT，正在优雅关闭...");

    // 1. 让 actor 线程合并后关闭引擎
    handle.shutdown();
    // 2. 等它真正结束（这里是 join 一个 OS 线程，放在 async 里会阻塞 worker，
    //    所以生产环境应该用 spawn_blocking；这里是退出路径，可以接受短暂阻塞）
    let _ = tokio::task::spawn_blocking(move || actor_thread.join()).await;

    println!("已关闭");
    Ok(())
}
