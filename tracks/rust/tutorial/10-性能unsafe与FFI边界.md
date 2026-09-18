# 写给 Java 程序员的 Rust 入门（十）：性能、unsafe 与 FFI 边界

> 本文是系列第十篇。Rust 经常被贴上“高性能”“系统编程”“替代 C/C++”的标签，但初学者最容易误会两件事：第一，Rust 不会自动让所有代码变快；第二，`unsafe` 不是日常性能优化工具。这一篇专门讲性能分析、benchmark、内存布局、`unsafe` 的边界，以及 Rust 和 Java/C 互操作时该怎么想。

## 一、先测量，再优化

Java 程序员做性能优化时会用 JMH、async-profiler、JFR。Rust 也一样：不要靠感觉优化。

Rust 常用工具：

| 目标 | Rust 工具 | Java 对照 |
|------|-----------|-----------|
| micro benchmark | criterion | JMH |
| CPU profiling | samply、perf、Instruments | async-profiler、JFR |
| heap profiling | heaptrack、dhat | YourKit、VisualVM |
| 依赖体积分析 | cargo bloat | jdeps、dependency analyzer |
| 编译产物大小 | cargo bloat、twiggy | jar/镜像体积分析 |

第一原则：

```text
能用 cargo test 证明正确性。
能用 benchmark 证明性能变化。
能用 profiler 找到真正热点。
```

**Java 程序员注意**：Rust 的零成本抽象意思是“抽象本身通常不会额外收费”，不是“所有 Rust 代码天然最快”。错误的数据结构、频繁 clone、锁粒度过大、IO 模型不合适，照样会慢。

## 二、Release 构建很重要

Rust debug 构建默认不做强优化，性能可能和 release 差很多：

```bash
cargo run
cargo run --release
cargo build --release
```

`Cargo.toml` 可以配置 release profile：

```toml
[profile.release]
opt-level = 3
lto = "thin"
codegen-units = 1
strip = true
panic = "abort"
```

含义：

| 配置 | 作用 |
|------|------|
| `opt-level = 3` | 更激进优化 |
| `lto = "thin"` | 链接时优化，兼顾速度和效果 |
| `codegen-units = 1` | 更好优化，编译更慢 |
| `strip = true` | 去掉符号，减小二进制 |
| `panic = "abort"` | panic 直接终止，减小体积 |

**Java 程序员注意**：这有点像 JVM warmup 和 JIT 参数的差异。比较 Rust 性能时，一定用 release 构建；debug 构建主要用于开发体验。

## 三、用 criterion 写 benchmark

添加依赖：

```toml
[dev-dependencies]
criterion = "0.5"

[[bench]]
name = "parse_user"
harness = false
```

目录结构：

```text
benches/
└── parse_user.rs
```

示例：

```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn parse_user_id(input: &str) -> u64 {
    input.parse().unwrap()
}

fn bench_parse_user_id(c: &mut Criterion) {
    c.bench_function("parse_user_id", |b| {
        b.iter(|| parse_user_id(black_box("123456")))
    });
}

criterion_group!(benches, bench_parse_user_id);
criterion_main!(benches);
```

运行：

```bash
cargo bench
```

`black_box` 的作用是防止编译器把你的测试代码优化掉，类似 JMH 里的 Blackhole。

## 四、常见性能误区

### 1. 到处 clone

```rust
fn greet(name: String) {
    println!("hello {name}");
}

let name = String::from("Alice");
greet(name.clone());
println!("{name}");
```

如果函数只是读数据，改成借用：

```rust
fn greet(name: &str) {
    println!("hello {name}");
}

let name = String::from("Alice");
greet(&name);
println!("{name}");
```

### 2. 过早使用 `Arc<Mutex<T>>`

`Arc<Mutex<T>>` 很方便，但锁竞争会影响吞吐。先问：

- 数据能不能不可变共享？
- 能不能按 owner 拆分状态？
- 能不能用 channel 传消息？
- 能不能把并发写入交给数据库或队列？

