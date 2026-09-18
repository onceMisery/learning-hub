//! # 阶段 2：内存 KV —— 所有权与借用
//!
//! 目标：实现一个最小可用的 `HashMap` 版 KV，并**刻意**撞上借用检查器，
//! 理解为什么 Java 里随手就写的 `map.get(k)` 在 Rust 里要区分"借用"和"取走"。
//!
//! ## 与 Java 的对照
//!
//! | Java | Rust |
//! |------|------|
//! | `Map<String, byte[]> map` | `HashMap<String, Vec<u8>>` |
//! | `map.get(k)` 返回引用，GC 保证对象活着 | `map.get(k)` 返回 `Option<&Vec<u8>>`，**编译器**保证借用期间没人改 |
//! | 迭代中 `map.put()` → `ConcurrentModificationException`（运行期） | 借用中 `map.insert()` → **编译失败** |
//! | 参数 `String key`（谁都能改你的对象） | 参数 `&str`（借用，函数内不能改也不能带走） |
//! | `new String(bytes)` 到处拷贝 | 能借用就借用，实在要走才 `to_owned()` / `clone()` |
//!
//! 一句话总结心智模型：**Java 的引用是"谁都可以拿、GC 负责收"；
//! Rust 的引用是"同一时刻，要么一个可写，要么多个只读，编译期定死"。**

use std::collections::HashMap;

/// 一个最小内存 KV 存储。
///
/// 注意：这里没有实现 `Clone`，也没有 `Default` 之外的构造器魔法——
/// Rust 里"值类型"是默认选择，只有明确需要堆共享时才用 `Arc`（见阶段 7）。
#[derive(Debug, Default)]
pub struct InMemKv {
    // 字段默认私有（≈ Java 的 private），模块外只能通过方法访问。
    // 这是 Rust 的封装边界：模块 = 可见性单位，不是 class。
    inner: HashMap<String, Vec<u8>>,
}

impl InMemKv {
    /// 创建空实例。
    ///
    /// 为什么是 `new()` + `Default` 而不是只有 `new()`？
    /// 因为 clippy 的 `new_without_default` 会警告：
    /// 有 `new()` 就应该实现 `Default`，这样 `#[derive(Default)]` 的结构体组合时（比如
    /// `#[derive(Default)] struct Config { kv: InMemKv }`）才能自动初始化。
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// 写入一个键值对，返回被覆盖的旧值。
    ///
    /// 两个参数都用 `impl Into<T>`，这是 Rust 的**静态分发泛型**写法：
    /// - `key` 可以传 `&str`（借用）也可以传 `String`（移交所有权），调用方自己决定
    /// - 相比 Java 的重载（`set(String)` / `set(byte[])`），这里一份代码覆盖所有可转换类型
    /// - 相比 `&str` 定死，调用方持有 `String` 时不必先 `&s[..]` 转换
    ///
    /// 代价：函数会被**单态化**（monomorphization），编译器为每个实际类型生成一份机器码。
    /// 这就是为什么 Rust 泛型没有 Java 泛型那种"擦除 + 装箱"的运行时开销。
    pub fn set(&mut self, key: impl Into<String>, value: impl Into<Vec<u8>>) -> Option<Vec<u8>> {
        // &mut self：独占借用。调用期间该实例不能被别处读或写——编译期保证。
        self.inner.insert(key.into(), value.into())
    }

    /// 读取一个键，**返回借用而不是拷贝**。
    ///
    /// 这是本阶段最重要的一行代码。返回 `Option<&[u8]>` 意味着：
    /// 1. 零拷贝：没有内存复制，也没有 GC 压力
    /// 2. 调用方拿到的是"视图"，不能改，也不能活得比 `self` 久（生命周期约束）
    /// 3. 借用期间 `self` 被"只读冻结"，任何 `&mut self` 调用都会编译失败
    ///
    /// Java 的等价物是返回 `ByteBuffer.asReadOnlyBuffer()`，但那只是**约定**，
    /// 底层数组仍可能被别人改；Rust 这里是硬约束。
    #[must_use]
    pub fn get(&self, key: &str) -> Option<&[u8]> {
        // HashMap::get 的 key 只需要 &str（借用），不需要 String。
        // 若签名写成 &String，调用方传 &str 就必须先分配——这是 clippy::ptr_arg 会抓的典型问题。
        self.inner.get(key).map(Vec::as_slice)
    }

