//! # 阶段 3：协议层 —— enum 与模式匹配
//!
//! 目标：把文本命令解析成结构化的 `Command`，再把结果编码回字符串。
//! 这一层对应 Java Web 项目里的 **DTO + 参数校验器**（`@RequestBody` + Bean Validation）。
//!
//! ## 与 Java 的对照
//!
//! | Java (17+) | Rust |
//! |------------|------|
//! | `sealed interface Command permits Set, Get, Del` | `enum Command { Set{..}, Get{..}, Del{..} }` |
//! | `record Set(String key, byte[] value)` | `Command::Set { key: String, value: Vec<u8> }` |
//! | `switch (cmd) { case Set s -> ... }`（Java 21 模式匹配） | `match cmd { Command::Set {..} => ... }` |
//! | 忘记 default 分支 → 运行期 `MatchException` | 漏一个变体 → **编译失败**（穷尽性检查） |
//! | `Optional<T>` 是个类，装箱、可为 null 本身 | `Option<T>` 是 enum，且 `Option<&T>` 大小和 `&T` 一样（空指针优化） |
//! | `null` 检查靠人 + `@NonNull` 注解 | 根本没有 null，只能匹配 `Some/None` |
//! | enum 只是常量列表（Java 5 enum） | enum 是**代数数据类型**，每个变体能带不同类型和数量的数据 |
//!
//! ## 为什么 Rust 的 enum 威力更大
//! 因为 `match` 的穷尽性是编译期强制的，加上 enum 能携带数据，
//! 就形成了所谓的"让非法状态无法表示"（make illegal states unrepresentable）。
//! 你没法写出"Set 命令但没有 key"这种对象——因为构造不出来。

use serde::{Deserialize, Serialize};
use std::fmt;

use crate::error::{KvError, Result};

/// 客户端发来的命令。
///
/// 这是**代数数据类型（ADT）**里的「和类型」（sum type）：
/// 一个 `Command` 要么是 Set，要么是 Get，…… 不能同时是多个。
/// Java 要做等价建模，需要 sealed interface + 一堆 record（Java 17+ 才支持）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Command {
    /// `SET key value`
    Set {
        /// 键。
        key: String,
        /// 值。用 `Vec<u8>` 而不是 `String`：KV 存储必须能存任意二进制，
        /// Java 里通常用 `byte[]` 或 `ByteBuffer`，但要注意它们是可变的。
        value: Vec<u8>,
    },
    /// `GET key`
    Get {
        /// 键。
        key: String,
    },
    /// `DEL key`
    Delete {
        /// 键。
        key: String,
    },
    /// `EXISTS key`
    Exists {
        /// 键。
        key: String,
    },
    /// `KEYS prefix` —— 前缀扫描
    Keys {
        /// 键前缀；空字符串表示全部。
        prefix: String,
    },
    /// `PING` —— 健康检查
    Ping,
    /// `COMPACT` —— 触发段合并
    Compact,
    /// `QUIT` —— 关闭连接
    Quit,
}

impl Command {
    /// 从一行文本解析命令（尚未处理粘包/半包，那是阶段 8 的事）。
    ///
    /// 返回 `Result<Self>` 而不是抛异常：调用方**必须**处理解析失败，
    /// 编译器会盯着。Java 里 `parse()` 抛 `IllegalArgumentException` 时，
    /// 调用方完全可以假装不知道然后让 500 打到前端。
    pub fn parse(line: &str) -> Result<Self> {
        let mut tokens = tokenize(line);
        // let-else：Rust 1.65+ 的语法糖。
        // ≈ Java 的 `if (first == null) return ...; var cmd = first;` 但更紧凑，
        // 且**编译器保证** cmd 在后续代码里一定是 Some 的值。
        let Some(first) = tokens.next() else {
            return Err(KvError::Protocol("空命令".into()));
        };

        // match 匹配 &str 时用 to_ascii_uppercase 保证大小写不敏感。
        // 注意 match 的穷尽性：这里必须有 `_ =>` 兜底，因为字符串有无限种可能。
        // 而对于 Command 这种有限变体的 enum，编译器允许你**不写**兜底并要求穷尽。
        match first.to_ascii_uppercase().as_str() {
            "SET" => {
                let key = require(tokens.next(), "SET 缺少 key")?;
                let value = require(tokens.next(), "SET 缺少 value")?;
                // 这里的 tokens.next() 返回 Option<&str>，Line 借用的切片；
                // 但 Command 要拥有数据（因为要跨线程/落盘），所以 to_owned()。
                // 这是 Rust 里最常见的动作：**解析时零拷贝，构造时拿所有权**。
                Ok(Self::Set { key: key.to_owned(), value: value.as_bytes().to_vec() })
            }
            "GET" => Ok(Self::Get { key: require(tokens.next(), "GET 缺少 key")?.to_owned() }),
            "DEL" => Ok(Self::Delete { key: require(tokens.next(), "DEL 缺少 key")?.to_owned() }),
            "EXISTS" => Ok(Self::Exists { key: require(tokens.next(), "EXISTS 缺少 key")?.to_owned() }),
            // KEYS 的 prefix 允许省略，等价于 KEYS ""（列出全部）
            "KEYS" => Ok(Self::Keys { prefix: tokens.next().unwrap_or("").to_owned() }),
            "PING" => Ok(Self::Ping),
            "COMPACT" => Ok(Self::Compact),
            "QUIT" => Ok(Self::Quit),
            other => Err(KvError::Protocol(format!("未知命令: {other}"))),
        }
    }

