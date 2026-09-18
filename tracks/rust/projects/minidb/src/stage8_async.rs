//! # 阶段 8：异步 —— tokio、Future 与 Actor 模式
//!
//! 目标：用 tokio 重写服务器，支持**上万并发连接**而不靠"一连接一线程"。
//! 这是 Java 开发者最容易踩坑的一章，因为心智模型和虚拟线程/线程池完全不同。
//!
//! ## 与 Java 的对照
//!
//! | Java | Rust |
//! |------|------|
//! | `CompletableFuture<T>` | `Future<Output = T>`（但是**惰性的**！） |
//! | `CompletableFuture.supplyAsync()` 立刻在线程池跑 | `async fn` 只是构造状态机，**不 await 就不执行** |
//! | `ExecutorService`（JDK 自带） | 标准库**没有**运行时，必须选 tokio/async-std/smol/glommio |
//! | Project Loom 虚拟线程（JDK 21） | 没有内建等价物；但 Rust 的 Future 更轻（几百字节的状态机） |
//! | `synchronized` 块里不能阻塞太久 | async 任务里**绝不能**阻塞（会卡死整个 worker 线程） |
//! | `BlockingQueue` 传递消息 | `tokio::sync::mpsc`（有界/无界 channel） |
//! | Akka Actor | `tokio::spawn` + channel（Rust 里 actor 通常是手写的小模式） |
//!
//! ## 三条必须记住的坑
//! 1. **Future 是惰性的**：`let f = some_async_fn();` 什么都不会发生，必须 `.await`。
//!    Java 的 `supplyAsync` 提交即执行，这是最大的直觉冲突。
//! 2. **async 里不能用 `std::sync::Mutex` 长时间持锁**，更不能跨 `.await` 持有——
//!    会导致整个 worker 线程被阻塞。要用 `tokio::sync::Mutex`，或干脆用消息传递。
//! 3. **CPU 密集或阻塞 IO 要用 `spawn_blocking`**，否则会拖垮整个 reactor。

use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::thread::{self, JoinHandle};

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

use crate::engine::{apply, apply_read, Engine};
use crate::error::Result;
use crate::stage3_protocol::{Command, Response};

// ===========================================================================
// 方案 A：Actor 模式 —— 让**单个线程**独占引擎，其他人通过消息访问它
//
// 这是 Rust 里处理"带阻塞 IO 的状态"最干净的办法：
// - 引擎永远只被一个 OS 线程持有 → 根本不需要锁
// - 客户端通过 channel 发消息，用 oneshot 收回响应
// - async 侧 `.await` 结果，不阻塞 tokio 的 worker
//
// Java 对照：这就是 Akka/Erlang 的 actor，或者 `Executors.newSingleThreadExecutor()`
// + `CompletableFuture`。区别是 Rust 用**类型系统**保证"引擎不会被两个线程同时拿到"。
// ===========================================================================

/// 发给 actor 的消息。
enum Msg {
    /// 只读命令（不需要可变访问）。
    ReadOnly(Command, oneshot::Sender<Response>),
    /// 写命令。
    Write(Command, oneshot::Sender<Response>),
    /// 停止 actor 并关闭引擎。
    Shutdown,
}

/// actor 的客户端句柄，可以 `Clone`、可以跨 `.await` 持有。
///
/// 内部只有一个 `Sender`，所以它是 `Send + Sync` 的——
/// 想把它送进 `tokio::spawn` 的任务里毫无阻碍。
#[derive(Clone)]
pub struct EngineHandle {
    tx: Sender<Msg>,
}

impl EngineHandle {
    /// 执行一条命令（异步等待 actor 处理完）。
    ///
    /// 注意：`send` 用的是 **std 的同步 channel**（`std::sync::mpsc`），
    /// 它不会阻塞 reactor——因为 actor 线程一直在 `recv()` 上等着，
    /// 发送几乎立刻返回。这是"同步原语 + 异步接口"混合的经典写法。
    pub async fn send(&self, cmd: Command) -> Result<Response> {
        let (resp_tx, resp_rx) = oneshot::channel();
        let msg = if is_read_only(&cmd) { Msg::ReadOnly(cmd, resp_tx) } else { Msg::Write(cmd, resp_tx) };

        // 如果 actor 线程已经退出，send 会失败——这是"引擎已关闭"的信号
        self.tx.send(msg).map_err(|_| crate::error::KvError::Closed)?;

        // 这里 await 的是 tokio 的 oneshot，**不会阻塞线程**
        resp_rx.await.map_err(|_| crate::error::KvError::Closed)
    }

