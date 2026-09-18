# 阶段 2：JavaScript 深度补强与"去 jQuery 化"

| 项目 | 内容 |
| --- | --- |
| **周期** | 3 周（约 30 小时） |
| **前置** | 完成阶段 1：能独立用语义化 HTML + Flex/Grid 搭出静态页面 |
| **本阶段技术栈** | 原生 JavaScript（ES2015~ES2023）+ 浏览器 DOM/BOM API，**零依赖、零构建工具** |
| **产出物** | ① 无依赖的 Todo 应用（增删改查 + 筛选 + 本地存储 + 撤销）② 一份「jQuery → 原生」对照迁移报告 |

---

## 一、本阶段在学习路径中的位置

- **上承**：阶段 1 你已经能搭出好看的静态页面，但内容是**写死在 HTML 里的**——改一行数据要手动改 DOM，页面是"死"的。
- **本阶段**：让页面"活"起来。核心是建立**状态驱动**的心智模型：**数据 → 渲染函数 → DOM**。你会系统补齐 JavaScript 语言内核（执行机制、闭包、异步）与现代语法，并把 jQuery 时代的命令式写法彻底换掉。
- **下接**：阶段 3 用 [TypeScript](./03-TypeScript从类型思维到工程实践.md) 给这份状态加上类型约束，让编译器替你兜住一半的 bug；阶段 6 的 React 则是把本阶段手写的心智模型**变成框架的内建机制**。

> 这是整条路线的分水岭。本阶段的状态驱动思维没建立起来，后面学 React 会一直在"哪里改 DOM"的旧习惯里打转。

---

## 二、学习目标（可验收）

学完本阶段，你应该能够：

1. 拿到一个小需求，先设计**状态结构**，再写 `render(state)`，而不是先想"我要操作哪个 DOM 节点"。
2. 画出事件循环示意图，并准确说出任意一段混合同步/微任务/宏任务代码的输出顺序。
3. 解释闭包的三个要素，并说出 `for (var i...)` 的经典陷阱为什么会发生、怎么修。
4. 说清 `this` 的四条绑定规则与箭头函数的例外，能在不看文档的情况下判断任意调用点的 `this`。
5. 熟练使用 ES2015+ 的日常语法：解构、展开/剩余、模板字符串、可选链、空值合并、模块、类与私有字段，并手写 `debounce` / `throttle` / `deepClone` / 并发池。
6. 用 `Promise` 与 `async/await` 处理异步，用 `AbortController` 做取消与超时，用 `Promise.all/allSettled/race/any` 做并发编排。
7. 用现代 DOM API 实现事件委托、防抖节流、跨标签页同步、懒加载，不借助任何库。
8. 把任意一段 jQuery 代码等价改写成现代原生代码，并说清**为什么这样更好**。

---

## 三、核心概念详解

### 3.1 状态驱动：从"改 DOM"到"改数据"

**是什么**：状态驱动（state-driven）是一种 UI 构建范式——把界面看成**状态的函数**：`UI = f(state)`。你只维护一份状态，界面由状态推导出来。

**为什么需要**：jQuery 时代的范式是"查询 DOM → 命令式修改 DOM"。页面简单时没问题，一旦有多个交互入口改同一份数据（新增、删除、撤销、跨标签页同步），你就得记得在每个入口手动同步所有相关节点——漏一处就是 bug。状态驱动把"N 个入口 × M 个节点"的同步问题，收敛成"N 个入口改状态 + 1 个渲染函数"。

**怎么用**。先看命令式写法：

```js
// 命令式：每个交互都直接操作 DOM，改一处要记得改全部
document.querySelector('#add').addEventListener('click', () => {
  const text = document.querySelector('#input').value;
  const li = document.createElement('li');
  li.textContent = text;
  document.querySelector('#list').append(li);
  // 还要记得更新计数、更新筛选结果、更新空状态提示……
  document.querySelector('#count').textContent = document.querySelectorAll('#list li').length;
});
```

再看看状态驱动写法：

```js
// 状态驱动：交互只改状态，界面由 render 统一推导
let state = { todos: [], filter: 'all' };

function setState(patch) {
  state = { ...state, ...patch };   // 唯一入口：所有修改都经过这里
  render(state);                    // 状态一变就重绘
}

function render(state) {
  const visible = state.todos.filter(byFilter(state.filter));
  list.innerHTML = '';              // 简化版：全量重绘（够用即可）
  for (const todo of visible) list.append(renderTodo(todo));
  count.textContent = `${visible.length} 项`;
  empty.hidden = visible.length > 0;
}

addBtn.addEventListener('click', () => {
  const text = input.value.trim();
  if (!text) return;
  setState({ todos: [...state.todos, { id: crypto.randomUUID(), text, done: false }] });
});
```

**坑在哪**：

- **绕过 `setState` 直接改 `state`**（`state.todos.push(x)`）界面不会更新——这就是 React 里"直接改 state 不生效"的同一个原因。养成"修改只有唯一入口"的习惯。
- **把 DOM 当数据库用**：从 DOM 里读数据（`input.value` 之外还包括从 `li.textContent` 反推数据）会让状态失去唯一来源。

<Callout kind="info" title="这就是 React 的雏形">
把上面的 `setState` + `render` 换成 `useState` + 组件函数，就是 React。本阶段手写一遍，阶段 6 学 React 时你会觉得"它只是帮我自动化了这件事"，而不是"魔法"。
</Callout>

### 3.2 执行机制：调用栈、事件循环与任务队列

**是什么**：事件循环（Event Loop）是 JavaScript 调度任务的执行模型。JS 只有一个调用栈，同一时刻只能跑一个函数；异步任务被放进队列，等栈清空后再执行。

**为什么需要**：如果所有任务都同步排队，一个网络请求就会冻住整个页面（无法滚动、无法点击）。事件循环让耗时操作"挂起"，把主线程让出来。

**怎么用**。任务是分优先级的：**同步代码 → 微任务（microtask）→ 宏任务（macrotask）**。

- 微任务：`Promise.then/catch/finally`、`queueMicrotask`、`MutationObserver`、`await` 之后的代码
- 宏任务：`setTimeout/setInterval`、事件回调、I/O、`requestAnimationFrame`（渲染前）

```js
console.log('1 同步');

setTimeout(() => console.log('5 宏任务：setTimeout'), 0);

Promise.resolve().then(() => console.log('3 微任务：Promise'));

queueMicrotask(() => console.log('4 微任务：queueMicrotask'));

console.log('2 同步');

// 输出顺序：
// 1 同步 → 2 同步 → 3 微任务：Promise → 4 微任务：queueMicrotask → 5 宏任务：setTimeout
```