    /// 命令名，用于日志 / 指标（对应 Java 里 `@RequestMapping` 的 path 打点）。
    #[must_use]
    pub fn name(&self) -> &'static str {
        match self {
            Self::Set { .. } => "SET",
            Self::Get { .. } => "GET",
            Self::Delete { .. } => "DEL",
            Self::Exists { .. } => "EXISTS",
            Self::Keys { .. } => "KEYS",
            Self::Ping => "PONG",
            Self::Compact => "COMPACT",
            Self::Quit => "QUIT",
        }
    }
}

/// 服务端响应。
///
/// 注意 `Value(Option<Vec<u8>>)`：`Option` 明确表达"键不存在"，
/// 客户端拿到后必须匹配，不能像 Java 那样 `response.getValue().length` 直接 NPE。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Response {
    /// `+OK`
    Ok,
    /// 二进制值，`None` 表示 nil（键不存在）
    Value(Option<Vec<u8>>),
    /// 布尔结果
    Bool(bool),
    /// 键列表
    Keys(Vec<String>),
    /// 错误（客户端可见，不是服务崩溃）
    Error(String),
    /// `+PONG`
    Pong,
}

impl Response {
    /// 编码为行协议文本。
    ///
    /// 为什么返回值是 `String` 而不是往 `&mut impl Write` 里写？
    /// 教学版为了简单（阶段 9 会改成写进复用的缓冲区，避免每次分配）。
    #[must_use]
    pub fn encode(&self) -> String {
        match self {
            Self::Ok => "+OK\r\n".to_owned(),
            // 嵌套的 Option 用 match 处理，编译器强制你处理 None
            Self::Value(Some(v)) => {
                // 二进制值可能含 \r\n，所以用长度前缀：$<len>\r\n<bytes>\r\n
                // 这与 Redis RESP 的 bulk string 一致
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
                    // 用 write! 直接往 String 里追加，避免 format! 先分配一个临时 String
                    // （≈ Java 里用 StringBuilder.append 而不是 "a" + b + c）
                    let _ = fmt::Write::write_fmt(&mut out, format_args!("${}\r\n{k}\r\n", k.len()));
                }
                out
            }
            Self::Error(msg) => format!("-ERR {msg}\r\n"),
            Self::Pong => "+PONG\r\n".to_owned(),
        }
    }

    /// 便捷构造器：把引擎层的 `Result` 转成响应。
    ///
    /// 这是 Rust 里替代"全局异常处理器（@ControllerAdvice）"的常用手法：
    /// 在边界处一次性把 `Err` 折叠成协议错误，**中间层不需要 try/catch**。
    #[must_use]
    pub fn from_result(r: Result<Option<Vec<u8>>>) -> Self {
        match r {
            Ok(v) => Self::Value(v),
            Err(e) => Self::Error(e.to_string()),
        }
    }
}

impl fmt::Display for Response {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.encode())
    }
}