    /// 便捷方法：写入。
    pub async fn set(&self, key: &str, value: Vec<u8>) -> Result<Response> {
        self.send(Command::Set { key: key.to_owned(), value }).await
    }

    /// 便捷方法：读取。
    pub async fn get(&self, key: &str) -> Result<Response> {
        self.send(Command::Get { key: key.to_owned() }).await
    }
}

/// 启动 actor：开一个专用 OS 线程持有引擎，返回句柄和线程句柄。
///
/// 为什么引擎用**独立 OS 线程**而不是 `tokio::task::spawn_blocking`？
/// 因为引擎的生命周期和整个服务一样长，且有状态；
/// 一个常驻线程比反复 `spawn_blocking` 更清晰、也更省。
pub fn spawn_engine_actor<P: AsRef<Path>>(dir: P) -> Result<(EngineHandle, JoinHandle<()>)> {
    let dir: PathBuf = dir.as_ref().to_path_buf();
    // 先在**当前线程**打开引擎（这样 open 失败能立刻返回 Err，不用跨线程传错误）
    let engine = Engine::open(&dir)?;
    let (tx, rx) = channel::<Msg>();

    let handle = thread::spawn(move || {
        let mut engine = engine;
        log::info!("engine actor 线程启动");
        loop {
            match rx.recv() {
                Ok(Msg::ReadOnly(cmd, resp)) => {
                    let r = apply_read(&engine, cmd);
                    let _ = resp.send(r);
                }
                Ok(Msg::Write(cmd, resp)) => {
                    let r = apply(&mut engine, cmd);
                    let _ = resp.send(r);
                }
                Ok(Msg::Shutdown) => {
                    // 消费掉 engine，触发 close()（Drop 里 flush + 释放锁）
                    if let Err(e) = engine.close() {
                        log::error!("关闭引擎失败: {e}");
                    }
                    break;
                }
                // 所有发送端都 drop 了 → 退出
                Err(_) => break,
            }
        }
        log::info!("engine actor 线程退出");
    });

    Ok((EngineHandle { tx }, handle))
}

impl EngineHandle {
    /// 请求优雅关闭。
    pub fn shutdown(&self) {
        let _ = self.tx.send(Msg::Shutdown);
    }
}

/// 判断命令是否只读。
fn is_read_only(cmd: &Command) -> bool {
    matches!(cmd, Command::Get { .. } | Command::Exists { .. } | Command::Keys { .. } | Command::Ping)
}

// ===========================================================================
// 方案 B：纯 tokio 的 TCP 服务器
//
// 每个连接是一个**任务**（不是线程），由 tokio 的多线程调度器在少量
// OS 线程上驱动。1 万个连接的内存开销约几十 MB，而线程方案要 20GB+。
// ===========================================================================

