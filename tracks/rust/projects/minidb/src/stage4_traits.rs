//! # 阶段 4：抽象层 —— trait 与泛型
//!
//! 目标：把阶段 2 的内存实现和后面阶段 5/6 的磁盘实现**统一到一个接口**下，
//! 让上层（协议层、服务器）不关心底层是内存还是磁盘。
//! 对应 Java 的 `interface KvRepository` + 两个实现类 + Spring 注入。
//!
//! ## 与 Java 的核心差异（本阶段重点）
//!
//! | | Java | Rust |
//! |--|------|------|
//! | 抽象机制 | `interface` 方法表，调用走 invokeinterface（动态分发） | `trait`：默认**静态分发**（单态化），需要时才 `dyn Trait` |
//! | 泛型实现 | 类型擦除：`List<String>` 运行期就是 `List`，`T` 不能是 int | 单态化：编译器为 `Kv<u32>`、`Kv<u64>` 各生成一份代码，可用 primitive |
//! | 给已有类型加能力 | 做不到（除非包装类 / 继承） | 可以：`impl MyTrait for Vec<u8>`，只要满足孤儿规则 |
//! | 默认方法 | ✅ default method | ✅ trait 默认方法，且能调用其他方法 |
//! | 继承 | `extends` 多继承接口 | trait 之间可以 `trait A: B`（超 trait），不是继承 |
//! | 关联类型 | 没有，靠泛型参数 | `type Item;` —— 一个实现只对应一种类型，避免 `Foo<A, B, C>` 爆炸 |
//! | 运行时多态 | 所有引用都是多态 | 只有 `&dyn Trait` / `Box<dyn Trait>` 是多态 |
//!
//! ## 孤儿规则（Orphan Rule）
//! 实现 trait 时，**trait 或类型至少要有一个是本地 crate 定义的**。
//! 所以你可以 `impl KvStore for HashMap<String, Vec<u8>>`（trait 是本地的），
//! 但不能 `impl serde::Serialize for std::net::IpAddr`（两个都是别人的）。
//! Java 没这个概念，因为接口和实现必须在同一个类里声明。

use std::fmt;
use std::time::Instant;

use crate::error::Result;
use crate::stage2_inmem::InMemKv;

/// 存储引擎的统一抽象。
///
/// `Send + Sync` 是**超 trait**（supertrait，≈ `interface KvStore extends Send, Sync`）：
/// - `Send`：所有权可以跨线程转移
/// - `Sync`：`&T` 可以跨线程共享
///
/// 标上这两个约束后，任何把 `KvStore` 实现体送进线程的代码都能通过编译检查，
/// 且**实现者也必须满足**。这是 Rust 的"无畏并发"基石，Java 完全没有对应物。
///
/// 注意方法签名：读用 `&self`，写用 `&mut self`。
/// 这比 Java 的 `interface` 表达力强得多——**接口层面就区分了读写**，
/// 于是编译器天然知道哪些调用需要独占访问。
pub trait KvStore: Send + Sync {
    /// 读取键对应的值。返回 `None` 表示不存在（不是错误）。
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>>;

    /// 写入键值对。
    fn set(&mut self, key: &str, value: Vec<u8>) -> Result<()>;

    /// 删除键，返回被删的值。
    fn delete(&mut self, key: &str) -> Result<Option<Vec<u8>>>;

    /// 前缀扫描。
    fn keys(&self, prefix: &str) -> Result<Vec<String>>;

    /// 整理存储（内存版是 no-op，磁盘版是段合并）。
    /// 返回回收的字节数。
    fn compact(&mut self) -> Result<u64>;

    // ---- 默认方法：≈ Java 的 default method ----
    // 实现者可以覆盖，也可以白嫖。这里提供组合语义，避免每个实现重复写。

    /// 判断键是否存在。
    ///
    /// 默认实现基于 `get`，但注意这会**拷贝数据**（返回 Option<Vec<u8>>）。
    /// 追求性能的实现者应该覆盖它——这就是默认方法与覆写的典型权衡。
    fn exists(&self, key: &str) -> Result<bool> {
        Ok(self.get(key)?.is_some())
    }