/// 极简词法分析器：按空白切分，支持双引号包裹的带空格参数。
///
/// 返回 `Vec<&'a str>` —— 全是输入字符串的**切片**，零分配。
/// 这就是为什么签名里有 `'a`：告诉编译器"输出的生命周期不超过输入"。
/// Java 里 `String.split()` 每次都新建一堆 String 对象，压力全给 GC。
fn tokenize(line: &str) -> impl Iterator<Item = &str> {
    // 手写的单趟扫描分词器，支持引号：SET msg "hello world"
    // 为什么不用 `split_whitespace()`？因为它不认引号，带空格的值会被切成两半。
    let chars = line.char_indices();
    let mut out: Vec<&str> = Vec::new();
    let mut start: Option<usize> = None;
    let mut in_quotes = false;

    for (i, c) in chars {
        match c {
            '"' => {
                if in_quotes {
                    if let Some(s) = start.take() {
                        out.push(&line[s..i]);
                    }
                    in_quotes = false;
                } else {
                    start = Some(i + 1); // 跳过开头的引号
                    in_quotes = true;
                }
            }
            c if c.is_whitespace() && !in_quotes => {
                if let Some(s) = start.take() {
                    out.push(&line[s..i]);
                }
            }
            _ => {
                start.get_or_insert(i);
            }
        }
    }
    if let Some(s) = start {
        out.push(&line[s..]);
    }
    out.into_iter()
}

/// 取出必需参数，缺失则返回协议错误。
///
/// 生命周期 `'a` 明确写了"返回值的借用来自 `token` 而不是 `msg`"：
/// 两个输入都是引用时，编译器无法猜你想返回哪一个，必须写明。
/// Java 里根本不存在这个概念——因为所有引用都由 GC 管着，不需要标注来源。
fn require<'a>(token: Option<&'a str>, msg: &str) -> Result<&'a str> {
    // ok_or_else ≈ Java 的 Optional.orElseThrow，但返回 Result 而不是抛异常。
    // 用 ok_or_else（惰性）而不是 ok_or（立即构造 String），避免无谓分配。
    token.ok_or_else(|| KvError::Protocol(msg.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_set_and_get() {
        assert_eq!(
            Command::parse("SET name minidb").unwrap(),
            Command::Set { key: "name".into(), value: b"minidb".to_vec() }
        );
        assert_eq!(Command::parse("get name").unwrap(), Command::Get { key: "name".into() });
    }

    #[test]
    fn parse_quoted_value() {
        let cmd = Command::parse("SET msg \"hello world\"").unwrap();
        assert_eq!(cmd, Command::Set { key: "msg".into(), value: b"hello world".to_vec() });
    }

    #[test]
    fn parse_errors_are_values() {
        // 错误是"值"，可以直接断言——Java 里要 assertThrows 包一层
        assert!(matches!(Command::parse("SET onlykey"), Err(KvError::Protocol(_))));
        assert!(matches!(Command::parse("BOGUS"), Err(KvError::Protocol(_))));
        assert!(matches!(Command::parse(""), Err(KvError::Protocol(_))));
    }

    #[test]
    fn encode_response_roundtrip_shape() {
        assert_eq!(Response::Ok.encode(), "+OK\r\n");
        assert_eq!(Response::Value(None).encode(), "$-1\r\n");
        assert_eq!(Response::Value(Some(b"hi".to_vec())).encode(), "$2\r\nhi\r\n");
        assert_eq!(Response::Bool(true).encode(), ":1\r\n");
        assert!(Response::Error("bad".into()).encode().starts_with("-ERR bad"));
    }

    /// 展示穷尽 match 的威力：把 `Command` 加一个新变体后，
    /// 下面这个函数会**编译失败**，提醒你所有使用该 enum 的地方都要更新。
    /// Java 的 switch 只有在 sealed + 无 default 时才勉强有类似保障。
    #[test]
    fn exhaustive_match_is_enforced() {
        fn is_write(cmd: &Command) -> bool {
            match cmd {
                Command::Set { .. } | Command::Delete { .. } | Command::Compact => true,
                // 其余变体都不是写命令
                Command::Get { .. }
                | Command::Exists { .. }
                | Command::Keys { .. }
                | Command::Ping
                | Command::Quit => false,
            }
        }
        assert!(is_write(&Command::parse("SET a b").unwrap()));
        assert!(!is_write(&Command::parse("GET a").unwrap()));
    }

    /// 附加知识：`Option<&T>` 的内存布局和 `&T` 相同（空指针优化，niche optimization）。
    /// 也就是说 Rust 的 Option **零额外开销**——Java 的 Optional 是一个真实对象，
    /// 有对象头、有装箱、有 GC 压力。这是"零成本抽象"的具体含义。
    #[test]
    fn option_is_zero_cost() {
        use std::mem::size_of;
        assert_eq!(size_of::<Option<&u8>>(), size_of::<&u8>());
        // 对比：Option<Vec<u8>> 就没法优化（Vec 本身没有空闲的 bit 模式可用）
        assert!(size_of::<Option<Vec<u8>>>() > size_of::<&u8>());
    }
}