规则记住两条就够：

1. **先清空整个微任务队列，再取下一个宏任务**（微任务里新产生的微任务也会在本轮清完）。
2. **`await` 后面的代码等价于放进微任务队列**。

```js
async function demo() {
  console.log('A');
  await null;                    // 让出一次微任务
  console.log('C');              // 相当于 .then(() => console.log('C'))
}
demo();
console.log('B');
// A → B → C
```

<Callout kind="warn" title="坑：await 不会并行">
`await a(); await b();` 是**串行**执行，总耗时 = a + b。要并行请用 `Promise.all([a(), b()])`，总耗时 = max(a, b)。这是 Java 程序员最容易写错的一处——`CompletableFuture` 的习惯在这里会害你。
</Callout>

### 3.3 作用域、闭包与 `this`

**是什么**：闭包（closure）是**函数 + 其定义时所处词法环境的引用**。三要素：函数嵌套、内层函数引用外层变量、内层函数在外层作用域之外被调用。

**为什么需要**：闭包是 JS 实现私有状态、柯里化、模块化的基础（ESM 之前全靠它）。

```js
function createCounter() {
  let count = 0;              // 被闭包捕获，外部无法直接访问
  return {
    inc: () => ++count,
    get: () => count,
  };
}
const c = createCounter();
c.inc(); c.inc();
console.log(c.get());        // 2
console.log(c.count);        // undefined —— 真正的私有
```

闭包在五种语言里都是"函数 + 捕获环境"，差异主要在**环境能否被可变捕获**，以及**闭包是不是一等值**。

<LangTabs title="闭包与一等函数：五种语言对照">
```java
Function<Integer, Integer> inc = x -> x + 1;   // Java 8+ lambda 是单方法接口的实例
List<Integer> xs = List.of(1, 2, 3);
xs.stream().map(inc).toList();                  // 闭包捕获外部 final/事实不可变变量
```
```ts
const inc = (x: number): number => x + 1;       // 箭头函数是一等公民，可传可返
const xs = [1, 2, 3];
xs.map(inc);                                     // 与 Java 不同：没有接口包装
```
```rust
let inc = |x: i32| x + 1;                        // 闭包默认不可变借用环境；捕获可变需 FnMut
let xs = vec![1, 2, 3];
let out: Vec<i32> = xs.iter().map(inc).collect(); // 捕获方式由编译器推断为 Fn
```
```go
inc := func(x int) int { return x + 1 }          // 函数是值，可直接赋给变量
result := []int{1, 2, 3}
for i, v := range result { result[i] = inc(v) }  // 没有内建 map，需手写循环
```
```python
inc = lambda x: x + 1                            # 函数是一等对象，可赋值、传参
xs = [1, 2, 3]
list(map(inc, xs))                               # map 返回惰性迭代器，包一层 list
```
</LangTabs>

结论：Java 的 lambda 本质是接口实例，`this` 在 lambda 里指向外层类；其余四门语言里函数都是自由的值，没有这套限制。

经典陷阱——循环里的闭包：

```js
// 错误：var 是函数作用域，三个回调共享同一个 i
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0);   // 3, 3, 3
}

// 正确 1：let 是块级作用域，每次迭代生成新的绑定
for (let i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0);   // 0, 1, 2
}
```

**`this` 的四条绑定规则**（优先级从高到低）：

| 规则 | 形式 | 示例 |
| --- | --- | --- |
| new 绑定 | `new Fn()` | `this` 指向新实例 |
| 显式绑定 | `fn.call/apply/bind(obj)` | `this` 指向 `obj` |
| 隐式绑定 | `obj.fn()` | `this` 指向 `obj` |
| 默认绑定 | `fn()` | 严格模式 `undefined`，否则全局对象 |

**箭头函数是例外**：它没有自己的 `this`，`this` 取自外层作用域（词法绑定），且**不能用 `call/apply/bind` 改变**。

```js
const obj = {
  name: 'lumen',
  regular() { console.log(this.name); },        // 隐式绑定 → 'lumen'
  arrow: () => console.log(this?.name),         // 词法绑定 → 外层 this
};
obj.regular();                                   // 'lumen'
const f = obj.regular;
f();                                             // undefined（默认绑定，丢了接收者）

// 这就是为什么事件回调 / 定时器里要用箭头函数：
class Timer {
  constructor() { this.seconds = 0; }
  start() {
    setInterval(() => this.seconds++, 1000);     // 箭头函数保住 this
  }
}
```

### 3.4 原型与类：委托，不是继承

**是什么**：JS 的对象通过**原型链（prototype chain）**查找属性——对象本身没有的属性，会去它的原型上找。这是**委托（delegation）**，与 Java 的"类继承 + 内存布局复制"是两回事。

```js
class Animal {
  constructor(name) { this.name = name; }
  speak() { return `${this.name} makes a sound`; }
}
class Dog extends Animal {
  #tricks = [];                     // 私有字段，外部不可访问
  speak() { return `${this.name} barks`; }
  learn(trick) { this.#tricks.push(trick); return this; }
}
const d = new Dog('Rex');
d.speak();                          // 'Rex barks'
Object.getPrototypeOf(d) === Dog.prototype;             // true
Object.getPrototypeOf(Dog.prototype) === Animal.prototype; // true
```

"私有"在各语言里强度不同：**Java 是 `private`、JS 是 `#` 硬私有、Rust 是模块私有、Go 是包私有（小写）、Python 只是约定**。

<LangTabs title="类与私有字段：五种语言对照">
```java
public class User {
  private final String name;        // private 成员，类外不可见
  public User(String name) { this.name = name; }
}
// 继承用 extends，字段默认包内可见
```
```ts
class User {
  #name: string;                     // # 是语言级硬私有，外部访问直接报错
  constructor(name: string) { this.#name = name; }
}
// 没有真正意义上的私有继承，# 是硬私有
```
```rust
pub struct User {
    name: String,                    // 不带 pub 的字段在模块外不可见（模块私有）
}
impl User {
    pub fn new(name: String) -> Self { Self { name } }
}
// Rust 没有继承，复用靠 trait 与组合
```
```go
type user struct {                   // 小写字段 name 在包外不可见（包私有）
    name string
}
func newUser(name string) user { return user{name: name} }
// Go 没有类与继承，复用靠组合（struct 嵌入）
```
```python
class User:
    def __init__(self, name: str):
        self._name = name            # 单下划线只是约定，运行期仍能访问
# Python 没有强制私有，双下划线 __ 也只是名字改写
```
</LangTabs>

**关键差异**（Java 程序员必读）：

