# 阶段 3：TypeScript 从类型思维到工程实践

| 项目 | 内容 |
| --- | --- |
| **周期** | 3 周（约 30 小时） |
| **前置** | 完成阶段 2 [JavaScript 深度补强与去 jQuery 化](./02-JavaScript深度补强与去jQuery化.md)（尤其是 ES 模块与异步） |
| **本阶段技术栈** | TypeScript 7（Go 原生编译器，2026-09 验证） |
| **产出物** | ① 用 TS 重写的阶段 2 Todo 应用（零 `any`）② 类型体操练习集（20+ 题，带测试） |

> ⚠️ **版本提示**：TypeScript 7.0（2026-07-08 GA，2026-09 验证）是首个基于 **Go 原生编译器**（代号 Corsa）的稳定版，全量类型检查提速 **8~12 倍**，且 **`strict` 默认开启**。这意味着从你写下第一行 TS 起，就处在严格模式下——请直接按严格标准学习，不要留"以后再开"的余地。
>
> TS 7 的三条关键事实必须刻进脑子：
> 1. **编译器整体移植到 Go**：类型检查快了一个数量级，`tsc` 默认用 `--checkers 4` 并行检查，也可用 `--singleThreaded` 关掉。
> 2. **`strict` 默认开启**，且**移除了 `target: es5`、AMD / UMD / SystemJS、`moduleResolution: node10`**——老教程里的这些配置在 TS 7 会直接报错。
> 3. **7.0 暂无稳定的编程式 API**：`typescript-eslint` 等依赖编译器 API 的工具暂时不可用（预计 7.1，2026-11 补齐）。学习期直接用 `tsc --noEmit` 做类型检查即可；若确实需要类型感知 lint，可用 `@typescript/typescript6` 兼容包与 TS 7 并存（`tsc6` 可执行文件）。

---

## 一、本阶段在学习路径中的位置

- **上承**：阶段 2 [JavaScript 深度补强与去 jQuery 化](./02-JavaScript深度补强与去jQuery化.md) 里，你已经能用原生 JavaScript 写出状态驱动、零依赖的 Todo 应用，也理解了"数据 → 渲染函数 → DOM"的心智模型。但那段 JS 是**没有类型**的——函数参数什么形状、状态有哪些字段，全靠你脑子里记着，编译器帮不上忙。
- **本阶段**：给这份 JavaScript 加上 **TypeScript（类型系统）**。核心是建立**类型思维**：类型不是"写给编译器的装饰"，而是**约束**（拦住一半低级 bug）和**文档**（不读实现就能知道函数怎么用）。其中最重要的一课是理解 TS 的**结构化类型（structural typing）**——这与 Java 的**名义类型（nominal typing）** 根本不同，不扭转这个直觉，你会一直写出"看起来对、其实不对"的 TS。
- **下接**：阶段 4 [Vite 8 与现代前端工程化](./04-Vite8与现代前端工程化.md) 会把 TS 真正接进工程化流水线——`tsc` 只做类型检查，转译和打包交给 Vite 8 的 Rolldown，并标准化 ESLint / Vitest / Git 规范。本阶段的 `tsconfig` 与类型守卫，正是阶段 4 配置的输入。

> 一句话：**阶段 2 让你"写得出正确的 JS"，阶段 3 让你"写不出错误的 JS"。** 类型思维建立不起来，后面 React 项目里的 `any` 会越写越多，类型系统的收益归零。

---

## 二、学习目标（可验收）

学完本阶段，你应该能够：

1. 理解 TypeScript 的**结构化类型系统**（structural typing）与 Java 名义类型（nominal typing）的根本差异，并能解释"为什么两个结构相同的类型可以互相赋值"。
2. 熟练使用全部日常类型工具：`interface` / `type` / 联合 / 交叉 / 字面量 / 元组 / 枚举替代方案 / 索引签名 / 映射类型 / 条件类型 / 模板字面量类型。
3. 掌握**泛型**：泛型函数、泛型约束、默认类型参数、泛型与 `keyof`、`infer` 推断。
4. 掌握**类型收窄**的六种手段：`typeof`、`instanceof`、`in`、`===` 字面量判别、类型谓词（type predicate）、可辨识联合（discriminated union）。
5. 能写出正确的 `tsconfig.json`，理解每个核心选项的代价，尤其 `strict` 家族、`module` / `moduleResolution`、`verbatimModuleSyntax`、`noUncheckedIndexedAccess`。
6. 能为第三方无类型 JS 库写 `.d.ts`，能为业务数据（API 响应）建立类型守卫与运行时校验的边界。
7. 全程 `any` 数量 = 0（`unknown` + 收窄取代一切 `any`）。

---

## 三、核心概念详解

> 每个概念小节按四步走：**是什么 → 为什么需要 → 怎么用 → 坑在哪**。所有 TS 代码都在 `strict` 下可编译通过，请复制进本地 `.ts` 文件用 `tsc --noEmit` 验证。

### 3.1 类型思维：类型即约束与文档

**是什么**：类型（type）在 TypeScript 里是"值的形状的描述"。**类型思维**是指把类型当成第一公民去设计——先用类型描述数据长什么样，再写操作它的代码。

**为什么需要**：JavaScript 是动态类型，下面这种 bug 只有在线上运行时才炸；TS 在编译期就能拦住：

```ts
// 没有类型时：错误要等到运行时才暴露
function getUserName(user) {
  return user.name.toUpperCase();   // user 可能是 null，或没有 name
}

// 有类型时：编译期直接报错，根本跑不到线上
interface User {
  id: string;
  name: string;
}
function getUserName(user: User): string {
  return user.name.toUpperCase();   // user 一定非 null 且有 name
}
// getUserName(null)  ← 编译错误：Argument of type 'null' is not assignable to parameter of type 'User'
```

变量声明的差异集中在两处：**类型写在左边还是右边**，以及**类型是编译期校验还是运行期是否存在**。核心区别是 TS 和 Python 的类型在运行期被擦除或从不强制，而 Java/Rust/Go 的类型始终是静态、运行期可见的。

<LangTabs title="变量类型标注与推断：五种语言对照">
```java
String name = "lumen";        // 类型写在左边，编译期强校验
var count = 10;               // Java 21 的 var 只是推断，类型仍然固定
final var tag = "ts";         // final 让绑定不可重新赋值
```
```ts
const name: string = 'lumen'; // 类型写在右边，编译期校验、运行期擦除
let count = 10;               // 不标注也能推断出 number
let tag = 'ts';               // 推断为 string，仍可重新赋值
```
```rust
let name: String = String::from("lumen");  // 可推断时省略，但始终是静态的
let count = 10;
let tag = "ts";               // 推断为 &str，静态类型
```
```go
var name string = "lumen"     // 类型后置，:= 可省略类型
count := 10
tag := "ts"
```
```python
name: str = "lumen"           # 标注只给类型检查器看，运行时不强制
count = 10
tag = "ts"                    # 可随时指向另一种类型
```
</LangTabs>