/// 启动 tokio 服务器，返回实际监听地址。
pub async fn bind_async(addr: &str, handle: EngineHandle) -> Result<std::net::SocketAddr> {
    let listener = TcpListener::bind(addr).await?;
    let local = listener.local_addr()?;
    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((socket, peer)) => {
                    log::debug!("新连接: {peer}");
                    let h = handle.clone();
                    // spawn 一个任务处理连接——开销远小于 OS 线程
                    tokio::spawn(async move {
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

/// 处理一个连接的读写循环。
///
/// `BufReader::lines()` 是 tokio 提供的**异步**行读取：
/// 读到半行时会挂起当前任务、让出线程给其他任务——
/// 这是异步 IO 的核心价值：一个线程能同时"等"上万个 socket。
async fn handle_conn(socket: TcpStream, handle: EngineHandle) -> Result<()> {
    let (reader, mut writer) = socket.into_split();
    let mut lines = BufReader::new(reader).lines();

    while let Some(line) = lines.next_line().await? {
        let resp = match Command::parse(&line) {
            Ok(cmd) => handle.send(cmd).await?,
            Err(e) => Response::Error(e.to_string()),
        };
        writer.write_all(resp.encode().as_bytes()).await?;
        // 必须 flush：tokio 的 write 也是先写进缓冲
        writer.flush().await?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 演示：**错误**的写法 —— 在 async 里做阻塞 IO。
//
// 这段代码能编译，但会把 tokio 的 worker 线程卡住，吞吐量直接崩掉。
// 想验证？在 handle_conn 里加一行，然后压测，观察 QPS 断崖式下跌。
//
//     std::thread::sleep(std::time::Duration::from_secs(1));  // ❌ 阻塞整个 worker
//     tokio::time::sleep(std::time::Duration::from_secs(1)).await;  // ✅ 正确
//
// 同理，`std::sync::Mutex` 在 async 里跨 `.await` 持锁也是禁止的：
// 任务被挂起时锁没释放，另一个任务再拿同一把锁就会**死锁整个线程池**。
// 正确做法：
//   1. 缩短临界区，不在持锁时 await；
//   2. 用 `tokio::sync::Mutex`；
//   3. 用消息传递（本文件的 Actor 方案）。
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::BufReader as TokioBufReader;

    /// `#[tokio::test]` ≈ `JUnit` 的 `@Test` + 自动创建运行时。
    /// 单线程运行时（`flavor = "current_thread"`）足以测试逻辑；
    /// 默认 `#[tokio::test]` 就是单线程的——注意这会让依赖多线程的代码行为不同。
    #[tokio::test]
    async fn actor_handles_commands() {
        let dir = tempfile::tempdir().unwrap();
        let (handle, _thread) = spawn_engine_actor(dir.path()).unwrap();

        assert_eq!(handle.set("a", b"1".to_vec()).await.unwrap(), Response::Ok);
        assert_eq!(handle.get("a").await.unwrap(), Response::Value(Some(b"1".to_vec())));
        assert_eq!(handle.get("missing").await.unwrap(), Response::Value(None));

        handle.shutdown();
    }

    /// 并发发 100 个请求，验证 actor 串行处理后结果一致。
    #[tokio::test]
    async fn concurrent_requests_via_actor() {
        let dir = tempfile::tempdir().unwrap();
        let (handle, _thread) = spawn_engine_actor(dir.path()).unwrap();

        let mut tasks = Vec::new();
        for i in 0..100u32 {
            let h = handle.clone();
            // tokio::spawn 的任务必须满足 Send + 'static
            tasks.push(tokio::spawn(async move {
                h.set(&format!("k{i}"), vec![1, 2, 3]).await.unwrap();
                h.get(&format!("k{i}")).await.unwrap()
            }));
        }
        for t in tasks {
            assert_eq!(t.await.unwrap(), Response::Value(Some(vec![1, 2, 3])));
        }
        handle.shutdown();
    }

    /// 端到端：起服务器 → 用 TCP 客户端连 → 走一遍协议。
    #[tokio::test]
    async fn async_server_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let (handle, _thread) = spawn_engine_actor(dir.path()).unwrap();
        let addr = bind_async("127.0.0.1:0", handle).await.unwrap();

        let mut stream = TcpStream::connect(addr).await.unwrap();
        stream.write_all(b"SET hello world\r\n").await.unwrap();
        stream.flush().await.unwrap();

        let (r, mut w) = stream.into_split();
        let mut lines = TokioBufReader::new(r).lines();
        assert_eq!(lines.next_line().await.unwrap().unwrap(), "+OK");

        w.write_all(b"GET hello\r\n").await.unwrap();
        w.flush().await.unwrap();
        assert_eq!(lines.next_line().await.unwrap().unwrap(), "$5");
        assert_eq!(lines.next_line().await.unwrap().unwrap(), "world");
    }
}