- 原型是**运行时可修改的对象**，改 `Animal.prototype` 会影响所有已有实例（Java 的类加载后不可变）
- 没有真正的"私有继承"，`#field` 是硬私有（语言级），`_` 前缀只是约定
- 属性查找是**链式向上**的，层级越深越慢；Java 的字段访问是固定偏移
- `class` 只是语法糖，`typeof Dog === 'function'`

**坑在哪**：`this` 在原型方法里是**动态绑定**的，把方法摘出来单独调用就会丢 `this`（见 3.3）。Java 的方法永远属于类，没有这个问题。

### 3.5 值与引用、相等性与拷贝

```js
// 原始类型按值比较，引用类型按引用比较
1 === 1                       // true
{} === {}                     // false —— 两个不同的对象
'a' + 1                       // 'a1'（+ 遇到字符串优先拼接）
null == undefined             // true（==）
null === undefined            // false（===，永远用这个）
typeof null                   // 'object' —— 历史 bug，记住即可
typeof []                     // 'object'，判数组请用 Array.isArray([])

// 浅拷贝：只复制一层
const shallow = { ...obj };
// 深拷贝：结构化克隆，支持 Date/Map/Set/循环引用，不支持函数与 DOM 节点
const deep = structuredClone(obj);
// 冻结：Object.freeze 是浅冻结，嵌套对象仍可改
Object.freeze(obj);
```

相等性比较的核心是"原始值比内容、对象比什么"——**Java 要显式调 `equals`，其余语言各有默认语义**。

<LangTabs title="相等性比较：五种语言对照">
```java
String a = "x", b = "x";
boolean eq = a.equals(b);            // 对象必须用 equals，== 比的是引用
// 忘记写 equals 会退回 Object 的引用比较，容易踩坑
```
```ts
const eq = a === b;                  // 原始类型比内容，对象比引用；无 equals 概念
// 没有 equals 方法，要手写逐字段比较
// === 永远比引用（对象），NaN 例外
```
```rust
let eq = a == b;                     // 靠 PartialEq trait，多数类型 derive 即可
// 想自定义比较就手动 impl PartialEq
// 浮点用 f32::eq 而非 == 以避开 NaN 语义
```
```go
eq := a == b                         // 结构体按字段逐位比较
// 没有可重写的 equals，切片/map/func 不可直接 ==
// 比较内容需手写循环或 bytes.Equal 等
```
```python
eq = a == b                          # == 走 __eq__（值语义）
# is 才比对象身份（同一对象）
# 默认 __eq__ 按字段，但可变对象常被改写
```
</LangTabs>

构造对象/结构体后，常要"基于旧对象复制并改几字段"——**JS 用展开、Rust 用 `..` 更新语法、Python 用 `**`，Java 与 Go 要手写**。

<LangTabs title="对象与结构体构造、展开：五种语言对照">
```java
record Point(int x, int y) {}                // record 自动生成构造/getter/equals
Point p = new Point(1, 2);
// 没有内建展开：复制要手写 new Point(p.x(), p.y())
```
```ts
const p = { x: 1, y: 2 };
const moved = { ...p, x: 3 };               // 展开拷贝一层，右侧覆盖左侧
// 与 Java record 的不可变复制相比，JS 展开是浅拷贝
```
```rust
struct Point { x: i32, y: i32 }
let p = Point { x: 1, y: 2 };
let moved = Point { x: 3, ..p };            // ..p 把其余字段从 p 搬过来
// 没有 Java 的 new，靠字面值 + 更新语法
```
```go
type point struct { x, y int }
p := point{x: 1, y: 2}
moved := point{x: 3, y: p.y}                // 没有展开，字段要逐个列出
// Go 没有构造重载，靠字面量与函数
```
```python
from dataclasses import dataclass
@dataclass
class Point:
    x: int
    y: int
p = Point(1, 2)
moved = Point(x=3, **p.__dict__)            # 用 ** 解包做浅拷贝覆盖
# 也可用 dataclasses.replace(p, x=3)
```
</LangTabs>

**坑在哪**：`JSON.parse(JSON.stringify(obj))` 是流传最广的"深拷贝"，但会丢掉 `Date`（变字符串）、`undefined`、`Map/Set`、函数，遇到循环引用直接抛错。**用 `structuredClone`**。

### 3.6 现代语法速通

这一节全是日常高频语法，每条都配一个能直接跑的例子。

```js
// 解构 + 默认值 + 重命名 + 剩余
const { id, name: title = '未命名', ...rest } = { id: 1, name: 'A', tag: 'x' };
const [first, second, ...others] = [1, 2, 3, 4];

// 展开：数组 / 对象 / 函数调用
const merged = { ...defaults, ...overrides };
const cloned = [...items];
Math.max(...nums);

// 可选链与空值合并（?? 只在 null/undefined 时兜底，|| 会在 0/'' /false 时误伤）
const city = user?.address?.city ?? '未知';
const count = input.count || 10;      // 注意：count 为 0 时会变成 10
const safeCount = input.count ?? 10;  // 0 保持为 0

// 逻辑赋值
config.retries ??= 3;                 // 仅在 null/undefined 时赋值
obj.isOpen ||= false;

// 模板字符串与标签模板
const msg = `共 ${list.length} 项，完成 ${done} 项`;
const html = sanitize`<div>${userInput}</div>`;   // 标签模板：函数拿到模板与插值

// 对象方法简写与计算属性名
const key = 'done';
const todo = { text, [key]: false, toggle() { this[key] = !this[key]; } };

// 指数与数值分隔符
2 ** 10;                              // 1024
const budget = 1_000_000;             // 仅为可读性
```

变量声明的差异集中在两处：**是否可重新赋值**，以及**类型是编译期还是运行期确定**。

<LangTabs title="变量声明与可变性：五种语言对照">
```java
final var count = 10;   // final 才不可重新赋值，作用接近 JS 的 const
var name = "lumen";     // var 仅是类型推断，仍可重新赋值
// 类型必须在编译期确定，count = "x" 直接编译失败
```
```ts
const count = 10;       // const 绑定不可重新赋值，类似 Java 的 final var
let name = 'lumen';     // let 才能重新赋值；类型同 Java 是编译期检查
// 与 Java 不同：let/const 是块级作用域
```
```rust
let count = 10;         // 默认不可变——与 Java 默认可变正好相反
let mut name = "lumen"; // 必须显式加 mut 才能重新赋值
// 可变性是绑定的默认属性，要"申请"才可变
```
```go
count := 10            // := 声明并推断类型，不像 Java 要写类型或 final
var name = "lumen"     // 也可显式 var
// 变量必有零值（int 为 0），不存在 Java 式的未初始化
```
```python
count = 10             # 赋值即声明，Java 必须显式声明类型
name: str = "lumen"    # 类型标注只给工具看，运行期不强制
# 变量是名字到对象的绑定，可随时指向另一种类型
```
</LangTabs>