结论：五种语言里只有 TS 与 Python 的类型在运行期“不存在”——这正是结构化类型得以成立的前提（类型只在编译期有意义）。

类型的三重价值：① **约束**——禁止非法值进入；② **文档**——不读实现就知道 `User` 有哪些字段；③ **重构安全**——改了字段名，所有用到的地方立刻报红，不会出现"改一处漏十处"。

**坑在哪**：不要把类型当成"写给编译器的负担"。初学者常犯的错是"为了过编译而加 `as` / `any`"，这等于主动放弃了类型带来的三重新值。正确做法是"让类型描述真实世界的约束"，而不是"迁就现有代码去弱化类型"。

### 3.2 结构化类型 vs 名义类型（最重要的一节）

**是什么**：**结构化类型（structural typing，也叫鸭子类型 duck typing）** 是"看结构不看名字"——只要两个类型**形状相同**，它们就互相兼容，名字叫什么无所谓。**名义类型（nominal typing）** 则是 Java 的规则：类型兼容**由名字（类名 / 接口名）决定**，即使两个类字段完全相同，只要不是同一个声明，就不能互相赋值。

**为什么需要**：这是 Java 程序员写 TS 时**最容易踩的直觉陷阱**。在 Java 里，你习惯了"类型对不对，看它 `implements` 了哪个接口"；在 TS 里，**没有 `implements` 也能赋值**——只要字段对得上。理解这一点，你才会明白为什么 TS 里 `interface` 几乎不需要 `implements`，以及为什么需要"品牌类型"去模拟 Java 的不可混用。

```ts
// 结构化类型：两个毫无关系的接口，只要结构一致就能互赋
interface Point { x: number; y: number; }
interface Vector { x: number; y: number; }
const p: Point = { x: 1, y: 2 };
const v: Vector = p;            // ✅ 合法！结构相同即可，名字不同无所谓
// 在 Java 里这行一定报错：Point 和 Vector 是两个类，没有继承 / 实现关系

// 多余属性检查（excess property check）：字面量才会被查"多出来的字段"
interface Named { name: string; }
const n: Named = { name: 'a', age: 1 };   // ❌ 字面量多出 age
const obj = { name: 'a', age: 1 };
const n2: Named = obj;                     // ✅ 变量赋值不触发多余属性检查
```

“描述一个数据结构长什么样”五种语言做法差异巨大：Java/Rust/Go 用显式接口或 trait，但 TS 的 interface 只是形状契约、**不要求被实现**；Python 用 Protocol 做结构化子类型。

<LangTabs title="接口与结构体定义：五种语言对照">
```java
interface Shape {                 // 名义类型：靠 implements 建立关系
  double area();
}
class Circle implements Shape {   // 必须显式声明实现才算 Shape
  public double area() { return 0; }
}
```
```ts
interface Shape {                 // 结构化类型：只描述形状，不要求 implements
  area(): number;
}
const c: Shape = { area: () => 0 }; // 没实现任何接口也能赋值
```
```rust
trait Shape {                     // Rust 没有 interface，用 trait 表达契约
  fn area(&self) -> f64;
}
struct Circle { r: f64 }
impl Shape for Circle {           // 在别处显式 impl，关系靠 trait 名
  fn area(&self) -> f64 { self.r }
}
```
```go
type Shape interface {           // 接口是方法集合，满足即自动实现
  Area() float64
}
type Circle struct{ R float64 }
func (c Circle) Area() float64 { return c.R }
```
```python
from typing import Protocol
class Shape(Protocol):           # 结构化子类型：有 area 方法即视为 Shape
  def area(self) -> float: ...
class Circle:
  def area(self) -> float: return 0.0
```
</LangTabs>

结论：Java 的关系是“名字绑定”（implements 了才算），其余四种（尤其 TS 与 Python）是“形状匹配”——这是名义类型与结构化类型分歧的第一现场。

当数据需要“行为”（方法）时，五种语言都用类或结构体，但“类与契约的关系”仍分两派：Java 必须显式 implements，TS 同样写 implements 但编译器只看结构，Rust 用 impl Trait 解耦类型与契约。

<LangTabs title="类与实现：五种语言对照">
```java
interface Logger { void log(String m); }
class FileLogger implements Logger {   // 显式声明实现
  public void log(String m) { }
}
```
```ts
interface Logger { log(m: string): void; }
class FileLogger implements Logger {   // 写 implements，但匹配只看结构
  log(m: string): void { }
}
```
```rust
trait Logger { fn log(&self, m: &str); }
struct FileLogger;
impl Logger for FileLogger {           // 类型与 trait 在两处定义，无需声明归属
  fn log(&self, m: &str) { }
}
```
```go
type Logger interface { Log(m string) }
type FileLogger struct{}
func (f FileLogger) Log(m string) {}  // 方法集满足即实现，无需声明
```
```python
from abc import ABC, abstractmethod
class Logger(ABC):                     # 基类 + 抽象方法，子类必须实现
  @abstractmethod
  def log(self, m: str) -> None: ...
class FileLogger(Logger):
  def log(self, m: str) -> None: ...
```
</LangTabs>

结论：只有 Java 和 Python 用“继承/基类”强制契约；TS、Rust、Go 的“实现”都是结构匹配，写不写 implements 都不影响兼容性。

如果你需要"像 Java 一样两个结构相同也不许混用"（比如 `UserId` 和 `OrderId` 都是 `string` 但不能互相传），用**品牌类型（branded type）** 模拟名义类型：

```ts
// 品牌类型：在 string 上挂一个"只有编译器知道的标签"
type UserId = string & { readonly __brand: 'UserId' };
type OrderId = string & { readonly __brand: 'OrderId' };

const toUserId = (raw: string): UserId => raw as UserId;   // 唯一入口
const toOrderId = (raw: string): OrderId => raw as OrderId;

function loadUser(id: UserId) { /* ... */ }
const uid = toUserId('u1');
const oid = toOrderId('o1');
loadUser(uid);          // ✅
// loadUser(oid);       // ❌ 编译错误：OrderId 不能当作 UserId
```

**坑在哪**：

- 结构化类型下，**函数参数默认是双向兼容的**（`strictFunctionTypes` 只对"方法写法"做逆变检查，对"属性写法"宽松）。这是和 Java 差异最大的地方，写库时尤其要小心。
- 品牌类型是"编译期幻影"——运行时 `UserId` 就是普通 `string`，`toUserId` 没有做任何校验。它只防"在同一份代码里用错"，不防"外部传进来的脏数据"。外部输入仍要靠运行时校验（见 3.11）。
- 别为了"像 Java"而到处 `implements`：`interface` 在 TS 里主要是数据结构契约，不是"必须被实现"的接口。