    /// 需要"拥有数据"时的读取版本。
    ///
    /// 什么时候需要？比如要把值跨线程送出去、或者存进另一个结构。
    /// 明确写出 `get_owned` 而不是让 `get` 偷偷 clone——**拷贝在 Rust 里应该是显式的**，
    /// 这是和 Java（到处 `new ArrayList<>(list)`）很不同的工程习惯。
    #[must_use]
    pub fn get_owned(&self, key: &str) -> Option<Vec<u8>> {
        self.get(key).map(<[u8]>::to_vec)
    }

    /// 删除键，返回被删除的值（所有权移交给调用方）。
    pub fn delete(&mut self, key: &str) -> Option<Vec<u8>> {
        self.inner.remove(key)
    }

    /// 判断键是否存在。
    #[must_use]
    pub fn contains(&self, key: &str) -> bool {
        self.inner.contains_key(key)
    }

    /// 当前键的数量。
    #[must_use]
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    /// 是否为空。
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// 按前缀扫描键，返回一个**惰性迭代器**。
    ///
    /// 为什么返回 `impl Iterator` 而不是 `Vec<String>`？
    /// - Java 的 Stream 是惰性求值，但每次都要 `.collect()` 分配；这里调用方决定要不要收集
    /// - `impl Trait` 返回位置让你**换实现不破坏 API**（今天返回 filter+map，明天换成跳表扫描）
    /// - 若返回具体类型（比如 `std::collections::hash_map::Iter`），内部结构泄漏到 API 里就改不动了
    ///
    /// 生命周期 `'k` 的含义：迭代器借用 `self`，因此**不能活得比 self 久**。
    /// 编译器会追踪这一点——Java 里做不到（所以才有 `ConcurrentModificationException` 和内存泄漏）。
    pub fn scan_prefix<'k>(&'k self, prefix: &'k str) -> impl Iterator<Item = (&'k str, &'k [u8])> + 'k {
        self.inner
            .iter()
            .filter(move |(k, _)| k.starts_with(prefix)) // move 把 prefix 的所有权移进闭包
            .map(|(k, v)| (k.as_str(), v.as_slice()))
    }
}

// ---------------------------------------------------------------------------
// 下面三个函数是"Java 直觉会写错、Rust 编译器会拦住"的典型案例。
// 它们被注释掉了，因为**编译不过**——正是我们要展示的点。
// 想亲自体验，就取消注释然后 `cargo build`，读一遍编译器的报错。
// ---------------------------------------------------------------------------

// /// ❌ 案例 A：借用期间试图修改（Java 里这会静默成功，然后可能 CME）
// pub fn java_habit_a(kv: &mut InMemKv) {
//     let v = kv.get("a");            // 不可变借用开始
//     kv.set("b", b"new".to_vec());   // ❌ E0502: cannot borrow `*kv` as mutable
//     println!("{:?}", v);            // v 在这里还被使用，所以借用还活着
// }
// // ✅ 修复 1：先算完再用，缩短借用作用域（NLL 非词法生命周期会自动生效）
// // ✅ 修复 2：确实需要数据时就 get_owned() 拿走所有权

// /// ❌ 案例 B：返回局部变量的引用（Java 里返回对象引用完全没问题）
// pub fn java_habit_b() -> &'static [u8] {
//     let local = vec![1u8, 2, 3];
//     &local  // ❌ E0515: cannot return reference to local variable
// }
// // ✅ 修复：返回 Vec<u8>（移交所有权），而不是 &[u8]