### 3. 用 `String` 代替 `&str`

接收字符串参数时，优先考虑：

```rust
fn find_user(name: &str) {
    // 只读，不需要拥有
}
```

只有需要保存、修改、跨线程移动时，才接收或构造 `String`。

### 4. 忽略分配

循环里反复分配：

```rust
let mut result = Vec::new();
for item in items {
    result.push(format!("user-{item}"));
}
```

如果大概知道容量：

```rust
let mut result = Vec::with_capacity(items.len());
for item in items {
    result.push(format!("user-{item}"));
}
```

## 五、内存布局和大小

Rust 的类型大小在编译期明确：

```rust
use std::mem::size_of;

fn main() {
    println!("{}", size_of::<u64>());
    println!("{}", size_of::<Option<u64>>());
    println!("{}", size_of::<String>());
    println!("{}", size_of::<Vec<u8>>());
}
```

常见大小直觉：

| 类型 | 大致含义 |
|------|----------|
| `String` | 指针 + 长度 + 容量 |
| `Vec<T>` | 指针 + 长度 + 容量 |
| `&str` | 指针 + 长度 |
| `Box<T>` | 一个指针 |
| `Arc<T>` | 一个指针，数据旁边有引用计数 |

`Option<&T>` 通常和 `&T` 一样大，因为 Rust 可以用空指针表示 `None`。这类优化叫 niche optimization。

**Java 程序员注意**：Java 对象通常有对象头，引用指向堆对象；Rust 的 struct 默认是值类型，字段可以直接内联在父对象里。

## 六、什么时候需要 unsafe

`unsafe` 允许你做一些编译器无法证明安全的事：

- 解引用裸指针。
- 调用 unsafe 函数。
- 访问或修改 mutable static。
- 实现 unsafe trait。
- 访问 union 字段。

示例：

```rust
let mut value = 42;
let ptr = &mut value as *mut i32;

unsafe {
    *ptr += 1;
}

assert_eq!(value, 43);
```

`unsafe` 不会关闭借用检查器，也不会让 Rust 变成 C。它只是允许少数额外操作，并把安全责任交给你。

**Java 程序员注意**：`unsafe` 更接近 Java 里的 `Unsafe`、JNI、直接内存访问，而不是“我想让代码快一点”的开关。普通业务代码不应该需要 `unsafe`。

## 七、unsafe 的工程边界

如果必须写 `unsafe`，推荐这样隔离：

```rust
pub struct Buffer {
    ptr: *mut u8,
    len: usize,
}

impl Buffer {
    pub fn get(&self, index: usize) -> Option<u8> {
        if index >= self.len {
            return None;
        }

        // SAFETY: index 已经检查过小于 len，ptr 由 Buffer 构造函数保证有效。
        let value = unsafe { *self.ptr.add(index) };
        Some(value)
    }
}
```

规则：

1. 把 `unsafe` 包在小函数或小模块里。
2. 对外暴露安全 API。
3. 每个 `unsafe` 块写清楚 `SAFETY` 依据。
4. 用测试覆盖边界条件。
5. 能用成熟 crate 就不要自己写。

## 八、FFI：和 C 互操作

Rust 可以导出 C ABI 函数：

```rust
#[no_mangle]
pub extern "C" fn add(left: i32, right: i32) -> i32 {
    left + right
}
```

也可以调用 C 函数：

```rust
unsafe extern "C" {
    fn abs(input: i32) -> i32;
}

fn main() {
    let value = unsafe { abs(-42) };
    assert_eq!(value, 42);
}
```

FFI 难点通常不在函数调用，而在：

- 字符串编码和内存释放。
- 谁拥有这块内存。
- 错误如何跨语言边界表达。
- 线程模型是否兼容。
- ABI 是否稳定。

跨 FFI 的 struct 必须固定布局：

```rust
#[repr(C)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}
```