结论：Java 与 TypeScript 把"可变性"交给开发者选（final/const vs 普通），Rust 反过来默认不可变。Python 则完全没有"不可变绑定"的概念。

默认参数让调用方省略实参时走预设值；差异最大的是 **Java——它没有默认参数，只能靠方法重载**。

<LangTabs title="函数默认参数：有默认值的语言对照">
```ts
function greet(name: string, prefix = 'Hello'): string {
  return `${prefix}, ${name}`;   // 缺省值编译期内联，调用方不传即用默认
}
// 重载在 TS 里靠联合签名表达，默认参数是更轻量的写法
```
```python
def greet(name: str, prefix: str = "Hello") -> str:
    return f"{prefix}, {name}"   # 默认写在签名里；注意别用可变对象当默认值
# 默认参数在定义时求值一次，列表/字典当默认值会共享
```
</LangTabs>

<Callout kind="info" title="没有默认参数的三语言">
Java 没有默认参数，只能靠方法重载（写多个同名方法）；Rust 与 Go 同样不支持默认参数——Rust 通常用 `Option<T>` 或重载，Go 用零值或 Options 函数模式。
</Callout>

可变参数把"数量不定的同类型参数"收成集合；**Rust 没有用户态变参**，其余四门语言各有写法。

<LangTabs title="剩余参数与可变参数：四种语言对照">
```java
void log(String fmt, Object... args) {     // 可变参数本质是数组
  System.out.printf(fmt, args);
}
// 调用方传任意个实参，编译期展开成数组
```
```ts
function sum(...nums: number[]): number {  // 剩余参数收成真正的数组
  return nums.reduce((a, b) => a + b, 0);
}
// rest 只能放在参数列表最后
```
```go
func sum(nums ...int) int {                 // ...int 把多余参数收成切片
    total := 0
    for _, n := range nums { total += n }
    return total
}
// 同样只能放最后，且不能与别的变参混用
```
```python
def total(*nums: int) -> int:               # *nums 收成元组
    return sum(nums)
# 调用时也能用 * 把可迭代对象拆开传进去
```
</LangTabs>

<Callout kind="info" title="Rust 没有用户态可变参数">
Rust 标准库不提供 `fn(...T)` 形式的变参；表达"不定数量"通常用切片 `&[T]` 或宏（如 `println!`），不靠函数签名。
</Callout>

把值拼进字符串，五种语言各有占位写法，差异在**是否编译期检查占位符与类型**。

<LangTabs title="字符串插值与格式化：五种语言对照">
```java
String msg = String.format("共 %d 项，完成 %d 项", total, done); // % 占位符，类型要手对齐
// 类型不匹配（%d 传字符串）运行期才抛 MissingFormatArgumentException
// 没有内插语法，表达式必须提前算好再传参
```
```ts
const msg = `共 ${total} 项，完成 ${done} 项`;    // 反引号模板字符串，直接嵌表达式
// ${} 里能写任意表达式，编译期不做类型检查
// 这是与 Java String.format 最大的便利差异
```
```rust
let msg = format!("共 {} 项，完成 {} 项", total, done); // 编译期检查占位数量与类型
// 占位数量不对或类型不符，编译直接失败
// 没有 f-string 式裸插值，统一走 format!
```
```go
msg := fmt.Sprintf("共 %d 项，完成 %d 项", total, done) // 动词 %d 需匹配类型
// 占位类型错会 panic；也没有表达式内插
// 复杂拼接通常靠 fmt.Sprintf 一个函数搞定
```
```python
msg = f"共 {total} 项，完成 {done} 项"          # f-string，括号里可写表达式
# 花括号里可写任意表达式，运行期求值
# 没有编译期检查，拼错只会在运行期暴露
```
</LangTabs>

表达"可能没有值"，**Java 用 `Optional`、TS 用 `?.`/`??`、Rust 用 `Option`、Go 靠指针 nil、Python 用 `None`**。

<LangTabs title="空值与可选处理：五种语言对照">
```java
Optional<String> name = Optional.ofNullable(user.getName());
String display = name.orElse("匿名");        // 用 Optional 显式表达"可能没有"
// 没有 ?. 这样的安全调用，链式取值要手动 map
```
```ts
const display = user?.name ?? '匿名';         // ?. 短路、?? 只在 null/undefined 兜底
// ?? 与 || 不同：0 与 '' 不会被 ?? 误伤
// 这是 Java Optional 链在语法上的极简版
```
```rust
let display = user.name.unwrap_or("匿名");    // Option<T> 强制处理 None 分支
// 不处理 None 编译不过，杜绝 Java 式的空指针
// unwrap 仅在确定有值时用，否则 panic
```
```go
display := "匿名"                             // 指针可 nil，基本类型有零值
if user != nil && user.name != "" {
    display = user.name
}
// 没有 ?. 语法糖，靠 nil 判断手写
```
```python
display = user.name if user and user.name else "匿名"  # None 表示缺失
# 没有 ?. 语法糖，靠 and 短路手写
# 也可用 (user.name or "匿名") 但会一并兜底空串
```
</LangTabs>

模块（ESM）：

```js
// math.js —— 具名导出
export const add = (a, b) => a + b;
export default function subtract(a, b) { return a - b; }

// main.js
import subtract, { add } from './math.js';
const { add: plus } = await import('./math.js');   // 动态导入，返回 Promise

// ESM 与 CJS 的关键区别
// - ESM 是静态结构（可在编译期分析，支持 tree-shaking），CJS 是运行时对象
// - ESM 导入是**活绑定**（live binding），导出值变了导入处也会变；CJS 是值拷贝
// - ESM 默认严格模式，顶层 this 是 undefined
import.meta.url;                      // 当前模块 URL，替代 CJS 的 __dirname
```

### 3.7 数组与对象的现代方法

