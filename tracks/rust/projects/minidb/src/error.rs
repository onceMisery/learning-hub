//! # 阶段 1：工程骨架与错误处理
//!
//! 这一层对应 Java 项目里的「异常体系 + 统一返回码」。
//! Java 的做法是定义 `BizException extends RuntimeException`，靠 `throws` 声明（受检）
//! 或干脆不声明（非受检），错误在**运行期**沿调用栈往上冒。
//!
//! Rust 的做法是把错误放进**类型系统**：`Result<T, E>` 是一个普通的 enum，
//! 函数签名里写不写，编译器都看得见。你没法"忘了处理"，因为不处理就编译不过
//! （或者至少会产生一个 `unused_must_use` 警告）。
//!
//! 关键映射：
//! - `throw new IOException(...)`  →  `return Err(KvError::Io(e))`
//! - `try { ... } catch (IOException e) { throw new BizException(e); }`  →  `?` 运算符
//!   （`?` 会自动调用 `From::from` 做错误类型转换，等价于"包装 cause 后继续抛"）
//! - `e.getCause()`  →  `std::error::Error::source(e)`

use std::io;
use thiserror::Error;

/// minidb 的顶层错误类型。
///
/// 为什么用一个 enum 而不是 trait + 一堆实现类？
/// 因为调用方需要**穷尽匹配**所有可能的错误（编译器会检查），
/// 而不是像 Java 那样 `catch (Exception e)` 一把梭、或者漏掉某个子类。
/// 每个变体携带的是**结构化数据**（比如 `key: String`），
/// 这比 Java 里把信息拼进 message 字符串再靠日志 grep 要好得多。
#[derive(Debug, Error)]
pub enum KvError {
    /// 磁盘 / 网络 I/O 失败。
    ///
    /// `#[from]` 会生成 `impl From<io::Error> for KvError`，
    /// 于是 `File::open(...)?` 里的 `?` 能自动把 `io::Error` 转成 `KvError`。
    /// ≈ Java 里写 `catch (IOException e) { throw new KvException(e); }`，
    /// 只不过这是编译期生成的，不用你手写。
    #[error("I/O 失败: {0}")]
    Io(#[from] io::Error),

    /// 键不存在。注意：这不是"异常"，而是业务上的正常分支，
    /// 和 Java 里 `Map.get` 返回 `null` 是同一语义，但用类型显式表达。
    #[error("键不存在: {key}")]
    KeyNotFound {
        /// 出错的键名。结构化字段比拼进 message 字符串更容易被程序处理。
        key: String,
    },

    /// 客户端协议解析失败。属于"用户错误"，应该回给客户端而不是让服务崩溃。
    #[error("协议错误: {0}")]
    Protocol(String),

    /// 数据文件损坏，通常是 WAL 写到一半断电导致的**尾部残缺**。
    /// 真实引擎的做法是截断到最后一个完整记录，而不是整个库不可用。
    #[error("数据文件损坏: {reason}（已截断到 offset {truncated_at}）")]
    Corrupted {
        /// 损坏原因。
        reason: String,
        /// 最后一个完整记录的偏移，恢复时从这里截断。
        truncated_at: u64,
    },

    /// 存储已关闭。Java 里这类问题通常是 `IllegalStateException`。
    #[error("存储已关闭")]
    Closed,

    /// 序列化 / 反序列化失败。
    #[error("序列化失败: {0}")]
    Serialization(#[from] serde_json::Error),
}

/// 项目内统一的 `Result` 别名。
///
/// ≈ Java 里自定义 `public class Result<T> { T data; KvError err; }`，
/// 但 Rust 的 `Result<T, E>` 是标准库类型，编译器和 `?` 运算符都认识它。
/// 定义别名是为了少写字：`Result<Vec<u8>>` 而不是 `Result<Vec<u8>, KvError>`。
pub type Result<T> = std::result::Result<T, KvError>;

// ---------------------------------------------------------------------------
// 下面是一个刻意保留的"反面教材"：为什么不要用 String 当错误类型？
//
// pub type BadResult<T> = std::result::Result<T, String>;
//
// 1. 调用方无法穷尽匹配，只能靠字符串比较（"connection refused".contains(...)）
// 2. 丢失了错误链（cause），排查问题时拿不到根因
// 3. 每次都要分配堆内存
//
// 库代码请定义 enum；只有**应用层**（bin）为了图快才用 `anyhow::Error` / Box<dyn Error>。
// ---------------------------------------------------------------------------

#[cfg(test)]
// 这两个测试返回 `Result` 是为了演示 Rust 测试的惯用写法
// （测试函数可以返回 Result，内部用 `?`，失败即测试失败，比 unwrap 报得更清楚）。
#[allow(clippy::unnecessary_wraps)]
mod tests {
    //! 对比 `JUnit`：
//! - `#[test]`            ≈ `@Test`
//! - `assert_eq!`         ≈ `Assertions.assertEquals`
//! - `#[should_panic]`    ≈ `assertThrows`
//! - `Result` 返回值测试   ≈  `JUnit5` 里测试方法可以抛出异常，Rust 里返回 Result 更惯用
    use super::*;

    /// 演示 `?` 如何自动转换错误类型（等价 Java 的异常链 / cause）。
    #[test]
    fn from_converts_io_error() -> Result<()> {
        let err: KvError = io::Error::new(io::ErrorKind::NotFound, "no such file").into();
        assert!(matches!(err, KvError::Io(_)));

        // `source()` ≈ `getCause()`。`#[from]` 不只是生成 From 转换，
        // thiserror 还会自动把被包装的错误接进 source 链，
        // 于是 `err.source()` 能拿到原始 io::Error——日志里打印完整错误链成为可能。
        // Java 里这需要你手写 `super(message, cause)`，忘了就断链。
        assert!(std::error::Error::source(&err).is_some());
        Ok(())
    }

    /// 演示 enum 错误的**穷尽匹配**：新增一个变体后，这里会编译失败，
    /// 强制你处理新情况。Java 的 catch 子句做不到这点（除非用 sealed + 新版 switch）。
    #[test]
    fn error_display_is_stable() {
        let e = KvError::KeyNotFound { key: "name".into() };
        assert_eq!(e.to_string(), "键不存在: name");
    }

    /// `?` 在函数内传播错误的真实写法。
    #[test]
    fn propagate_with_question_mark() -> Result<()> {
        fn inner() -> std::io::Result<()> {
            Err(io::Error::other("boom"))
        }
        fn outer() -> Result<()> {
            inner()?; // io::Error 自动转 KvError，然后提前 return Err
            Ok(())
        }
        assert!(matches!(outer(), Err(KvError::Io(_))));
        Ok(())
    }
}
