//! # minidb 命令行入口
//!
//! 对应 Java 的 `public static void main(String[] args)` + picocli。
//! 这里能看到 Rust 二进制项目的几个典型写法：
//! - `#[derive(Parser)]`：编译期生成参数解析（≈ picocli 注解，但零反射）
//! - `fn main() -> Result<()>`：main 也能返回 Result，Err 会自动打印并以退出码 1 退出
//! - 路径参数用 `PathBuf` / `impl AsRef<Path>` 而不是 `String`

use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use clap::Parser;
use minidb::engine::{apply, Engine};
use minidb::error::Result;
use minidb::stage3_protocol::{Command, Response};

/// 一个用 Rust 写的迷你 KV 存储引擎（教学项目）。
#[derive(Debug, Parser)]
#[command(name = "minidb", version, about = "Bitcask 风格的嵌入式 KV 存储")]
struct Cli {
    /// 数据目录
    #[arg(long, default_value = "./minidb-data")]
    dir: PathBuf,

    /// 执行一次命令后退出，例如：`minidb-cli --exec "SET a 1"`
    #[arg(long)]
    exec: Option<String>,

    /// 启动后先执行一次段合并
    #[arg(long)]
    compact: bool,
}

fn main() -> Result<()> {
    // 日志实现只在二进制里初始化——库永远只依赖 `log` facade
    // （≈ SLF4J 的门面/实现分离；Java 里靠 classpath 上的 binding 决定）
    env_logger::init();

    let cli = Cli::parse();
    let mut engine = Engine::open(&cli.dir)?;
    log::info!("数据目录: {}", cli.dir.display());

    if cli.compact {
        let reclaimed = engine.compact()?;
        println!("合并完成，回收 {reclaimed} 字节");
    }

    if let Some(line) = cli.exec {
        // 单命令模式：适合脚本调用（≈ `redis-cli SET a 1`）
        let resp = run(&mut engine, &line);
        print!("{resp}");
        io::stdout().flush()?;
    } else {
        // 交互 REPL 模式
        println!("minidb 交互模式，输入 QUIT 退出");
        println!("支持: SET/GET/DEL/EXISTS/KEYS/PING/COMPACT");
        for line in io::stdin().lock().lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            let is_quit = line.trim().eq_ignore_ascii_case("QUIT");
            let resp = run(&mut engine, &line);
            print!("{resp}");
            // 不加这行交互时会看不到输出（stdout 是行缓冲/块缓冲的）
            io::stdout().flush()?;
            if is_quit {
                break;
            }
        }
    }

    // 显式关闭：库层用 `close(self)` 而不是只靠 Drop，
    // 因为 fsync 可能失败，Drop 没法把错误告诉你。
    engine.close()?;
    Ok(())
}

/// 执行一行文本，返回响应。
///
/// 注意错误处理策略：`Command::parse` 的失败被转成 `Response::Error` 而不是往上抛。
/// **协议层的错误应该回给客户端，而不是让进程退出**——
/// 这是服务端编程的通用原则，Rust 只是把它写得更明显。
fn run(engine: &mut Engine, line: &str) -> Response {
    match Command::parse(line) {
        Ok(cmd) => apply(engine, cmd),
        Err(e) => Response::Error(e.to_string()),
    }
}