```js
const todos = [
  { id: 1, text: '写文档', done: true, tag: 'work' },
  { id: 2, text: '买菜', done: false, tag: 'life' },
  { id: 3, text: '改 bug', done: false, tag: 'work' },
];

// 不改动原数组的新方法（ES2023）：toSorted / toReversed / with / toSpliced
const byId = todos.toSorted((a, b) => a.id - b.id);
const renamed = todos.with(0, { ...todos[0], text: '写教程' });
// 注意：sort() / reverse() / splice() 会**原地修改**，需要不可变时请用上面这几个

todos.findLast((t) => !t.done);                     // 从后往前找
todos.at(-1);                                        // 最后一个，支持负索引
Object.groupBy(todos, (t) => t.tag);                 // { work: [...], life: [...] }
Map.groupBy(todos, (t) => t.done);                   // 需要 Map 时用这个

// reduce 的典型用法：分组 + 计数
const stats = todos.reduce((acc, t) => {
  acc[t.done ? 'done' : 'undone'] += 1;
  return acc;
}, { done: 0, undone: 0 });

// flat / flatMap：flatMap 等价于 map 后 flat(1)，但只遍历一次
const tags = todos.flatMap((t) => t.tag.split(','));
[[1, [2]]].flat(Infinity);                           // [1, 2]

// some / every：短路，注意空数组时 every 返回 true
[].every((x) => x > 0);                              // true（空真）
```

集合的"映射/过滤/归约"五语言都支持，但写法从 Stream 到迭代器链到列表推导各不相同。

<LangTabs title="数组映射与过滤：五种语言对照">
```java
List<Integer> doubled = nums.stream()
    .map(n -> n * 2)
    .filter(n -> n > 0)
    .toList();                        // Stream 惰性、一次性，Java 16+ 才有 toList()
// 不像 JS，Stream 不修改原集合，但也不是"新数组"模型
```
```ts
const doubled = nums
  .map((n) => n * 2)
  .filter((n) => n > 0);              // 链式返回新数组，不原地改
// 与 Java Stream 体验接近，但底层是数组方法而非流
```
```rust
let doubled: Vec<i32> = nums
    .iter()
    .map(|n| n * 2)
    .filter(|n| *n > 0)
    .cloned()
    .collect();                       // 迭代器零成本，编译期展开
// 没有 toList，需要 collect 到具体容器
```
```go
var doubled []int
for _, n := range nums {              // Go 没有内建 map/filter，通常手写循环
    if n*2 > 0 { doubled = append(doubled, n*2) }
}
// 或用 golang.org/x/exp/slices 的 Map/Filter 辅助
```
```python
doubled = [n * 2 for n in nums if n * 2 > 0]   # 列表推导一气呵成
# 也支持 (n*2 for n in nums) 生成惰性生成器
```
</LangTabs>

遍历集合时，五语言都提供"增强 for / for-of / for...in / range / for x in"式的元素遍历，**差异在返回值是索引还是元素**。

<LangTabs title="for 循环与迭代：五种语言对照">
```java
for (String s : list) {                     // 增强 for，遍历 Iterable
  System.out.println(s);
}
// 想拿索引要用传统 for(int i...)
```
```ts
for (const s of list) {                     // for...of 遍历可迭代对象
  console.log(s);
}
// for...in 遍历的是键名，别混用
```
```rust
for s in &list {                            // for...in 借用迭代，所有权不转移
    println!("{s}");
}
// 想要索引用 .iter().enumerate()
```
```go
for _, s := range list {                    // range 返回 (index, value)
    fmt.Println(s)
}
// 只要索引就 for i := range list
```
```python
for s in list:                              # 直接遍历元素
    print(s)
# 要索引用 for i, s in enumerate(list)
```
</LangTabs>

### 3.8 异步：Promise 与 async/await

**是什么**：`Promise` 是一个代表"未来某个值"的对象，有三种状态：`pending` → `fulfilled` / `rejected`，**状态一旦确定就不可逆**。

**为什么需要**：回调地狱（callback hell）——嵌套回调让错误处理、流程控制都变成噩梦。`Promise` 把异步结果变成一等值，可以被传递、组合、等待。

> 对照 Java：`Promise` ≈ `CompletableFuture`。但关键区别是 **JS 是单线程 + 事件循环**，`await` **不会创建新线程**——它只是把后续代码挂到微任务队列，主线程该干嘛干嘛。

```js
// 创建：executor 同步执行
const p = new Promise((resolve, reject) => {
  setTimeout(() => resolve('done'), 100);
});

// 消费：then 返回新 Promise，可链式
p.then((v) => `${v}!`).then(console.log).catch(console.error).finally(() => console.log('收尾'));

// async/await：语法糖，让异步代码长得像同步
async function loadUser(id) {
  try {
    const res = await fetch(`/api/users/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);   // fetch 只在网络失败时 reject
    return await res.json();
  } catch (err) {
    console.error('加载失败', err);
    return null;             // 兜底，不让异常继续上抛
  }
}
// async 函数的返回值**永远**被包装成 Promise
loadUser(1).then(console.log);
```

错误处理模型差异最大：**Java 有受检异常、TS 只有运行期异常、Rust 用 `Result`、Go 用多返回值、Python 用异常**。

<LangTabs title="错误处理：五种语言对照">
```java
try {
  risky();
} catch (IOException e) {                   // 受检异常必须处理或声明 throws
  log(e);
} finally {
  cleanup();
}
// 编译期强制你面对受检异常
```
```ts
try {
  await risky();
} catch (err) {                             // 异常无受检，运行期才知类型
  console.error(err);
} finally {
  cleanup();
}
// 与 Java 不同：不强制声明会抛什么
```
```rust
match risky() {
    Ok(v) => use(v),                        // Result 强制在编译期处理错误分支
    Err(e) => log(e),
}
// 不处理 Err 编译不过，杜绝 Java 式漏 catch
```
```go
v, err := risky()                           // 错误是普通返回值，常被忽略
if err != nil {
    log(err)
}
// 没有 try/catch，错误处理是显式的值
```
```python
try:
    risky()
except IOError as e:                        # 异常对象，运行期捕获
    log(e)
finally:
    cleanup()
# 没有受检异常，异常可一路上冒
```
</LangTabs>

<Callout kind="warn" title="坑：异步错误包不住">
JS 里漂浮的 Promise 不会被外层 `try/catch` 接住，必须 `await` 或 `.catch()`——这与 Java 的受检异常"编译期就逼你处理"正好相反。
</Callout>

<Callout kind="warn" title="坑：fetch 不会自动抛错">
`fetch` 只在**网络层失败**（断网、DNS 失败、CORS 被拦）时 reject；HTTP 404 / 500 仍然 resolve。必须显式检查 `res.ok`，这是线上最常见的漏判。
</Callout>

### 3.9 并发编排、取消与超时

四个组合器，各解决一类问题：

| API | 行为 | 典型场景 |
| --- | --- | --- |
| `Promise.all` | 全部成功才成功；**任意一个失败立即 reject**（快速失败） | 页面初始化需要的所有数据 |
| `Promise.allSettled` | 永不失败，返回每个任务的状态与结果 | 批量提交、需要知道每一项成败 |
| `Promise.race` | 第一个**敲定**（成功或失败）的胜出 | 超时控制 |
| `Promise.any` | 第一个**成功**的胜出；全失败才 reject（`AggregateError`） | 多镜像源取最快可用者 |

```js
// allSettled：部分失败不影响整体
const results = await Promise.allSettled(urls.map((u) => fetch(u)));
const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason);