### 3.3 unknown vs any

**是什么**：`any` 是"关闭类型检查"的逃生舱——对 `any` 的值做任何操作都不报错，但它也**把类型系统的所有保护全扔了**。`unknown` 是"类型安全的顶层类型"——任何值都能赋给它，但在**没证明它是什么之前，你不能对它做任何操作**。

**为什么需要**：阶段 3 的纪律是"全项目 `any` = 0"。所有"我还不知道它是什么"的地方，第一反应应该是 `unknown` 而不是 `any`。`unknown` 逼你先做收窄（见 3.5）再用，这正是类型系统价值的来源。

```ts
// any：编译器完全放弃检查，bug 溜进运行时
let a: any = JSON.parse('{"x": 1}');
a.foo.bar.baz();          // ✅ 编译通过，运行时直接 TypeError

// unknown：必须先"证明"才能用
let u: unknown = JSON.parse('{"x": 1}');
// u.x;                   // ❌ 编译错误：Object is of type 'unknown'
if (typeof u === 'object' && u !== null && 'x' in u) {
  const x = (u as { x: number }).x;   // 收窄 + 断言后才可用
}
```

“可能没有值”怎么表达？Java 用 Optional 包装，TS 用 `| undefined` 配合 `?.`/`??`，Rust 用 `Option<T>`，Go 用指针 nil（无强制），Python 用 `Optional[T]` 标注。

<LangTabs title="空安全与可选值：五种语言对照">
```java
Optional<String> name = Optional.ofNullable(get());  // 必须显式包装
name.ifPresent(n -> System.out.println(n));          // 不拆就访问会编译报错
```
```ts
const name: string | undefined = get();  // undefined 是类型系统一等公民
const len = name?.length ?? 0;           // ?. 短路、?? 给默认值
```
```rust
let name: Option<String> = get();        // Option 是枚举，None 必须处理
if let Some(n) = name { println!("{}", n); }
```
```go
var name *string = get()                 // 指针可能为 nil，编译器不强制判空
if name != nil { fmt.Println(*name) }    // 不判断直接解引用会 panic
```
```python
from typing import Optional
name: Optional[str] = get()               # 只是标注，运行期仍可能是 None
if name is not None: print(len(name))
```
</LangTabs>

结论：只有 TS 和 Rust 把“可能为空”写进类型、由编译器逼你处理；Java 靠 Optional 包装但易漏；Go 的 nil 完全靠自觉，Python 的 Optional 运行期不强制。

**坑在哪**：`any` 会**传染**——一个 `any` 经过函数返回、赋值，会把下游所有值也变成 `any`，整条链的类型保护瞬间蒸发。遇到第三方无类型值，优先 `unknown` + 类型守卫，实在不行再局部 `as`，并加注释说明"为什么这里比编译器知道得多"。

### 3.4 联合、交叉、字面量与判别联合

**是什么**：**联合类型（union）** 用 `|` 表示"值是这些类型之一"；**交叉类型（intersection）** 用 `&` 表示"值同时具备所有这些类型的特征"；**字面量类型（literal type）** 把值本身当类型（`'red'`、`42`、`true`）；**判别联合（discriminated union）** 是"带共同判别式字段的联合"，是 TS 里最实用、最安全的模式之一。

**为什么需要**：JavaScript 里一个值经常"可能是 A 也可能是 B"（比如 API 返回成功或失败）。联合类型让编译器知道这点，配合收窄（3.5）就能安全地分别处理。判别联合则把"先判断类型再访问字段"变成了编译器能验证的穷尽检查。

```ts
// 字面量 + 联合：status 只能是这三个字符串之一
type Status = 'idle' | 'loading' | 'done';

// 交叉：既是用户又是管理员（字段合并）
type User = { id: string; name: string };
type Admin = User & { level: number };

// 判别联合：每个成员共享判别式字段 kind
type Result =
  | { kind: 'ok'; data: User }
  | { kind: 'err'; error: Error };

function handle(r: Result): User {
  switch (r.kind) {                 // 判别式
    case 'ok':  return r.data;       // 这里 r 被收窄成 { kind: 'ok'; data: User }
    case 'err': throw r.error;
    default:
      // 穷尽性检查：如果哪天给 Result 加了 'pending' 却忘了处理，这里立刻报错
      const _exhaustive: never = r;
      return _exhaustive;
  }
}
```

“一个值可能是几种情况之一”在五种语言里表达力天差地别：Java 用 sealed interface + record 做穷尽匹配，TS 用字符串字面量联合，Rust 用 enum（带数据的代数类型），Go 与 Python 的等价物最弱。

<LangTabs title="联合类型与可辨识联合：四种语言对照">
```java
sealed interface Shape permits Circle, Rect { }   // 封闭层次，编译器可穷尽
record Circle(double r) implements Shape { }
record Rect(double w, double h) implements Shape { }
```
```ts
type Shape =
  | { kind: 'circle'; r: number }    // 判别联合：kind 是判别式
  | { kind: 'rect'; w: number; h: number };
```
```rust
enum Shape {                          // Rust enum 每个变体可携带数据
  Circle(f64),
  Rect { w: f64, h: f64 },
}
```
```python
from typing import Literal, Union
Shape = Union[                        # 联合 + 字面量，但运行期无判别
  {"kind": Literal["circle"], "r": float},
  {"kind": Literal["rect"], "w": float, "h": float},
]
```
</LangTabs>

<Callout kind="info" title="Go 没有联合类型">Go 没有联合类型，也没有枚举变体。表达“多形态”只能用 `interface{}` 加类型断言，或手写带 Kind 字段的结构体——编译器无法帮你做穷尽检查。</Callout>

结论：只有 TS 和 Rust 的联合/枚举能让编译器在 switch/match 里验证“所有情况都覆盖了”；Java 靠 sealed 勉强够用，Go 完全不行。

“一组命名的常量”五种语言都有，但 TS 的 enum 会生成运行时代码且是名义的，所以社区更推荐字面量联合；Rust/Go/Python 的枚举语义各不相同。

<LangTabs title="枚举常量：五种语言对照">
```java
enum Status { IDLE, LOADING, DONE }      // 名义类型，每个常量是一个实例
Status s = Status.LOADING;
```
```ts
const Status = {                         // 推荐：as const 对象 + 联合，零运行时代码
  Idle: 'idle', Loading: 'loading', Done: 'done',
} as const;
type Status = typeof Status[keyof typeof Status];
```
```rust
enum Status { Idle, Loading, Done }      // 默认从 0 起的整数，可指定值
```
```go
type Status int
const (                                 // iota 生成自增常量
  Idle Status = iota
  Loading
  Done
)
```
```python
from enum import Enum
class Status(Enum):                      # 每个成员是唯一对象
  IDLE = "idle"
  LOADING = "loading"
  DONE = "done"
```
</LangTabs>

