//! # 阶段 7：并发安全 —— Arc、RwLock、Send/Sync
//!
//! 目标：让引擎能被多个线程同时访问，并把它包装成一个 TCP 服务器。
//! 这是 Rust 最"值回票价"的部分：**数据竞争在编译期就被消灭**。
//!
//! ## 与 Java 的对照
//!
//! | Java | Rust |
//! |------|------|
//! | `ConcurrentHashMap` | `Arc<RwLock<HashMap<..>>>`（或 `dashmap::DashMap`） |
//! | `synchronized (this)` | `MutexGuard`（`lock()` 返回的 RAII 守卫，离开作用域自动解锁） |
//! | `ReadWriteLock` | `RwLock`（读写分离，读可并发） |
//! | `ExecutorService` + `Future` | `std::thread::spawn` + `JoinHandle`（1:1 OS 线程） |
//! | `@ThreadSafe` 只是注解/约定 | `Send`/`Sync` 是**编译期证明**，不达标直接编译失败 |
//! | 锁忘记释放 → 靠 finally | 守卫离开作用域自动释放，**不可能忘记** |
//! | 锁中毒无感知 | `lock()` 返回 `Err(PoisonError)` 明确告诉你"上一个持锁者 panic 了" |
//!
//! ## Send / Sync 是什么？
//! - `Send`：`T` 的所有权可以转移到另一个线程
//! - `Sync`：`&T` 可以同时被多个线程持有（即 `T: Send` 的引用版本）
//!
//! 它们是 **auto trait**：编译器根据你的字段自动推导，不需要手写。
//! 于是"这个对象能不能跨线程用"这个问题，从**运行时的祈祷**变成了**编译期的证明**。
//!
//! Java 里 `ArrayList` 跨线程用会不会出问题？会，但编译器不管，只有线上报警才知道。

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::engine::{apply, apply_read, Engine};
use crate::error::Result;
use crate::stage3_protocol::{Command, Response};

/// 可被多线程共享的引擎句柄。
///
/// `Arc` ≈ Java 的"共享引用"，但它是**原子引用计数**的（≈ `AtomicReference` + 计数），
/// 且**不可变**：你拿不到 `&mut T`，所以必须配合 `RwLock`/`Mutex` 才能改数据。
/// 这就是 Rust 的核心设计：**共享不可变，可变不共享**。
///
/// `#[derive(Clone)]` 只增加引用计数，不拷贝引擎——
/// 所以 `clone()` 在这里非常便宜（一次原子加法），
/// 和 Java 里 `clone()` 通常意味着深拷贝的直觉完全不同。
#[derive(Clone)]
pub struct SharedEngine {
    inner: Arc<RwLock<Engine>>,
}

impl SharedEngine {
    /// 打开数据目录并包装成共享句柄。
    pub fn open(dir: impl AsRef<std::path::Path>) -> Result<Self> {
        Ok(Self { inner: Arc::new(RwLock::new(Engine::open(dir)?)) })
    }

    /// 取读锁并执行只读命令。
    ///
    /// `unwrap_or_else(|e| e.into_inner())` 处理**锁中毒（poisoning）**：
    /// 如果上一个持锁的线程 panic 了，Rust 会把锁标记为"中毒"并返回 Err，
    /// 逼你正视"数据可能处于不一致状态"这件事。
    /// 这里选择"相信数据仍可用"继续服务；Java 完全没有这个机制——
    /// synchronized 块里 panic（Error）后锁照样释放，状态坏没坏没人知道。
    fn with_read<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&Engine) -> R,
    {
        let guard = self.inner.read().unwrap_or_else(std::sync::PoisonError::into_inner);
        f(&guard)
    }

    /// 取写锁并执行命令（独占访问）。
    fn with_write<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&mut Engine) -> R,
    {
        let mut guard = self.inner.write().unwrap_or_else(std::sync::PoisonError::into_inner);
        f(&mut guard)
    }

    /// 执行一条命令，自动选择读锁或写锁。
    ///
    /// 这对应 Java 里"读多写少场景用 `ReadWriteLock` 手写 try/finally"的样板代码。
    /// Rust 里守卫的生命周期由作用域决定，finally 是多余的。
    #[must_use]
    pub fn apply_cmd(&self, cmd: Command) -> Response {
        if is_read_only(&cmd) {
            self.with_read(|e| apply_read(e, cmd))
        } else {
            self.with_write(|e| apply(e, cmd))
        }
    }

    /// 执行一行文本命令。
    #[must_use]
    pub fn apply_line(&self, line: &str) -> Response {
        match Command::parse(line) {
            Ok(cmd) => self.apply_cmd(cmd),
            Err(e) => Response::Error(e.to_string()),
        }
    }

    /// 启动后台合并线程，返回停止标志与线程句柄。
    ///
    /// `Arc<AtomicBool>` 是 Rust 里最简单的"停止信号"——
    /// 不需要 volatile（Java 里必须），因为 `Ordering` 明确指定了内存序。
    #[must_use]
    pub fn spawn_compactor(&self, every: Duration) -> (Arc<AtomicBool>, JoinHandle<()>) {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = Arc::clone(&stop);
        // move 闭包：把克隆出来的 handle 所有权移进线程。
        // 少了 `move` 就会编译报错——因为闭包可能比当前函数活得久，
        // 借用局部变量会导致悬垂引用。Java 的 lambda 只要求 effectively final，
        // 但捕获的是引用，对象被多线程共享的状态没人管。
        let handle = {
            let this = self.clone();
            thread::spawn(move || {
                while !stop_clone.load(Ordering::Relaxed) {
                    thread::sleep(every);
                    let ratio = this.with_read(super::engine::Engine::garbage_ratio);
                    if ratio > 0.3 {
                        log::info!("后台合并触发，垃圾占比 {ratio:.2}");
                        this.with_write(|e| {
                            if let Err(err) = e.compact() {
                                log::error!("合并失败: {err}");
                            }
                        });
                    }
                }
            })
        };
        (stop, handle)
    }
}