// any：谁先成功用谁
const fastest = await Promise.any([fetchFromA(), fetchFromB(), fetchFromC()]);
```

取消与超时用 `AbortController`——它是 DOM 标准的一部分，`fetch`、`addEventListener`、部分 Node API 都支持：

```js
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(new DOMException('超时', 'TimeoutError')), 5000);

try {
  const res = await fetch('/api/search?q=react', { signal: controller.signal });
  const data = await res.json();
} catch (err) {
  if (err.name === 'AbortError') console.log('请求被取消或超时');
} finally {
  clearTimeout(timer);
}

// 同样的 signal 还能批量取消事件监听
list.addEventListener('click', handler, { signal: controller.signal });
controller.abort();     // 一次性解绑上面所有监听，杜绝内存泄漏
```

手写并发池（限制同时在跑的任务数，面试与实战都用得上）：

```js
async function limitConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      try {
        results[index] = await tasks[index]();
      } catch (err) {
        results[index] = { error: err };
      }
    }
  });

  await Promise.all(workers);
  return results;   // 顺序与输入一致
}

// 用法：100 个请求，最多同时 5 个
const data = await limitConcurrency(urls.map((u) => () => fetch(u).then((r) => r.json())), 5);
```

并发模型是五语言差异最大的地方：**Java 多线程、TS 单线程事件循环、Rust async 需运行时、Go goroutine、Python asyncio**。

<LangTabs title="异步与并发：五种语言对照">
```java
CompletableFuture.supplyAsync(() -> fetch())
    .thenApply(String::toUpperCase)
    .thenAccept(System.out::println);       // 线程池调度，await 会建新线程
// 并发靠 ExecutorService，是真线程
```
```ts
const text = await fetch();
console.log(text.toUpperCase());           // await 不建线程，只挂到微任务队列
// 与 Java CompletableFuture 最大区别：没有新线程
```
```rust
let handle = tokio::spawn(async {           // async 只是状态机，需运行时驱动
    let text = fetch().await;
    println!("{}", text.to_uppercase());
});
// 没有线程，靠 tokio 运行时在少量线程上多路复用
```
```go
go func() {                                 // goroutine 轻量，运行时调度到线程
    text := fetch()
    fmt.Println(strings.ToUpper(text))
}()
// 用 channel 通信代替共享内存
```
```python
async def main():
    text = await fetch()                    # asyncio 单线程事件循环，await 让出
    print(text.upper())
# 没有线程，靠事件循环多路复用
```
</LangTabs>

<Callout kind="danger" title="坑：forEach 不等待异步">
`arr.forEach(async (x) => { await fn(x) })` 不会按顺序等待，`try/catch` 也接不住里面的错误。需要串行请用 `for...of`，需要并行请用 `Promise.all(arr.map(...))`。
</Callout>

### 3.10 DOM 现代 API 与事件委托

**事件委托（event delegation）** 是本阶段最重要的 DOM 技巧：把监听器挂在**父元素**上，利用事件冒泡统一处理子元素——动态插入的元素自动生效，且只需一个监听器。

```js
// 命令式：给每个按钮绑定，新增的按钮还得重新绑
document.querySelectorAll('.delete').forEach((btn) => btn.addEventListener('click', onDelete));

// 事件委托：一个监听器搞定所有（含未来插入的）
list.addEventListener('click', (event) => {
  const deleteBtn = event.target.closest('.delete');   // 从点击目标向上找最近的匹配祖先
  if (!deleteBtn) return;
  const id = deleteBtn.closest('[data-id]').dataset.id;
  removeTodo(id);
});
```

常用 API 速览：

```js
// 查询
document.querySelector('.card');              // 单个
document.querySelectorAll('.card');           // NodeList，支持 forEach
el.matches('.active');                        // 自身是否匹配选择器
el.closest('[data-id]');                      // 向上找最近祖先（含自身）

// 类名与样式
el.classList.add('active');
el.classList.toggle('open', isOpen);          // 第二参数显式指定开关
el.classList.replace('old', 'new');
el.style.setProperty('--progress', '0.6');    // 写 CSS 自定义属性

// 数据属性：data-user-id → dataset.userId（连字符转驼峰）
el.dataset.userId = '42';
el.getAttribute('aria-expanded');             // 读非 data-* 属性

// 内容：优先 textContent，避免 XSS
el.textContent = userInput;                   // 安全
// el.innerHTML = userInput;                  // 危险！用户输入会被当成 HTML 执行

// 批量插入：用 DocumentFragment 只触发一次重排
const frag = document.createDocumentFragment();
for (const item of items) frag.append(createRow(item));
list.append(frag);

// 事件选项
window.addEventListener('scroll', onScroll, { passive: true });   // 滚动性能
btn.addEventListener('click', onClick, { once: true });           // 只触发一次
el.addEventListener('click', onClick, { signal });                // 可批量取消
```

<Callout kind="warn" title="坑：读写交替造成强制同步布局">
在循环里交替"写样式 → 读 `offsetHeight`"会让浏览器反复强制重排（layout thrashing）。正确做法是**先批量读、再批量写**，或用 `requestAnimationFrame` 批处理。
</Callout>

### 3.11 观察者与存储

三个观察者各司其职，替代了过去靠 `scroll`/`resize` 事件轮询的脏活：

```js
// IntersectionObserver：元素进入视口时触发（懒加载 / 曝光埋点 / 无限滚动）
const io = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const img = entry.target;
    img.src = img.dataset.src;
    io.unobserve(img);            // 加载完就取消观察
  }
}, { rootMargin: '200px' });      // 提前 200px 触发
document.querySelectorAll('img[data-src]').forEach((img) => io.observe(img));

// ResizeObserver：元素尺寸变化（比 window.resize 精确，能观察任意元素）
const ro = new ResizeObserver((entries) => {
  for (const entry of entries) console.log(entry.contentRect.width);
});
ro.observe(panel);