结论：TS 的 enum 是“异类”——生成 JS 运行时代码且是名义类型，与结构化思维冲突，故文档高频坑里建议用 as const + 联合替代。

“出错时怎么表达”是五种语言分歧最大的地方：Java 用受检异常，TS 用 Result 判别联合，Rust 用 Result<T,E> 枚举，Go 用 (值, error) 多返回值，Python 用异常。

<LangTabs title="错误与结果类型：五种语言对照">
```java
String read() throws IOException {       // 受检异常：签名里声明可能抛什么
  return Files.readString(path);
}
```
```ts
type Result<T> =
  | { ok: true; value: T }               // 判别联合，错误也是值
  | { ok: false; error: Error };
```
```rust
fn read() -> Result<String, io::Error> { // Result 是枚举，错误必须被匹配
  fs::read_to_string(path)
}
```
```go
func read() (string, error) {            // 约定：最后一个返回值是 error
  return "", fmt.Errorf("boom")
}
```
```python
def read() -> str:                       # 异常机制，错误靠 try/except 捕获
  return open(path).read()
```
</LangTabs>

结论：只有 Java 和 Python 用“抛异常”打断控制流；TS/Rust/Go 把错误变成“必须处理的返回值”——Rust 和 TS 还能在编译期逼你处理。

**坑在哪**：

- 交叉类型遇到**同名但类型冲突**的字段会直接变成 `never`（比如 `{ a: string } & { a: number }` 的 `a` 是 `never`）。这不是 bug，是"不可能同时满足"的正确表达。
- 联合类型的"多余属性检查"比单一类型更严格——对象字面量必须能被**某个**成员完全接受。需要宽松时，先赋给变量再传（见 3.2）。
- 判别联合的"判别式"必须是**字面量类型且每个成员取值不同**，否则收窄不生效。别用 `boolean` 当判别式（只有两个值还好，但语义弱）。

### 3.5 类型收窄与类型守卫

**是什么**：**类型收窄（narrowing）** 是指 TS 在代码某个分支里，根据你写的判断，把"宽的联合类型"缩小成"具体成员"。**类型守卫（type guard）** 是让收窄扩展到自定义判断的函数——用 `参数 is 类型` 的返回标注告诉编译器"返回 true 时这个值就是这个类型"。

**为什么需要**：光有联合类型还不够，你得"在每个分支里安全地拿到具体字段"，否则联合类型只是把问题推迟了。六种收窄手段是写 TS 的日常核心动作。

```ts
// 1. typeof       2. instanceof      3. in
function describe(value: string | Date | { id: number }) {
  if (typeof value === 'string') return value.toUpperCase();   // 收窄成 string
  if (value instanceof Date) return value.getFullYear();        // 收窄成 Date
  if ('id' in value) return value.id;                           // 收窄成 { id: number }
}

// 4. 字面量 ===      5. 类型谓词（自定义守卫）
interface Dog { kind: 'dog'; bark(): void; }
interface Cat { kind: 'cat'; meow(): void; }
type Pet = Dog | Cat;

function isDog(pet: Pet): pet is Dog {     // 类型谓词：返回 true 时 pet 是 Dog
  return pet.kind === 'dog';
}
function talk(pet: Pet) {
  if (isDog(pet)) pet.bark();              // 收窄成 Dog
  else pet.meow();                         // 收窄成 Cat
}
```

**坑在哪**：

“确认一个值的真实类型再访问字段”是日常操作。Java 用 instanceof + 强转，TS 用 typeof/in 收窄，Rust 用 match 穷尽，Python 用 isinstance。

<LangTabs title="类型收窄与模式匹配：五种语言对照">
```java
if (value instanceof String s) {     // Java 16+ 模式匹配，转型自动
  int n = s.length();
}
```
```ts
if (typeof value === 'string') {     // typeof 直接把 value 收窄成 string
  const n = value.length;
}
```
```rust
match value {                         // match 强制穷尽，漏掉分支编译失败
  Shape::Circle(r) => r,
  Shape::Rect { w, h } => w * h,
}
```
```go
if s, ok := value.(string); ok {      // 类型断言带 ok，失败不 panic
  n := len(s)
}
```
```python
if isinstance(value, str):            # 运行期检查，无编译期收窄
  n = len(value)
```
</LangTabs>

结论：Java/TS/Python 的收窄是“运行期判断 + 工具辅助”，Rust 的 match 是唯一在编译期强制穷尽的——这也是结构化类型下最安全的分支方式。

- 类型谓词 `pet is Dog` 是"你向编译器做的承诺"——**编译器不会验证你判断得对不对**。如果 `isDog` 里写错成 `pet.kind === 'cat'` 却标注 `is Dog`，运行时就会调用不存在的方法。收窄逻辑要写对。
- `typeof` 对 `null` 会返回 `'object'`（历史 bug），判断"是不是对象"要用 `value !== null && typeof value === 'object'`，别裸写 `typeof value === 'object'`。

### 3.6 泛型与约束

**是什么**：**泛型（generics）** 是"参数化的类型"——让函数 / 接口 / 类能"用一个占位类型 `T` 适配多种具体类型"，同时保留类型关系。**约束（constraint）** 用 `extends` 限制 `T` 必须满足的形状，否则你无法访问 `T` 上的属性。

**为什么需要**：没有泛型，写一个"返回数组第一个元素"的函数要么用 `any`（丢失类型），要么为每种类型写一遍。泛型让"容器 / 工具函数"既通用又类型安全。配合 `keyof` / `infer`，还能做强大的类型推导。

```ts
// 基础泛型：返回数组第一个元素，返回类型跟随输入数组的元素类型
function first<T>(arr: T[]): T | undefined {
  return arr[0];
}
const n = first([1, 2, 3]);        // n: number | undefined
const s = first(['a', 'b']);       // s: string | undefined

// 约束：T 必须有 length 属性，否则无法访问 .length
function longest<T extends { length: number }>(a: T, b: T): T {
  return a.length >= b.length ? a : b;
}
longest([1, 2], [1, 2, 3]);        // ✅ 数组有 length
// longest(1, 2);                   // ❌ number 没有 length

// keyof + 索引访问：安全地按 key 取值，返回类型自动是对应字段的类型
function getProp<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
const user = { id: '1', age: 20 };
const id: string = getProp(user, 'id');   // 返回类型推断为 string
// getProp(user, 'name');                  // ❌ 'name' 不是 user 的 key

// 推导 + 映射的综合示例：类型安全的事件总线（泛型 + 索引访问 + 条件类型）
interface EventMap {
  'todo:created': { id: string; title: string };
  'todo:deleted': { id: string };
  'sync:done':    { at: number };
}
function createEventBus<T extends Record<string, unknown>>() {
  const handlers: { [K in keyof T]?: Array<(payload: T[K]) => void> } = {};
  return {
    on<K extends keyof T>(type: K, fn: (payload: T[K]) => void) {
      (handlers[type] ??= []).push(fn);
    },
    emit<K extends keyof T>(type: K, payload: T[K]) {
      handlers[type]?.forEach((fn) => fn(payload));
    },
  };
}
const bus = createEventBus<EventMap>();
bus.on('todo:created', (p) => p.title);          // p 自动推导为 { id; title }
bus.emit('todo:created', { id: '1', title: 'x' });
// bus.emit('todo:deleted', { id: '1', title: 'x' });  // ❌ 多余 title，类型报错
```