没有 `#[repr(C)]` 时，Rust 不承诺字段布局，编译器有权调整字段顺序和 padding。这个值一旦传到 C/JNI 边界，布局不稳定就是 UB，不是“可能读错字段”这么简单。

字符串和内存释放也要说清楚所有权。下面这种写法是错的：

```rust
use std::ffi::CString;

fn bad_ptr() -> *const std::os::raw::c_char {
    CString::new("hello").unwrap().as_ptr()
} // CString 立刻 drop，返回的指针悬垂
```

如果 Rust 分配字符串并交给 C/Java 持有，要用 `into_raw` 转移所有权，再提供一个释放函数用 `from_raw` 拿回来释放：

```rust
use std::ffi::CString;
use std::os::raw::c_char;

#[no_mangle]
pub extern "C" fn make_message() -> *mut c_char {
    CString::new("hello").unwrap().into_raw()
}

#[no_mangle]
pub unsafe extern "C" fn free_message(ptr: *mut c_char) {
    if !ptr.is_null() {
        drop(CString::from_raw(ptr));
    }
}
```

规则很朴素：哪边分配，哪边释放；如果要跨边界转移所有权，就必须把释放 API 一起设计出来。

最后，panic 不应该穿过 `extern "C"` 边界。跨过去属于未定义行为风险。FFI 导出函数里要把 panic 转成错误码或空指针：

```rust
#[no_mangle]
pub extern "C" fn do_work() -> i32 {
    match std::panic::catch_unwind(|| {
        // 真实逻辑
        0
    }) {
        Ok(code) => code,
        Err(_) => -1,
    }
}
```

unsafe/FFI 里的 UB 不是“最多崩溃”。编译器可能基于“UB 不会发生”的假设优化代码，结果是静默错、偶现错、换个优化级别才错。这里要比 Java `Unsafe` 更保守。

## 九、Rust 和 Java 互操作

Rust 和 Java 互操作常见方式：

| 方式 | 适合场景 | 代价 |
|------|----------|------|
| HTTP/gRPC | 服务边界清晰 | 有网络开销 |
| 消息队列 | 异步解耦 | 运维复杂 |
| JNI | 同进程调用 native 库 | 边界复杂，调试困难 |
| JNA/JNR | 比 JNI 简单 | 性能和类型控制较弱 |
| 命令行子进程 | 工具集成 | 进程启动和协议处理 |
| WebAssembly | 沙箱插件 | 生态和运行时约束 |

对于 Java 项目迁移，优先推荐 HTTP/gRPC 或消息队列。JNI 适合性能热点非常明确、接口很小、团队能承担 native 调试成本的场景。

**Java 程序员注意**：不要为了“用了 Rust”就把大块业务塞进 JNI。跨语言边界越小越好，数据结构越简单越好。

## 十、性能优化清单

优化前：

- 是否用 release 构建比较？
- 是否有 benchmark 基线？
- 是否用 profiler 找到了热点？
- 是否先保证测试覆盖关键行为？

优化时：

- 减少不必要的 `clone()`。
- 减少循环中的分配。
- 缩短锁作用域。
- 用 `&str`、`&[T]` 接收只读数据。
- 对大集合预分配容量。
- CPU 密集任务考虑 rayon。
- IO 密集任务考虑 tokio。

优化后：

- benchmark 是否真的变快？
- 代码可读性是否还能接受？
- 是否引入了 `unsafe`，如果有，安全依据是否清楚？
- 是否影响错误处理和边界条件？

## 小结

这一篇讲的是 Rust 入门之后的性能边界：

- 先 benchmark 和 profile，再优化。
- release 构建和 debug 构建性能差异很大。
- `clone`、分配、锁竞争是常见性能来源。
- `unsafe` 是安全边界工具，不是日常优化开关。
- FFI 要重点处理所有权、内存释放、错误和 ABI。
- Rust 与 Java 集成时，优先选择清晰的服务边界。

学到这里，你已经可以从“会写 Rust”走向“能判断 Rust 该不该用、该怎么用、边界在哪里”。