// MutationObserver：DOM 结构/属性变化（第三方脚本改动 DOM 时兜底）
const mo = new MutationObserver((records) => console.log(records.length, '处变化'));
mo.observe(root, { childList: true, subtree: true, attributes: true });
```

存储选型：

| 存储 | 容量 | 特点 | 适用 |
| --- | --- | --- | --- |
| `localStorage` | ~5MB | **同步阻塞**、仅字符串、同源共享 | 少量配置、草稿 |
| `sessionStorage` | ~5MB | 标签页关闭即清空 | 表单暂存 |
| `IndexedDB` | 数百 MB+ | 异步、支持事务与索引、可存结构化数据 | 业务数据（阶段 9 详解） |
| `BroadcastChannel` | — | 同源跨标签页广播 | 多标签页状态同步 |

```js
// 跨标签页同步：两个 API 配合即可
const channel = new BroadcastChannel('todos');
channel.postMessage({ type: 'sync', todos });       // 发送
channel.addEventListener('message', (e) => setState({ todos: e.data.todos }));

// localStorage 存对象要自己序列化，并带上版本号（为阶段 9 迁移 IndexedDB 预留）
localStorage.setItem('todos.v1', JSON.stringify({ version: 1, todos }));
```

### 3.12 "去 jQuery 化"对照表

jQuery 的历史贡献是抹平浏览器差异；2026 年的浏览器已经原生支持了它的绝大部分能力。逐条对照：

| jQuery 写法 | 现代原生等价 | 说明 |
| --- | --- | --- |
| `$('#id')` | `document.querySelector('#id')` | — |
| `$('.a .b')` | `document.querySelectorAll('.a .b')` | 返回 `NodeList`，可直接 `forEach` |
| `$el.addClass('x')` | `el.classList.add('x')` | 另有 `toggle(cls, force)` |
| `$el.attr('data-x')` | `el.dataset.x` | 连字符转驼峰 |
| `$el.html(str)` | `el.innerHTML = str` | 有 XSS 风险，优先 `textContent` |
| `$(document).on('click', '.btn', fn)` | `root.addEventListener('click', e => { const t = e.target.closest('.btn'); ... })` | **事件委托**，动态元素也有效 |
| `$.ajax({...})` | `fetch(url, { signal })` + `await res.json()` | 用 `AbortController` 替代 `abort()` |
| `$.each / $.map` | `Array.prototype.forEach / map` | — |
| `$.extend({}, a, b)` | `{ ...a, ...b }` | 浅合并；深拷贝用 `structuredClone` |
| `$.Deferred()` | `new Promise((resolve, reject) => ...)` | — |
| `$(el).animate(...)` | CSS transition / `el.animate()`（WAAPI） | 阶段 8 用 Motion 接管 |
| `$.trim(s)` | `s.trim()` | — |
| `$(el).is(':visible')` | `el.checkVisibility()` | 新 API，考虑 `display/visibility/opacity` |

哪些 jQuery 能力**原生无法完全等价**：

- 复杂选择器的历史兼容性（IE 时代的 `:eq()`、`:contains()` 等非标准选择器）
- 动画队列与链式 `delay()` 的编排体验
- 一套代码跨浏览器一致性（今天已不是刚需）

**结论**：新项目不要引入 jQuery。老项目**渐进迁移**——先让 jQuery 与原生共存（jQuery 操作的是同一个 DOM），按模块逐步替换，最后移除依赖；如果是一个跑得好好的后台系统，迁移收益可能低于风险，那就不动它。

### 3.13 手写工具集

下面四个函数是本阶段必须能手写的，也是面试高频：

```js
// 防抖：停止触发后 wait 毫秒才执行（搜索输入、窗口 resize）
function debounce(fn, wait, { leading = false } = {}) {
  let timer = null;
  return function (...args) {
    const callNow = leading && timer === null;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!leading) fn.apply(this, args);
    }, wait);
    if (callNow) fn.apply(this, args);
  };
}

// 节流：固定频率执行（滚动、鼠标移动）
function throttle(fn, wait) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last < wait) return;
    last = now;
    fn.apply(this, args);
  };
}