**坑在哪**：

泛型让同一个函数适配多种类型。五种语言都支持，但约束写法不同：Java/TS 用 extends，Rust 用 trait bound（:），Go 用方括号 [T any]，Python 用 TypeVar 的 bound。

<LangTabs title="泛型函数：五种语言对照">
```java
<T extends Comparable<T>> T max(T a, T b) {   // 约束写在 extends 后
  return a.compareTo(b) >= 0 ? a : b;
}
```
```ts
function max<T extends { compareTo(b: T): number }>(a: T, b: T): T {
  return a.compareTo(b) >= 0 ? a : b;          // 约束同样用 extends
}
```
```rust
fn max<T: Ord>(a: T, b: T) -> T {              // 约束写成 trait bound T: Ord
  if a >= b { a } else { b }
}
```
```go
func max[T any](a, b T, less func(T, T) bool) T { // Go 无内建排序约束，需传比较函数
  if !less(a, b) { return a }
  return b
}
```
```python
from typing import TypeVar
T = TypeVar("T", bound="Comparable")           # 约束用 bound=，运行期无泛型
def max(a: T, b: T) -> T: ...
```
</LangTabs>

结论：约束（bound）的本质都一样——限制 T 能做什么。但 Java/TS 的约束是“结构化 + 名义混合”，Rust 的 trait bound 更纯粹，Python 的 TypeVar 运行期完全不存在。

- 泛型参数**未约束就访问属性**会报错（`T` 上不知道有没有该属性）——加 `extends` 解决。
- 数组在 TS 里是**协变**的（宽松），`readonly T[]` 才能约束"只出不进"。需要防止把 `string[]` 当 `readonly string[]` 误用时，改用 `readonly`。
- `K extends keyof T` 是泛型里最高频的约束模式，务必练熟。

### 3.7 interface vs type

**是什么**：`interface` 和 `type`（类型别名）在描述对象形状时大部分可互换，但有几处关键差异：`interface` 支持**声明合并**，`type` 能表达联合 / 交叉 / 条件类型等更复杂的类型表达式。

**为什么需要**：初学者常纠结"到底用哪个"。经验法则：**描述对象 / 类的契约用 `interface`（可扩展、有语义），需要联合 / 交叉 / 工具类型时用 `type`**。两者混用没问题，关键是团队约定一致。

```ts
// interface：可声明合并（同名的会自动合并字段）
interface Config { timeout: number; }
interface Config { retry: number; }     // 合并后 Config 有 timeout + retry

// type：能表达 interface 做不到的形状
type Id = string | number;              // 联合
type Pair<T> = { first: T; second: T };// 泛型别名
type Handler = (e: Event) => void;     // 函数类型

// 对象形状两者都能写，等价
interface UserI { id: string; }
type UserT = { id: string };
```

“给一个复杂类型起个短名字”各语言都支持，但语义不同：Java 用 record（也是数据载体）或没对应，TS/Rust/Go/Python 都有纯类型别名。

<LangTabs title="类型别名：五种语言对照">
```java
record Point(double x, double y) { }     // record 兼作不可变数据 + 名义类型
// Java 没有“纯类型别名”，无法给现有类型起匿名同义名
```
```ts
type Point = { x: number; y: number };  // 纯别名，与原类型完全等价
type Id = string | number;
```
```rust
type Point = (f64, f64);                 // 纯别名，编译期与元组等价
```
```go
type Point = struct{ X, Y float64 }      // 别名与原类型可互换（底层相同）
```
```python
from typing import TypeAlias
Point: TypeAlias = tuple[float, float]   # 仅标注，运行期无别名概念
```
</LangTabs>

结论：Java 的 record 是“名义 + 数据”二合一，其它四种的别名都是纯结构等价、运行期不可见——再次体现名义与结构之分。

“声明后不再变”分两层：绑定不可重新赋值、以及内容不可改。Java 用 final，TS 用 readonly/as const，Rust 默认不可变，Go 用 const（仅基础类型），Python 用 Final/元组。

<LangTabs title="不可变与只读：五种语言对照">
```java
final List<String> ids = List.of("a");   // final 绑不可改，List.of 内容不可变
ids.add("b");                            // 编译期就禁止
```
```ts
const ids = ['a'] as const;              // as const 让每个元素变成字面量且只读
// ids.push('b');                        // 编译错误：只读元组不能增删
```
```rust
let ids = vec!["a"];                     // 默认不可变绑定
// ids.push("b");                        // 编译错误，需 let mut ids
```
```go
const n = 10                             // Go const 只用于基础类型，不能修饰切片
// const ids = []string{"a"}            // 编译错误：const 不支持复合类型
```
```python
from typing import Final
IDS: Final = ("a",)                      // Final 只是标注，元组本身不可变
```
</LangTabs>

结论：Rust 把“不可变”设为默认、可变要显式申请（mut）；TS 用 as const 把字面量冻结；Java 的 final 只锁绑定、集合内容还要单独保证。

“哪些字段外部能碰”的可见性规则：Java 用 private + getter，TS 用 private/# 私有字段，Rust 用 pub 与模块可见性，Go 用标识符首字母大小写，Python 用 _ 约定（不强制）。

<LangTabs title="读写属性的访问控制：五种语言对照">
```java
private String name;                     // private 编译期强制外部不可见
public String getName() { return name; } // 读靠 getter，写可单独控制
```
```ts
class User {
  #name = '';                            // # 私有字段，编译期外不可访问
  get name() { return this.#name; }      // getter 暴露只读视图
}
```
```rust
pub struct User {                        // pub 字段外部可读写
  name: String,                          // 无 pub 则模块内可见，外部不可见
}
```
```go
type User struct {
  Name string                            // 首字母大写 = 导出（包外可见）
  secret string                          // 小写 = 仅包内可见
}
```
```python
class User:
  def __init__(self):
    self._name = ""                      # 单下划线只是约定，运行期仍能访问
```
</LangTabs>

结论：Java/TS/Rust/Go 的可见性都有编译期或导出规则兜底，唯独 Python 的 _ 是“君子约定”——运行期谁都能绕过。

**坑在哪**：

- 用 `interface` 当 Java 接口、到处 `implements` 是典型误用——TS 的 `interface` 不要求被"实现"，它只是形状契约（见 3.2）。
- `type` 不能声明合并，且同名 `type` 重复声明会报错。需要"插件式扩展"的场景（如第三方给配置加字段）用 `interface` 更合适。