    /// 批量写入。默认实现逐条调用 `set`。
    fn batch_set(&mut self, pairs: &[(String, Vec<u8>)]) -> Result<()> {
        for (k, v) in pairs {
            self.set(k, v.clone())?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// 为阶段 2 的内存实现接上抽象。
// 注意：impl 块可以和类型定义不在同一个文件（只要同一个 crate），
// 这和 Java「一个类必须写在一个 .java 文件里」不同，
// 也意味着**你可以给第三方类型实现你的 trait**——这是 Rust 扩展性的关键。
// ---------------------------------------------------------------------------
impl KvStore for InMemKv {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        // InMemKv::get 返回借用，这里需要交给 trait 的 Result<Option<Vec<u8>>>，
        // 所以用 get_owned 拿所有权。阶段 9 会讨论如何改成零拷贝（关联类型 + GAT）。
        Ok(self.get_owned(key))
    }

    fn set(&mut self, key: &str, value: Vec<u8>) -> Result<()> {
        self.set(key, value);
        Ok(())
    }

    /// `delete` 名字撞车：外层的 `KvStore::delete` 和 `InMemKv::delete` 同名。
    /// 这里显式写 `InMemKv::delete(self, key)` 避免无限递归（编译器也会警告）。
    fn delete(&mut self, key: &str) -> Result<Option<Vec<u8>>> {
        Ok(InMemKv::delete(self, key))
    }

    fn keys(&self, prefix: &str) -> Result<Vec<String>> {
        Ok(self.scan_prefix(prefix).map(|(k, _)| k.to_owned()).collect())
    }

    fn compact(&mut self) -> Result<u64> {
        Ok(0) // 内存版没有可回收空间
    }

    // exists 用默认实现即可；这里覆盖它以避免无谓的数据拷贝
    fn exists(&self, key: &str) -> Result<bool> {
        Ok(self.contains(key))
    }
}

// ---------------------------------------------------------------------------
// 静态分发（泛型）：编译期为每种类型生成一份代码，调用是**直接函数调用**，
// 可被内联。≈ C++ 模板，而 Java 的泛型做不到（擦除后只能走 Object/接口）。
// ---------------------------------------------------------------------------

/// 批量执行命令 —— 泛型版本。
///
/// `S: KvStore` 是 trait bound（≈ Java 的 `<S extends KvStore>`）。
/// 区别：Java 编译后 `S` 被擦成 `KvStore`，运行期走接口分发；
/// Rust 会为 `S = InMemKv`、`S = DiskKv` 各生成一份 `run_commands::<InMemKv>` 代码。
pub fn run_commands<S: KvStore>(store: &mut S, cmds: &[crate::stage3_protocol::Command]) -> Result<Vec<crate::stage3_protocol::Response>> {
    use crate::stage3_protocol::{Command, Response};

    let mut out = Vec::with_capacity(cmds.len());
    for cmd in cmds {
        let resp = match cmd {
            Command::Set { key, value } => {
                store.set(key, value.clone())?;
                Response::Ok
            }
            Command::Get { key } => Response::from_result(store.get(key)),
            Command::Delete { key } => Response::from_result(store.delete(key)),
            Command::Exists { key } => match store.exists(key) {
                Ok(b) => Response::Bool(b),
                Err(e) => Response::Error(e.to_string()),
            },
            Command::Keys { prefix } => match store.keys(prefix) {
                Ok(ks) => Response::Keys(ks),
                Err(e) => Response::Error(e.to_string()),
            },
            Command::Ping => Response::Pong,
            Command::Compact => match store.compact() {
                Ok(_) => Response::Ok,
                Err(e) => Response::Error(e.to_string()),
            },
            Command::Quit => Response::Ok,
        };
        out.push(resp);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// 动态分发（trait object）：和 Java 的 interface 引用**几乎一样**——
// 胖指针（数据指针 + vtable 指针）≈ JVM 的对象头 + 方法表。
// 用在需要"异构集合"或"运行时决定实现"的场景（比如配置驱动切换引擎）。
// ---------------------------------------------------------------------------

/// 异构集合：同一容器里放不同实现。Java 里是 `List<KvStore>`，Rust 里必须 `Box<dyn>`。
pub struct Router {
    backends: Vec<Box<dyn KvStore>>,
}

impl Router {
    /// 创建路由器。
    #[must_use]
    pub fn new() -> Self {
        Self { backends: Vec::new() }
    }

    /// 注册一个后端实现。
    pub fn register(&mut self, backend: Box<dyn KvStore>) {
        self.backends.push(backend);
    }

    /// 写入所有后端（演示动态分发）。
    pub fn fanout_set(&mut self, key: &str, value: &[u8]) -> Result<()> {
        for b in &mut self.backends {
            b.set(key, value.to_vec())?;
        }
        Ok(())
    }
}

impl Default for Router {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// 装饰器模式：零成本抽象的最佳示例。
// Java 里实现同样效果要么用动态代理（反射开销）、要么手写包装类（样板代码）；
// Rust 里泛型包装器编译后会被内联掉，运行期开销为 0。
// ---------------------------------------------------------------------------

/// 给任意 `KvStore` 加上耗时统计的装饰器。
pub struct Timed<S> {
    inner: S,
    /// 累计写操作次数（读操作不计）。
    pub total_calls: u64,
}

impl<S> Timed<S> {
    /// 包装一个已有存储。
    pub const fn new(inner: S) -> Self {
        Self { inner, total_calls: 0 }
    }
}

impl<S: KvStore> KvStore for Timed<S> {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let started = Instant::now();
        let r = self.inner.get(key);
        log::debug!("GET {key} 耗时 {:?}", started.elapsed());
        r
    }
    fn set(&mut self, key: &str, value: Vec<u8>) -> Result<()> {
        self.total_calls += 1;
        self.inner.set(key, value)
    }
    fn delete(&mut self, key: &str) -> Result<Option<Vec<u8>>> {
        self.total_calls += 1;
        self.inner.delete(key)
    }
    fn keys(&self, prefix: &str) -> Result<Vec<String>> {
        self.inner.keys(prefix)
    }
    fn compact(&mut self) -> Result<u64> {
        self.inner.compact()
    }
}

// ---------------------------------------------------------------------------
// 扩展 trait：给**别人的类型**加方法。
// Java 里想给 String 加个方法只能写工具类 StringUtils.xxx(s)；
// Rust 里可以定义 trait 并为 &str 实现，于是 `"a".to_snake_key()` 直接可用。
// ---------------------------------------------------------------------------

/// 键的规范化辅助能力。
pub trait KeyNormalize {
    /// 把任意输入规范化成合法键：去空白、转小写。
    fn normalize_key(&self) -> String;
}

impl KeyNormalize for str {
    fn normalize_key(&self) -> String {
        self.trim().to_lowercase()
    }
}

impl fmt::Debug for dyn KvStore + '_ {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<dyn KvStore>")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stage3_protocol::{Command, Response};

    /// 测试替身（≈ Mockito mock）：一个记录调用次数的假实现。
    /// Rust 里手写 stub 往往比引 mock 框架更简单，因为 trait 实现成本很低。
    struct Counting {
        sets: usize,
    }

    impl KvStore for Counting {
        fn get(&self, _key: &str) -> Result<Option<Vec<u8>>> {
            Ok(None)
        }
        fn set(&mut self, _key: &str, _value: Vec<u8>) -> Result<()> {
            self.sets += 1;
            Ok(())
        }
        fn delete(&mut self, _key: &str) -> Result<Option<Vec<u8>>> {
            Ok(None)
        }
        fn keys(&self, _prefix: &str) -> Result<Vec<String>> {
            Ok(vec![])
        }
        fn compact(&mut self) -> Result<u64> {
            Ok(0)
        }
    }

    #[test]
    fn trait_object_allows_heterogeneous_backends() {
        let mut router = Router::new();
        router.register(Box::new(InMemKv::new()));
        router.register(Box::new(Counting { sets: 0 }));
        router.fanout_set("k", b"v").unwrap();
    }

    #[test]
    fn generic_dispatch_runs_commands() {
        let mut kv = InMemKv::new();
        let cmds = vec![
            Command::parse("SET a 1").unwrap(),
            Command::parse("GET a").unwrap(),
            Command::parse("EXISTS a").unwrap(),
        ];
        let out = run_commands(&mut kv, &cmds).unwrap();
        assert_eq!(out[0], Response::Ok);
        assert_eq!(out[1], Response::Value(Some(b"1".to_vec())));
        assert_eq!(out[2], Response::Bool(true));
    }

    #[test]
    fn decorator_counts_calls() {
        let mut timed = Timed::new(InMemKv::new());
        timed.set("a", b"1".to_vec()).unwrap();
        timed.set("b", b"2".to_vec()).unwrap();
        assert_eq!(timed.total_calls, 2);
        assert_eq!(timed.get("a").unwrap(), Some(b"1".to_vec()));
    }

    #[test]
    fn extension_trait_on_foreign_type() {
        // 给 &str（标准库类型）加了自定义方法——Java 做不到
        assert_eq!("  Hello ".normalize_key(), "hello");
    }

    /// 对比静态分发与动态分发的 API 差异：
    /// - `impl Trait`（参数位置）= 泛型 = 静态分发 = 可内联
    /// - `&dyn Trait` = 动态分发 = vtable 查表（≈ Java invokeinterface）
    #[test]
    fn static_vs_dynamic_dispatch() {
        fn static_dispatch(store: &impl KvStore) -> usize {
            store.keys("").unwrap().len()
        }
        fn dynamic_dispatch(store: &dyn KvStore) -> usize {
            store.keys("").unwrap().len()
        }

        let mut kv = InMemKv::new();
        kv.set("a", b"1".to_vec());
        assert_eq!(static_dispatch(&kv), 1);
        assert_eq!(dynamic_dispatch(&kv), 1);
    }
}