// 发布订阅：EventEmitter
class EventEmitter {
  #map = new Map();
  on(type, fn) {
    (this.#map.get(type) ?? this.#map.set(type, new Set()).get(type)).add(fn);
    return () => this.off(type, fn);        // 返回取消订阅函数，很实用
  }
  once(type, fn) {
    const off = this.on(type, (...args) => { off(); fn(...args); });
    return off;
  }
  off(type, fn) { this.#map.get(type)?.delete(fn); }
  emit(type, ...args) { for (const fn of [...(this.#map.get(type) ?? [])]) fn(...args); }
}

// LRU 缓存：利用 Map 的插入顺序特性
class LRUCache {
  constructor(limit) { this.limit = limit; this.map = new Map(); }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key); this.map.set(key, value);   // 重新插入到末尾 = 最近使用
    return value;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
  }
}
```

---

## 四、与 Java 经验的对照

| Java 世界的经验 | 前端的对应关系 | 注意差异 |
| --- | --- | --- |
| `CompletableFuture` | `Promise` / `async` `await` | `await` **不创建新线程**，JS 始终单线程；没有 `ExecutorService`，并发靠事件循环 |
| 多线程同步（锁、`volatile`） | 不存在 | 单线程 + 事件循环，**不需要锁**；但仍要处理竞态（请求乱序返回） |
| 类与继承体系 | 原型链 / `class` 语法糖 | 是**委托**不是继承；`this` 动态绑定，方法摘出来就丢 |
| `interface` / 抽象类 | 鸭子类型 + 阶段 3 的 TS 接口 | 运行期没有类型，接口只在编译期存在 |
| `equals()` / `hashCode()` | `===` / 手动比较 | 对象默认按引用比较；`Map`/`Set` 用 SameValueZero |
| `try/catch/finally` | 同名语法 | 异步错误必须 `await` 或 `.catch()`，`try` 包不住漂浮的 Promise |
| `Thread.sleep` | 不存在（不能阻塞主线程） | 用 `setTimeout` / `await delay(ms)`；阻塞主线程 = 页面卡死 |
| JVM 的 GC | 引擎 GC + 闭包引用 | 闭包与未解绑的监听器是前端内存泄漏的两大来源 |
| `System.out.println` 调试 | `console.*` + DevTools | 优先用断点与 Performance 面板，`console.log` 会拖慢渲染 |

---

## 五、实践练习

### 练习 1（必做）：语言内核 50 题（5 小时）

**目标**：把常用工具函数变成肌肉记忆。

**步骤**：

1. 先自己写，写不出来再看别人的实现，然后**默写一遍**
2. 每个函数配 3 个测试用例（正常 / 边界 / 异常）

**清单**：`debounce(fn, wait, { leading })`、`throttle`、`deepClone`（处理循环引用 + Date/Map/Set）、`curry`、`compose`、`pipe`、`flatten(arr, depth)`、`groupBy`、`uniqBy`、`EventEmitter`、`Promise.all` 的 Polyfill、`promiseRetry(fn, n, delay)`、`promiseTimeout(p, ms)`、`limitConcurrency(tasks, n)`、`LRUCache`。

**验收点**：不查文档 30 分钟内写出防抖、节流、深拷贝（含循环引用）、并发池四个函数。

### 练习 2（必做）：事件循环推演（2 小时）

**目标**：建立准确的执行顺序直觉。

**步骤**：找 10 段混合 `sync / setTimeout / Promise.then / async-await / queueMicrotask / MutationObserver / requestAnimationFrame` 的代码，**先手写答案再运行验证**。

**验收点**：10 题里至少对 9 题；错的每一题都要写出原因（哪一层的规则理解错了）。

### 练习 3（必做）：无依赖 Todo 应用（8 小时）

**目标**：把状态驱动模型完整跑一遍。

**步骤**：

1. 先设计状态结构：`{ todos: [], filter: 'all', history: [] }`
2. 写 `setState` 作为**唯一**修改入口，`render(state)` 作为**唯一**渲染出口
3. 实现功能：新增/编辑/删除/完成切换、全部·未完成·已完成筛选、批量清除已完成、拖拽排序（原生 HTML5 Drag & Drop 或 Pointer Events）
4. 持久化到 `localStorage`，**含 schema 版本号**（为阶段 9 迁移 IndexedDB 做准备）
5. 支持撤销：维护操作栈，最多 20 步
6. 补可访问性：键盘可达 + `aria-live` 播报

**验收点**：

- 全文件零第三方库，HTML/CSS/JS 三个文件搞定
- 把 `render` 函数删掉后重新加载页面，界面能完整重建（证明状态是唯一数据源）
- 撤销 20 步后再操作不崩，超出 20 步自动丢弃最旧的

### 练习 4（必做）：jQuery 迁移报告（4 小时）

**目标**：真正理解两种范式的差异，而不只是知道 API 对照。

**步骤**：找一段 200 行以上的真实 jQuery 代码（公司老项目或 GitHub 上的），改写为现代原生实现。

**报告必须包含**：

- 逐条对照表（原写法 → 新写法）
- 体积变化、是否需要 polyfill
- 哪些 jQuery 特性原生无法完全替代
- 结论：什么情况下**值得**保留 jQuery，什么情况下应该移除

**验收点**：对照表至少 10 条；结论要有具体判断标准，不能只写"看情况"。

### 练习 5（进阶）：原生组件三件套（5 小时）

1. **虚拟滚动列表**：1 万条数据流畅滚动，只渲染可视区 + buffer（`IntersectionObserver` 或手算 `scrollTop`）
2. **图片懒加载 + 骨架屏**：`IntersectionObserver` + `img.decode()`
3. **跨标签页同步**：用 `storage` 事件 + `BroadcastChannel` 让两个标签页的 Todo 实时同步

**验收点**：1 万条数据滚动时 FPS ≥ 55（用 DevTools Performance 面板验证）。

### 练习 6（挑战）：迷你响应式系统（4 小时）

用 `Proxy` 实现 20 行的响应式：`reactive(obj)` + `effect(fn)`，让 `state.count++` 自动触发注册的副作用。

```js
let activeEffect = null;
function effect(fn) { activeEffect = fn; fn(); activeEffect = null; }

const buckets = new WeakMap();           // 对象 → (属性 → 副作用集合)
function reactive(target) {
  return new Proxy(target, {
    get(obj, key, receiver) {
      if (activeEffect) {
        let depsMap = buckets.get(obj) ?? buckets.set(obj, new Map()).get(obj);
        let deps = depsMap.get(key) ?? depsMap.set(key, new Set()).get(key);
        deps.add(activeEffect);
      }
      return Reflect.get(obj, key, receiver);
    },
    set(obj, key, value, receiver) {
      const result = Reflect.set(obj, key, value, receiver);
      buckets.get(obj)?.get(key)?.forEach((fn) => fn());
      return result;
    },
  });
}

// 用法
const state = reactive({ count: 0 });
effect(() => console.log('count =', state.count));   // 打印 count = 0
state.count++;                                        // 自动打印 count = 1
```

> 这是理解 Vue 响应式、Zustand 订阅机制、React `useSyncExternalStore` 的关键前置练习，务必亲手做一遍。

---

## 六、常见坑与自查清单

### 高频坑

- `for (var i...)` 里注册的事件回调全是最后一个 `i` → 用 `let`
- 以为 `await` 会并行：`await a(); await b();` 是串行，用 `Promise.all([a(), b()])`
- `try/catch` 包不住 `forEach` 里的 `await` → `forEach` 不等待异步，改用 `for...of`
- 直接改 `state` 对象后不触发渲染 → 建立"setState 是唯一入口"的习惯
- `innerHTML` 拼接用户输入 → XSS，用 `textContent`
- 忘记移除事件监听 / `AbortController` 未 abort → 内存泄漏
- 在循环里读 `offsetHeight` 又写样式 → 强制同步布局，性能雪崩
- `fetch` 不检查 `res.ok` → 404/500 被当成成功
- `sort()` / `reverse()` 原地修改原数组 → 需要不可变时用 `toSorted()` / `toReversed()`
- `||` 兜底把 `0` 和 `''` 也兜掉了 → 用 `??`

### 自查清单

- [ ] 能画出事件循环示意图，并解释微任务队列的清空时机
- [ ] 不查文档写出防抖、节流、深拷贝（含循环引用）、并发池
- [ ] 能解释 `Promise.all` 与 `allSettled` 的差异及各自适用场景
- [ ] 用 `AbortController` 实现过请求取消与事件批量解绑
- [ ] Todo 应用中，`state` 与 DOM 的同步只有一个入口函数
- [ ] 能用原生事件委托处理动态插入元素的点击
- [ ] 用 `Proxy` 实现过最简响应式
- [ ] 迁移报告中至少覆盖 10 条 jQuery → 原生对照
- [ ] 能说出 `await` 为什么不创建新线程（讲给一个 Java 同事听，他能听懂）

---

## 七、参考资料

- MDN：JavaScript 指南、[并发模型与事件循环](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Execution_model)、DOM 接口文档
- 《你不知道的 JavaScript》（上卷：作用域与闭包、this 与对象原型）
- [javascript.info](https://javascript.info)：现代 JavaScript 教程，体系完整，适合系统补强
- ECMAScript 提案仓库：了解 `Promise.withResolvers`、装饰器、迭代器 helpers 等特性的最新状态
- 验证时间：2026-09；语言特性以 Chrome/Edge 150+ 与 Node 22.12+ 为准（与 `track.json` 的 `toolchain` 一致）