### 3.8 工具类型（要能手写实现）

**是什么**：**工具类型（utility types）** 是 TS 内置的"类型层面的函数"，用来基于已有类型派生出新类型。最常用的一批：`Partial` / `Required` / `Pick` / `Omit` / `Record` / `ReturnType` / `Awaited`。

**为什么需要**：你不会想手动为每个"原类型的可选版 / 去掉某字段版"重新声明一遍接口。工具类型让类型随数据变化自动派生，改一处全链更新。理解它们的**实现原理**，你才能写出自己的高级类型。

```ts
// 手写实现：Partial —— 把所有字段变可选（映射类型 + ? 修饰符）
type MyPartial<T> = { [K in keyof T]?: T[K]; };

// 手写实现：Pick —— 只保留指定字段
type MyPick<T, K extends keyof T> = { [P in K]: T[P]; };

// 手写实现：Omit —— 去掉指定字段（Pick + Exclude）
type MyOmit<T, K extends keyof T> = MyPick<T, Exclude<keyof T, K>>;

// 手写实现：Record —— 构造"键集合 → 值类型"的对象类型
type MyRecord<K extends string, V> = { [P in K]: V; };

// 手写实现：ReturnType —— 提取函数返回值类型（条件类型 + infer）
type MyReturnType<F> = F extends (...args: never[]) => infer R ? R : never;

// 手写实现：Awaited —— 解开 Promise 的层层包裹（递归 + infer）
type MyAwaited<T> =
  T extends Promise<infer U> ? MyAwaited<U> : T;

// 用法示例
interface Todo { id: string; text: string; done: boolean; }
type TodoDraft = MyPartial<Todo>;                 // 所有字段可选，用于"编辑草稿"
type TodoPreview = MyPick<Todo, 'id' | 'text'>;   // 只取 id + text
type TodoWithoutDone = MyOmit<Todo, 'done'>;       // 去掉 done
const map: MyRecord<'get' | 'post', () => void> = {
  get: () => {}, post: () => {},
};
```

**坑在哪**：

- `Omit` 作用在"接口 / 对象类型"上没问题，但作用在**联合类型**上会先把它分发再 Omit，结果可能不符合直觉。对联合做字段移除要用更精细的分布式映射。
- `Partial` 是"浅"的——嵌套对象的子字段不会变可选。需要深层可选时写 `DeepPartial`（递归映射类型）。
- 手写工具类型是"类型体操"的基础，但生产代码优先用内置的，别为了炫技重写。

### 3.9 satisfies 运算符

**是什么**：`satisfies` 是 TS 4.9 引入的运算符——它**检查**一个值是否符合某类型，但**不收窄 / 不改变**该值的推断类型。与 `as`（强制断言，可能掩盖错误）和直接的类型标注（会丢失字面量细节）都不同。

**为什么需要**：一个经典场景——你有一个配置对象，既希望"键只能是某集合、值符合约束"（要检查），又希望"保留每个键的具体字面量类型"以便后续做精确提示（不要收窄成宽泛类型）。`satisfies` 完美兼顾。

```ts
// 直接标注：值的类型被"抬宽"成 Record，丢掉了每个键的字面量信息
const configAnnotated: Record<string, number> = { width: 100, height: 200 };
// configAnnotated.width;   // 类型只是 number，但 'width' 这个键名细节没了，且能访问任意字符串键

// as 断言：绕过检查，写错也不会报错（掩盖 bug）
const configAs = { width: 100 } as Record<string, number>;

// satisfies：既检查约束，又保留推断（下面 r 的类型仍精确知道有 width / height 且是 number）
const config = {
  width: 100,
  height: 200,
} satisfies Record<string, number>;
config.width;     // ✅ 保留具体键名与 number 类型
// config.depth;  // ❌ 编译错误：depth 不在对象里（如果是 as 就不会报错）

// 另一个高频用法：约束字面量集合，同时保留具体取值
type Route = '/' | '/about' | '/works';
const routes = {
  home: '/',
  about: '/about',
  works: '/works',
} satisfies Record<string, Route>;
// 若把 about 写成 '/wrong'，satisfies 立刻报错，但 routes.about 仍是字面量 '/about'
```

**坑在哪**：`satisfies` 只做检查、不收窄对象本身的类型——如果你需要"把值当成更窄的类型去用"，还得配合变量标注或收窄。`satisfies` 和 `as` 的区别一句话：**`satisfies` 让编译器验证你对，`as` 让你告诉编译器"我对，别管"**。

### 3.10 strict 相关选项与 tsconfig

**是什么**：`tsconfig.json` 是 TypeScript 项目的"总开关"。`strict` 是一个"全家桶开关"，一次性开启 `noImplicitAny`、`strictNullChecks`、`strictFunctionTypes`、`strictBindCallApply`、`strictPropertyInitialization`、`alwaysStrict`、`useUnknownInCatchVariables` 等一系列严格检查。

**为什么需要**：TS 7 **默认开启 `strict`**，但理解每个选项能帮你读懂"为什么编译器突然报这么多错"，以及在老项目渐进迁移时如何分步打开。下面是阶段 3 推荐的生产配置（注意：TS 7 已移除 `es5` 与 `node10`，老配置会直接报错）：

```jsonc
{
  "compilerOptions": {
    "target": "esnext",              // TS7 已移除 es5 支持，最低也要 es2015+
    "module": "preserve",            // 或 nodenext / esnext；TS7 移除了 AMD / UMD / SystemJS
    "moduleResolution": "bundler",   // node10 已被 TS7 移除，现代项目用 bundler
    "strict": true,                  // TS7 起默认开启，建议保持
    "noUncheckedIndexedAccess": true, // 开启后 arr[0] 类型为 T | undefined，堵住越界崩溃
    "exactOptionalPropertyTypes": true, // 可选属性不能显式赋 undefined，更精确
    "verbatimModuleSyntax": true,    // 类型导入必须写 import type，避免被打包进运行时
    "isolatedModules": true,         // 配合 Vite 的按文件转译
    "noEmit": true,                  // 类型检查交给 tsc，转译 / 打包交给 Vite
    "skipLibCheck": true,            // 跳过 .d.ts 内部检查，提速
    "paths": { "@/*": ["./src/*"] }  // 路径别名，需 Vite 同步配置
  }
}
```

`strict` 家族里最值得单独拎出来讲的是 `noUncheckedIndexedAccess`：开启后，数组 / 对象的索引访问结果会自动加上 `| undefined`。

```ts
const arr = [1, 2, 3];
const first = arr[0];          // 开启前：number；开启后：number | undefined
// first.toFixed(2);            // 开启后：编译错误，必须先判断非 undefined
if (first !== undefined) first.toFixed(2);

function loadUser(id: UserId) { /* ... */ }
```