// /// ❌ 案例 C：同一个值被 move 两次（Java 里引用赋值多少次都行）
// pub fn java_habit_c() {
//     let s = String::from("hello");
//     let a = s;
//     let b = s;  // ❌ E0382: use of moved value
//     println!("{a}{b}");
// }
// // ✅ 修复：let b = a.clone(); 或 let b = &a;（借用）

#[cfg(test)]
mod tests {
    //! 对比 `JUnit`：`#[test]` ≈ `@Test`，`assert_eq!` ≈ `assertEquals`。
    //! Rust 的测试默认是**单元测试写在源码文件里**（`#[cfg(test)] mod tests`），
    //! 这样测试能访问私有成员；集成测试放 `tests/` 目录（见阶段 2 的 tests/ 示例）。
    use super::*;

    #[test]
    fn set_then_get() {
        let mut kv = InMemKv::new();
        assert_eq!(kv.set("name", b"minidb".to_vec()), None);
        assert_eq!(kv.get("name"), Some(b"minidb".as_slice()));

        // 覆盖写返回旧值——和 Java 的 Map.put 语义一致
        let old = kv.set("name", b"v2".to_vec());
        assert_eq!(old, Some(b"minidb".to_vec()));
    }

    #[test]
    fn get_missing_returns_none() {
        // Option<T> 取代了 null：这里不存在 NPE 的可能，
        // 因为编译器强制你先处理 None。
        let kv = InMemKv::new();
        assert_eq!(kv.get("nope"), None);
        assert!(!kv.contains("nope"));
    }

    #[test]
    fn delete_returns_owned_value() {
        let mut kv = InMemKv::new();
        kv.set("k", b"v".to_vec());
        assert_eq!(kv.delete("k"), Some(b"v".to_vec()));
        assert!(kv.is_empty());
    }

    #[test]
    fn scan_prefix_is_lazy_and_sorted_by_hashmap_order() {
        let mut kv = InMemKv::new();
        kv.set("user:1", b"a".to_vec());
        kv.set("user:2", b"b".to_vec());
        kv.set("order:1", b"c".to_vec());

        let hits: Vec<&str> = kv.scan_prefix("user:").map(|(k, _)| k).collect();
        assert_eq!(hits.len(), 2);
        assert!(hits.contains(&"user:1"));
    }

    /// 这个测试**故意展示借用检查器的正面效果**：
    /// 借用期间修改数据是编译错误，而不是运行期的 `ConcurrentModificationException`。
    /// 这里展示正确写法：先用完借用，再修改。
    #[test]
    fn borrow_then_mutate_needs_scoping() {
        let mut kv = InMemKv::new();
        kv.set("a", b"1".to_vec());

        {
            let v = kv.get("a").expect("a 存在");
            assert_eq!(v, b"1");
        } // ← 借用在这里结束（NLL：最后一次使用之后即失效）

        kv.set("b", b"2".to_vec()); // ✅ 现在可以改了
        assert_eq!(kv.len(), 2);
    }

    /// 想边遍历边改？Java 里用 `Iterator.remove()` 或 `ConcurrentHashMap`。
    /// Rust 的惯用法是"先收集需要改的 key，再改"——**把借用和修改在时间上分开**。
    #[test]
    fn mutate_while_scanning_collect_first() {
        let mut kv = InMemKv::new();
        kv.set("tmp:1", b"x".to_vec());
        kv.set("tmp:2", b"y".to_vec());
        kv.set("keep", b"z".to_vec());

        let doomed: Vec<String> = kv.scan_prefix("tmp:").map(|(k, _)| k.to_owned()).collect();
        for k in doomed {
            kv.delete(&k);
        }
        assert_eq!(kv.len(), 1);
        assert!(kv.contains("keep"));
    }
}