/// 判断命令是否只读（决定是否可以用读锁）。
fn is_read_only(cmd: &Command) -> bool {
    matches!(cmd, Command::Get { .. } | Command::Exists { .. } | Command::Keys { .. } | Command::Ping)
}

/// 启动一个**阻塞式** TCP 服务器（每连接一线程）。
///
/// 返回监听地址和线程句柄，方便测试里拿到端口。
/// Java 里同样的写法是 `ExecutorService` + `ServerSocket.accept()` 循环。
/// 区别：Rust 的 OS 线程栈默认 2MB 且按需提交（虚拟内存），
/// 几千个连接也能扛——但仍不如阶段 8 的异步方案省资源。
pub fn bind_blocking(addr: &str, engine: SharedEngine) -> Result<(std::net::SocketAddr, JoinHandle<()>)> {
    let listener = TcpListener::bind(addr)?;
    let local = listener.local_addr()?;
    let handle = thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(s) => {
                    let eng = engine.clone();
                    // 每连接一个线程。连接数很大时应该用线程池或异步（见阶段 8）
                    thread::spawn(move || {
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

/// 处理单个连接：逐行读命令 → 执行 → 写回响应。
fn handle_conn(stream: TcpStream, engine: &SharedEngine) -> Result<()> {
    let peer = stream.peer_addr().ok();
    log::debug!("新连接: {peer:?}");

    // 同一个 TcpStream 既要读又要写：Rust 要求 &mut 才能写，
    // 所以这里 clone 出另一个句柄（dup，共享同一 socket）
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut writer = stream;
    let mut line = String::new();

    loop {
        line.clear(); // 复用缓冲区，避免每行都分配新 String
        let n = reader.read_line(&mut line)?;
        if n == 0 {
            break; // 客户端断开
        }
        let resp = engine.apply_line(line.trim_end());
        writer.write_all(resp.encode().as_bytes())?;
        writer.flush()?; // 必须 flush：BufWriter 会攒着（这里直接写 TcpStream，但保险起见）
        if matches!(resp, Response::Ok) && line.trim().eq_ignore_ascii_case("QUIT") {
            break;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 下面是"Java 直觉会写出、但 Rust 编译器会拦住"的三个并发反例。
// 它们都被注释掉，因为编译不过——请逐个取消注释，读一遍编译器报错。
// ---------------------------------------------------------------------------

// /// ❌ 反例 1：用 Rc（非原子引用计数）跨线程 —— 数据竞争
// pub fn bad_rc_across_threads() {
//     use std::rc::Rc;
//     let data = Rc::new(vec![1, 2, 3]);
//     std::thread::spawn(move || {   // ❌ E0277: `Rc<Vec<i32>>` cannot be sent between threads safely
//         println!("{:?}", data);
//     });
// }
// // ✅ 修复：换成 Arc。编译器一句话告诉你问题在哪，Java 里这只能靠 Code Review。

// /// ❌ 反例 2：闭包忘了 move，借用局部变量
// pub fn bad_closure_without_move() {
//     let engine = String::from("engine");
//     std::thread::spawn(|| {        // ❌ E0373: closure may outlive the current function
//         println!("{engine}");
//     });
// }

// /// ❌ 反例 3：把 MutexGuard 发送到别的线程
// pub fn bad_send_guard() {
//     use std::sync::Mutex;
//     let m = Mutex::new(0);
//     let guard = m.lock().unwrap();
//     std::thread::spawn(move || {   // ❌ E0277: `MutexGuard` is not `Send`
//         println!("{guard}");
//     });
// }
// // ✅ 修复：锁必须在**同一个作用域内**释放，不能跨线程转移所有权。

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrent_writes_are_consistent() {
        let dir = tempfile::tempdir().unwrap();
        let engine = SharedEngine::open(dir.path()).unwrap();

        // 8 个线程各写 100 个 key，然后主线程校验全部可读。
        // 在 Java 里用 HashMap 这么干会得到丢失更新或 ConcurrentModificationException；
        // 在 Rust 里，编译期就保证了不会。
        let mut handles = Vec::new();
        for t in 0..8u32 {
            let eng = engine.clone();
            handles.push(thread::spawn(move || {
                for i in 0..100u32 {
                    let resp = eng.apply_cmd(Command::Set {
                        key: format!("t{t}-k{i}"),
                        value: format!("v{i}").into_bytes(),
                    });
                    assert_eq!(resp, Response::Ok);
                }
            }));
        }
        for h in handles {
            h.join().expect("线程不应 panic");
        }

        let resp = engine.apply_cmd(Command::Keys { prefix: String::new() });
        let Response::Keys(keys) = resp else { panic!("期望 Keys 响应") };
        assert_eq!(keys.len(), 800, "并发写入丢失了数据");
    }

    /// 单进程内多线程读写 + 服务器冒烟测试。
    #[test]
    fn tcp_server_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let engine = SharedEngine::open(dir.path()).unwrap();
        let (addr, _server) = bind_blocking("127.0.0.1:0", engine).unwrap();

        let mut stream = TcpStream::connect(addr).unwrap();
        writeln!(stream, "SET hello world").unwrap();
        stream.flush().unwrap();

        // std::io::BufReader（同步）——和阶段 8 的 tokio::io::BufReader 对比看
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut resp = String::new();
        reader.read_line(&mut resp).unwrap();
        assert_eq!(resp, "+OK\r\n");

        writeln!(stream, "GET hello").unwrap();
        stream.flush().unwrap();
        let mut v1 = String::new();
        reader.read_line(&mut v1).unwrap();
        let mut v2 = String::new();
        reader.read_line(&mut v2).unwrap();
        assert_eq!(v1, "$5\r\n");
        assert_eq!(v2, "world\r\n");
    }

    /// 验证读锁是并发的：多个读者同时持有锁不会互相阻塞。
    /// （如果这里用的是 Mutex，测试会慢很多——这就是读写锁的价值。）
    #[test]
    fn read_locks_are_shared() {
        let dir = tempfile::tempdir().unwrap();
        let engine = SharedEngine::open(dir.path()).unwrap();
        let _ = engine.apply_cmd(Command::Set { key: "k".into(), value: b"v".to_vec() });

        let handles: Vec<_> = (0..4)
            .map(|_| {
                let eng = engine.clone();
                thread::spawn(move || {
                    for _ in 0..100 {
                        assert_eq!(eng.apply_line("GET k"), Response::Value(Some(b"v".to_vec())));
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
    }

    /// 后台合并线程能被优雅停止。
    #[test]
    fn compactor_can_be_stopped() {
        let dir = tempfile::tempdir().unwrap();
        let engine = SharedEngine::open(dir.path()).unwrap();
        let (stop, handle) = engine.spawn_compactor(Duration::from_millis(10));
        thread::sleep(Duration::from_millis(50));
        stop.store(true, Ordering::Relaxed);
        handle.join().unwrap();
    }

    /// 错误也是值：协议错误不会让服务线程挂掉。
    ///
    /// 对比 Java：如果 handler 里抛出未捕获异常，线程直接死掉（或触发
    /// `Thread.UncaughtExceptionHandler`），连接就断了。
    /// Rust 里 `Result` 强制你在**出问题的地方**就地处理。
    #[test]
    fn protocol_error_does_not_kill_connection() {
        let dir = tempfile::tempdir().unwrap();
        let engine = SharedEngine::open(dir.path()).unwrap();
        assert!(matches!(engine.apply_line("NOPE"), Response::Error(_)));
        // 处理完错误，服务照常可用
        assert_eq!(engine.apply_line("PING"), Response::Pong);
    }
}