**坑在哪**：

- `verbatimModuleSyntax: true` 下，**类型必须加 `import type`**，否则打包时会多出不必要的运行时 `import`。养成"导入类型就写 `import type`"的肌肉记忆。
- 老项目直接上 TS 7 的 strict 会"一屏红"。官方建议：先在 TS 6.x 清掉警告，再升 7；或先用 `// @ts-nocheck` 局部止血（但别长期依赖）。
- `exactOptionalPropertyTypes` 很严格：声明 `x?: number` 后，你不能写 `obj.x = undefined`，只能"不写这个键"。需要显式 undefined 时用 `x: number | undefined`。

### 3.11 声明文件与模块解析

**是什么**：**声明文件（`.d.ts`）** 是"只为类型、不产生运行代码"的文件，用来给无类型的 JS / 第三方库补上类型。**模块解析（module resolution）** 是 TS 决定 `import './foo'` 找到哪个文件 / 哪份声明的规则。

**为什么需要**：你迟早会遇到"一个 npm 包没有类型"的情况。不会写 `.d.ts`，你就只能 `any` 糊弄，类型系统价值归零。运行时边界（外部输入）也必须在这里建起"类型守卫 + 运行时校验"的闸门——**TS 类型在编译后就消失了，所有 `fetch` / `localStorage` / `JSON.parse` 进来的数据都是 `unknown`**。

```ts
// 1. 给无类型 JS 库补声明（declare module）
declare module 'legacy-lib' {
  export function doThing(input: string): number;
  export const version: string;
}

// 2. 全局类型：declare global（在 .d.ts 里）
declare global {
  interface Window {
    __APP_VERSION__: string;
  }
}

// 3. 运行时边界：外部输入先当 unknown，再用类型守卫收窄
function parseState(raw: string): unknown {
  return JSON.parse(raw);            // 返回 unknown，绝不声称它是 AppState
}
function isAppState(value: unknown): value is AppState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'todos' in value &&
    Array.isArray((value as AppState).todos)
  );
}
const raw = localStorage.getItem('todos');
if (raw !== null) {
  const parsed = parseState(raw);
  if (isAppState(parsed)) {
    // 到这里 parsed 才是类型安全的 AppState
  }
}
```

**坑在哪**：

- `.d.ts` 里写 `declare` 是"告诉编译器有这东西"，**不会生成任何运行时代码**——别忘了你仍需正常安装 / 导入那个 JS 库。
- 外部输入永远是 `unknown`，别在 `JSON.parse` 后直接 `as AppState` 就当真——`as` 不做运行时校验，脏数据照样溜进来。先用类型守卫 / 运行时校验库（阶段 7 会用 zod）确认，再收窄。
- `moduleResolution: 'bundler'` 允许省略扩展名、`package.json` 的 `exports` 字段，但要求打包器配合；若用 Node 直接跑，需用 `nodenext`。

### 3.12 从 JS 项目渐进迁移的步骤

**是什么**：渐进迁移是指从"一个 `any` 满天飞的 JS 项目"逐步变成"零 `any` 的 TS 项目"，而不是推倒重写。核心是利用 `allowJs` + `checkJs` 让 JS 和 TS 共存，逐文件提升类型覆盖率。

**为什么需要**：真实世界里你很少有机会从零写 TS。老 JS 项目动辄几千行，一次性全改风险高、收益慢。渐进迁移让类型保护"每天多覆盖一点"，且每步都可运行、可回退。

```jsonc
// 第一步：开启 allowJs + 关闭严格，让现有 JS 先被 tsc 看见但不强制
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false,        // 先不检查 JS，只检查新写的 TS
    "strict": true           // 新写的 .ts 文件仍走严格
  }
}
```

迁移节奏（按文件推进）：

```ts
// 第二步：给单个 JS 文件加 // @ts-check，让 TS 对它的部分做检查
// math.js 顶部加：// @ts-check
// 第三步：把 .js 重命名为 .ts，补参数 / 返回值类型，消除该文件的所有 any
// 第四步：对外部输入建立类型守卫（见 3.11），把 unknown 收窄成领域类型
// 第五步：打开 noUncheckedIndexedAccess、checkJs，逐步清零剩余 any
```

**坑在哪**：

- `@ts-ignore` / `@ts-nocheck` 是"止血带"不是"创可贴"——用完要记得回头清掉，否则类型漏洞会一直漏。用 `@ts-expect-error` 更好：如果下面其实没错误，它会反过来提醒你"这条压制多余了"。
- 迁移到 TS 7 时，老 `tsconfig` 里的 `target: es5`、`moduleResolution: node10` 必须删掉，否则直接配置报错。
- 类型检查（`tsc --noEmit`）和打包（Vite / Rolldown）是**两条流水线**——别指望打包器替你查类型，阶段 4 会正式把它接进构建脚本。

---

## 四、与 Java 经验的对照

| Java 世界的经验 | 前端的对应关系（TS 7） | 注意差异 |
| --- | --- | --- |
| 名义类型（类名决定兼容） | **结构化类型**（结构决定兼容） | TS 里两个独立定义的相同结构可互相赋值；不需要 `implements` |
| `interface` + `implements` | `interface` / `type` | TS 的 `interface` 可描述函数 / 数组 / 元组，且支持**声明合并**；更多是数据结构契约而非"必须被实现" |
| 泛型擦除（运行时无 `T`） | 泛型完全擦除，仅编译期 | 运行期拿不到 `T`，需要品牌类型或运行时校验 |
| `List<T>` 不变 | 数组**协变**（宽松） | 用 `readonly T[]` 约束"只出不进" |
| `Optional<T>` | `T \| undefined` | 配合 `strictNullChecks` 与可选链 `?.` |
| 异常受检（checked exception） | 无受检异常 | 用 **`Result` 类型模式**（见 3.4 的判别联合）替代 `throws` |
| 注解处理器 / 反射 | 类型仅在编译期；`emitDecoratorMetadata` 需显式开启 | Vite 8 已内置支持该选项；运行时反射能力远弱于 JVM |
| Maven / Gradle 构建 | `tsc` 只做类型检查，产物由 Vite / Rolldown 产出 | **类型检查与打包分离**，这是和 Java 编译打包一体最大的工程差异 |
| 编译期类型检查（javac） | `tsc --noEmit`（TS 7 默认并行 `--checkers 4`） | 没有稳定编程式 API，typescript-eslint 类工具暂不可用，用 `@typescript/typescript6` 并存过渡 |

---

## 五、实践练习

> 每个练习含**目标 / 步骤 / 验收点**。`tsc --noEmit` 是阶段 3 的唯一验收命令，所有练习要求零错误、零 `any`。

### 练习 1（必做）：类型体操（6 小时）

**目标**：把类型层面的"肌肉"练出来，建立对映射类型 / 条件类型 / `infer` 的直觉。

**步骤**：在 type-challenges 风格下完成至少 20 题（easy 10 + medium 8 + hard 2），每题配 `expectType` 测试。

**必做清单**：`Pick` `Omit` `Readonly` `DeepReadonly` `TupleToUnion` `Last` `Exclude` `Awaited` `Parameters` `ReturnType` `Trim` `UnionToTuple` `GetRequired` `Chainable`（链式 `option` API 类型）、`PromiseAll` 的返回类型推断。

**验收点**：能手写 `Pick` / `Omit` / `ReturnType` / `Awaited` 的实现（见 3.8）；`tsc --noEmit` 对练习目录零错误。

### 练习 2（必做）：TS 化 Todo 应用（8 小时）

**目标**：把阶段 2 的 Todo 应用完整迁移到 TS 7，验证"零 `any` 也能表达全部逻辑"。

**步骤**：

1. 定义 `Todo`、`FilterState`、`AppState`、`Action`（可辨识联合）完整模型。
2. 状态更新用 `reducer(state, action): AppState` 纯函数签名（为阶段 6 的 `useReducer` 预热）。
3. `localStorage` 读取处写 `parseState(raw: string): unknown` + 类型守卫 `isAppState`（见 3.11）。
4. 打开 `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`。

**验收点**：`tsc --noEmit` 零错误，全项目 `any` 数量为 0（用 ESLint 规则或 `grep -c 'any'` 强制）。

### 练习 3（必做）：给无类型库写 `.d.ts`（3 小时）

**目标**：掌握声明文件的写法，不再因"没类型"而退回 `any`。

**步骤**：挑一个没有类型的 npm 包（或自己写个 JS 库），为它写完整声明文件，包含：函数重载、泛型、回调类型、命名空间、JSDoc。

**验收点**：声明文件能被 `tsc` 正确消费，调用方获得完整补全与类型检查；发布到 DefinitelyTyped 的流程可作了解。

### 练习 4（进阶）：类型安全的事件总线（4 小时）

**目标**：把 3.6 的 `createEventBus<EventMap>` 做完整，体会"泛型 + 映射类型"如何实现 key 与 payload 联动。

**步骤**：实现 `on` 的 key 与 payload 类型联动、`emit` 参数严格校验，使下面代码中的错误用法在编译期报红：

```ts
interface EventMap {
  'todo:created': { id: string; title: string };
  'todo:deleted': { id: string };
  'sync:done':    { at: number };
}
const bus = createEventBus<EventMap>();
bus.on('todo:created', (p) => p.title);  // p 自动推导
bus.emit('todo:created', { id: '1', title: 'x' });
// bus.emit('todo:deleted', { id: '1', title: 'x' }); // ❌ 应报错（多余属性）
```

**验收点**：错误调用在 `tsc --noEmit` 下确实报红；`on` 回调参数随 key 精确推导。

### 练习 5（进阶）：运行时校验与类型联动（3 小时）

**目标**：建立"编译期类型 + 运行期校验"的双闸门，理解 TS 类型的边界。

**步骤**：用 zod（或 valibot）为一个真实 API 的响应写 schema，做到 **`z.infer` 推导静态类型 + `safeParse` 做运行时校验**，并把校验失败转成 3.4 的 `Result` 类型。这是阶段 7 请求层、阶段 10 IPC 通信的基础设施。

**验收点**：非法响应被 `safeParse` 拦下并转成 `Result.err`；合法响应自动拥有静态类型，零 `any`。

### 练习 6（挑战）：给自己的工具库做类型测试（3 小时）

**目标**：把类型变成"可测试的"，并量化 TS 7 原生编译器的收益。

**步骤**：用 `expect-type` 或 `tsd` 写类型层面的单元测试，并接入 CI；对比 TS 6 与 TS 7 在同一项目上的 `tsc --noEmit` 耗时，记录加速比（用 `@typescript/typescript6` 并存跑出 TS 6 的耗时）。

**验收点**：类型测试纳入 CI 且通过；记录到 8~12 倍的加速数据，体会 Go 原生编译器的收益。

---

## 六、常见坑与自查清单

### 高频坑

- 用 `as` 强行断言掩盖真实错误 → 优先用类型守卫，`as` 只用于"我知道得比编译器多"的窄场景。
- 把 `interface` 当 Java 接口用（`implements` 满天飞）→ TS 里更多是数据结构契约，结构性兼容不需要 `implements`。
- `enum` 生成运行时代码且是名义的 → 优先 `as const` 对象 + 联合类型。
- 以为 TS 能保证运行时安全 → 所有外部输入（`fetch` / `localStorage` / `JSON.parse`）仍是 `unknown`，仍需运行时校验。
- 忘记 `noUncheckedIndexedAccess` → `arr[0].name` 编译过但运行崩（索引结果其实是 `T | undefined`）。
- 类型导入未加 `type` 关键字 + `verbatimModuleSyntax` → 打包出多余 `import`，甚至运行时报错。
- 泛型参数未约束就访问属性 → 加 `extends`。
- 品牌类型是"编译期幻影"，运行时不做校验 → 外部脏数据仍要靠运行时校验兜住。
- TS 7 严格默认开启后老项目报一屏错 → 按官方建议先升到 6.x 清警告，再上 7；删掉 `target: es5` 与 `moduleResolution: node10`。

### 自查清单

- [ ] 能解释结构化类型，并举出"Java 会报错、TS 不报错"的例子。
- [ ] 不查资料手写 `Partial` `Omit` `ReturnType` `Awaited` 的实现。
- [ ] 能用可辨识联合 + `never` 做穷尽性检查。
- [ ] 用 `infer` 写过至少一个类型提取工具。
- [ ] Todo 项目零 `any`、`tsc --noEmit` 零错误。
- [ ] 独立为一个无类型库写过 `.d.ts`。
- [ ] 能解释 `satisfies` 与 `as` 的区别，并各给出一个使用场景。
- [ ] 知道 TypeScript 7 的三个最重要变化（Go 原生编译器、strict 默认开启、暂无稳定编程式 API）。

---

## 七、参考资料

- TypeScript 官方 Handbook + `CHANGES.md`（7.x 行为差异的一手来源，2026-09 验证）。
- TypeScript 7 发布公告（Microsoft TypeScript Blog，2026-07-08）：Go 原生编译器、strict 默认、移除 es5 / node10 的权威说明。
- type-challenges（类型体操题库）：覆盖从 easy 到 extreme 的全部类型技巧。
- 《Effective TypeScript》（Dan Vanderkam）：强烈建议通读，第 2 版覆盖 `satisfies`、TS 5+ 特性。
- 验证时间：2026-09；TS 7 特性（Go 编译器、`--checkers`、`@typescript/typescript6` 并存方案）以官方 7.0 发布说明为准，与 `track.json` 的 `toolchain` 一致。
