# 阶段 6：React 19 核心

| 项目 | 内容 |
| --- | --- |
| **周期** | 4 周（约 40 小时）—— 全程最重的一块 |
| **前置** | 完成阶段 3（TypeScript 7）、阶段 4（Vite 8）、阶段 5（Tailwind CSS 4） |
| **本阶段技术栈** | React 19.2（2025-10 发布，2026-09 验证）· TypeScript 7 · Vite 8 · Tailwind CSS 4 · React Compiler 1.0（2025-10-07 GA） |
| **产出物** | 一个功能完整的看板（Kanban）应用：多列拖拽、任务 CRUD、筛选搜索、本地持久化、完整键盘可达 |

---

## 一、本阶段在学习路径中的位置

- **上承**：阶段 5 [阶段 5：Tailwind CSS 4 与样式系统](./05-TailwindCSS4与样式系统.md) 你已经用 Tailwind CSS 4 搭出了一套设计令牌 + 组件样式库，页面"长得像样"但内容仍是写死的、不会随交互变化。更早的阶段 2 你手写过 `setState` + `render` 的状态驱动雏形，阶段 3 又给它加了 TS 类型约束。
- **本阶段**：用 React 19.2 把阶段 2 手写的"状态 → 渲染函数 → DOM"**变成框架的内建机制**——你只写组件（渲染函数），React 负责协调、提交与更新。要啃下的核心概念是**组件与 props、渲染与提交、状态、事件、表单、Actions、Suspense、Hooks、ref、key、`use()`、React Compiler 1.0**。
- **下接**：阶段 7 [阶段 7：React 19 进阶与状态管理](./07-React19进阶与状态管理.md) 在本阶段单页看板的基础上，加并发特性、React Router 7 路由、TanStack Query 数据层与 Zustand 5 全局状态，把它升级成多页面应用。

> 这是整条路线的第二个分水岭。彻底丢掉 jQuery 的"选中 DOM 改 DOM"思维，建立"改状态、React 自动重渲染"的反射，后面所有阶段都建立在这之上。阶段 2 你手写 `setState` + `render` 是为了"懂原理"，本阶段你会发现 React 只是帮你把那套手动流程自动化了。

---

## 二、学习目标（可验收）

学完本阶段，你应该能够：

1. 建立 **UI = f(state)** 的心智模型，彻底摆脱 jQuery 的命令式 DOM 操作（阶段 2 已预热，这里要固化）。
2. 熟练使用全部核心 Hooks，并能说明每个 Hook 的**设计意图**与常见误用。
3. 掌握 React 19.2 的新特性：`use()`、`useActionState`、`useOptimistic`、`useFormStatus`、Actions、ref 作为 prop、ref 回调清理函数、`<Activity>`、`useEffectEvent`。
4. 理解 **React Compiler 1.0** 带来的写法变化：`useMemo`/`useCallback`/`memo` 的定位从"必写"变成"逃生舱"。
5. 掌握组件设计：组合优于继承、受控/非受控、容器与展示分离、自定义 Hook 抽取逻辑。
6. 掌握表单：受控表单、非受控 + `FormData`、原生校验、错误与提交状态管理。
7. 掌握错误边界、`Suspense`、错误边界 + `Suspense` 的协同、`StrictMode` 的意义。
8. 能定位并修复三类性能问题：重复渲染、巨额列表、输入卡顿。

---

## 三、核心概念详解

### 3.1 心智模型：声明式与 UI = f(state)

**是什么**：声明式（declarative）UI 的核心是把界面看成**状态的函数**：`UI = f(state)`。组件是一个**纯函数（pure function）**——给定相同的 props/state，永远返回相同的 JSX。你只描述"界面长什么样"，不写"怎么改 DOM"。

**为什么需要**：阶段 2 你已经体会过，jQuery 的命令式写法是"查到 DOM 节点 → 改它"，多个入口改同一份数据时要手动同步所有节点，漏一处就是 bug。状态驱动把它收敛成"N 个入口改状态 + 1 个渲染函数"，React 再帮你自动化——改状态，它算出哪里要变、只更新那一小块 DOM。

**怎么用**。先回忆阶段 2 的手写版本——`setState` 是唯一修改入口，`render` 是唯一渲染出口：

```js
// 阶段 2 的手写状态驱动（你写过一遍，这里换种写法复述）
let state = { count: 0 };
function setState(patch) {
  state = { ...state, ...patch };   // 唯一入口：所有修改都经过这里
  render(state);                    // 状态一变就重绘
}
function render(s) {
  document.querySelector('#app').textContent = `计数：${s.count}`;
}
```

React 等价于把 `setState` + `render` 换成 `useState` + 组件函数：

```tsx
import { useState } from 'react';

// 组件就是 render 函数；setCount 就是 setState
export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>计数：{count}</button>;
}
```

注意：你**没有写任何 DOM 操作**。点按钮改了 `count`，React 重新调用 `Counter` 算出新的 JSX，再把它和上一次的 JSX 做差异比对（协调），只把变化的那个文本节点更新到真实 DOM（提交）。这正是阶段 2 那套手动流程的自动化。

**坑在哪**：新手最容易回到"命令式"老路——在事件里直接用 `document.querySelector` 改 DOM。一旦你绕过 React 改了 DOM，React 下次渲染会基于自己认为的"当前 UI"去更新，两者冲突就会出诡异 bug。记住：**状态是唯一真相，DOM 是状态的投影，你只改状态。**

### 3.2 组件与 props：组合优于继承

**是什么**：组件（component）是 React 应用的基本积木，本质是一个接收 `props`、返回 UI 的函数。props（properties 的缩写）是父传给子的只读数据；`children` 是一个特殊 prop，代表组件标签之间的子内容。

**为什么需要**：Java 里复用靠"类继承"——`class AdminPage extends BasePage`，子类继承父类的结构与行为。但 UI 复用通常不是"is-a"关系，而是"has-a / 拼装"关系：一个卡片里"有"一个按钮、"有"一个头像。用继承会把结构焊死、难以灵活组合；组合（composition）则让父组件决定子组件的内容，灵活得多。这正是 React 反复强调的**组合优于继承（composition over inheritance）**。

**怎么用**。先看普通 props，再看 `children` 组合：

```tsx
type AvatarProps = { name: string; size?: number };

// 普通 props：只读、单向数据流（父 → 子，子不能直接改）
export function Avatar({ name, size = 32 }: AvatarProps) {
  return <img src={`/avatar/${name}`} width={size} height={size} alt={name} />;
}

// children：父组件把"任何东西"塞进子组件，子组件只负责摆放位置
type CardProps = { title: string; children: React.ReactNode };

export function Card({ title, children }: CardProps) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <div className="card-body">{children}</div>
    </section>
  );
}

// 组合使用：内容由父决定，子只提供"骨架"
export function Page() {
  return (
    <Card title="任务详情">
      <Avatar name="ada" />
      <p>这是任意内容，父组件说了算。</p>
    </Card>
  );
}
```

**坑在哪**：

- **把 props 当成可改的对象**：`props.title = 'x'` 既不安全也没用（props 是只读的）。要改 UI 就改状态，或让父组件传新的 props。
- **一上来就想写基类组件做继承**：React 里几乎没有"继承组件"的场景，复用靠 `children`、render props、自定义 Hook。对照 Java：这对应"模板方法模式"——父把渲染逻辑通过 `children` 注入，而非 `super.method()`。
- 单向数据流意味着子组件不能直接改父组件的 state——要改就通过父传下来的回调（也是 props 的一种）。

### 3.3 渲染与提交两阶段

**是什么**：React 更新 UI 分两步。第一步**渲染（render）**：调用组件函数得到 JSX（描述 UI 的虚拟树）。第二步**提交（commit）**：把渲染结果与上一次的差异应用到真实 DOM。两者之间 React 还会做协调（reconciliation）来算出最小变更。

**为什么需要**：把"算该长什么样"和"真正改 DOM"分开，React 才能在两者之间做批处理、并发调度、时间切片。你只要保证 render 是纯函数，副作用（发请求、改 DOM、订阅）一律放到 `useEffect`，React 才能安全地反复重渲染做对比。

**怎么用**：

```tsx
import { useState } from 'react';

export function Toggle() {
  const [on, setOn] = useState(false);
  // 这次"渲染"只是返回一个描述；React 在之后统一"提交"到 DOM
  return <button onClick={() => setOn((v) => !v)}>{on ? '开' : '关'}</button>;
}
```

关键认知：点击后 `setOn` 并不会"立刻"改 DOM，而是标记状态变了 → React 安排一次重新渲染 → 算出新 JSX → 在**提交阶段**才去动 DOM。React 18+ 默认**批处理（batching）**：一次事件回调里的多次 `setState` 会合并成一次重渲染，而不是每改一次渲染一遍。

**坑在哪**：

- 在事件处理器里 `setOn(...)` 后立刻 `console.log(on)` 读到的还是旧值——因为新的 render 还没发生。需要基于新值做点什么，就用函数式更新 `setOn(v => !v)`，或在 `useEffect` 里读。
- 在 render 期间（`return` 之前）做副作用（发请求、改全局变量）会被 `StrictMode` 的开发期双调用放大成 bug——副作用只能放 `useEffect`。

### 3.4 状态 useState：不可变更新

**是什么**：`useState`（state hook）让函数组件拥有自己的局部状态（state）。它返回 `[当前值, 修改函数]`，修改函数有两种用法：直接传新值，或传一个基于旧值的更新函数 `(prev) => next`。

**为什么需要**：阶段 2 你已经知道，直接改 `state.todos.push(x)` 不会触发渲染——因为引用没变。React 靠**引用相等**判断要不要更新（呼应 Java 的 `==` 对象身份，而非 `equals`），所以必须用"返回新对象/新数组"的方式改状态，这就是**不可变更新（immutable update）**。

**怎么用**：

```tsx
import { useState } from 'react';

type Todo = { id: string; text: string; done: boolean };

export function TodoInput() {
  // 惰性初始化：只在首次渲染执行一次，适合昂贵计算（避免每次渲染都算）
  const [text, setText] = useState(() => '');
  const [list, setList] = useState<Todo[]>([]);

  function add() {
    const value = text.trim();
    if (!value) return;
    // 函数式更新：用 prev 派生新数组（不可变），绝不 list.push(...)
    setList((prev) => [...prev, { id: crypto.randomUUID(), text: value, done: false }]);
    setText('');
  }

  return (
    <>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <button onClick={add}>添加</button>
    </>
  );
}
```

**坑在哪**：

- **直接改对象/数组不触发更新**：`list[0].done = true; setList(list)`——引用没变，React 以为没变化，界面不动。必须 `[...list]` 复制后再改，或 `list.toSorted(...)` 这类不可变方法。
- 更新值依赖旧值时用函数式更新 `setX(prev => ...)`；否则在并发/批处理下可能拿到过期的旧值。
- 不要把 state 当"普通可变变量"在渲染外随手改——state 只在下一次渲染才生效。

### 3.5 状态机 useReducer

**是什么**：`useReducer`（reducer hook）适合复杂状态——用 `(state, action) => newState` 的纯函数（reducer）描述"所有改动怎么发生"，配合可辨识联合（discriminated union，阶段 3 练过）描述 action 类型。

**为什么需要**：当状态有多个字段、改动分多类（新增/删除/完成/筛选），`useState` 的散落 `setX` 容易漏改相关字段、也难以测试。`useReducer` 把"怎么改"集中到一个纯函数里，可预测、可测试（reducer 不依赖组件，纯函数随便测）。

**怎么用**：

```tsx
import { useReducer } from 'react';

type State = { todos: Todo[]; filter: 'all' | 'done' | 'undone' };
type Action =
  | { type: 'add'; text: string }
  | { type: 'toggle'; id: string }
  | { type: 'setFilter'; filter: State['filter'] };

// reducer 是纯函数：不改入参、无副作用，只返回新 state
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add':
      return {
        ...state,
        todos: [...state.todos, { id: crypto.randomUUID(), text: action.text, done: false }],
      };
    case 'toggle':
      return {
        ...state,
        todos: state.todos.map((t) => (t.id === action.id ? { ...t, done: !t.done } : t)),
      };
    case 'setFilter':
      return { ...state, filter: action.filter };
    default:
      return state;
  }
}

export function Board() {
  const [state, dispatch] = useReducer(reducer, { todos: [], filter: 'all' });
  // 派生数据直接算，不要存进 state（能算出来就别 useState）
  const visible = state.todos.filter(
    (t) => state.filter === 'all' || t.done === (state.filter === 'done'),
  );
  return <ul>{visible.map((t) => <li key={t.id}>{t.text}</li>)}</ul>;
}
```

**坑在哪**：**reducer 里不能做副作用**（发请求、订阅、改全局），副作用放组件里的 `useEffect` 或阶段 7 的 action/loader。reducer 必须纯，否则 `StrictMode` 开发期双调用会让结果翻倍。

### 3.6 事件处理与合成事件

**是什么**：React 用**合成事件（SyntheticEvent）**统一了浏览器原生事件——你在 JSX 里写的 `onClick` 不是原生 DOM 事件，而是 React 包装后的跨浏览器对象，事件被委托到根节点统一管理。

**为什么需要**：不同浏览器事件 API 有差异，且把监听器统一挂在根节点比给每个元素挂原生监听高效得多。你在 JSX 里传的是函数引用，不是字符串（别写 `onClick="handle()"` 这种内联脚本写法）。

**怎么用**：

```tsx
import { useState } from 'react';

export function Clicker() {
  const [count, setCount] = useState(0);

  // 传函数本身（不要加括号调用）；需要参数就用箭头包一层
  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault(); // 合成事件同样有 preventDefault / stopPropagation
    setCount((c) => c + 1);
  }

  return <button onClick={handleClick}>点击 {count}</button>;
}
```

**坑在哪**：

- **不要在 JSX 里写 `onClick={handleClick()}`**——那会在渲染时立即调用并把返回值（通常是 undefined）当处理器，点击毫无反应。应传 `onClick={handleClick}` 或 `onClick={() => handleClick(id)}`。
- 合成事件对象在事件处理函数结束后会被复用（旧版有池化），不要在异步回调里读取它的字段；要读就先取值：`const id = e.currentTarget.dataset.id`。

### 3.7 受控与非受控表单

**是什么**：**受控组件（controlled component）**是表单值由 React state 驱动，每次输入都通过 `onChange` 写回 state。**非受控组件（uncontrolled component）**则让 DOM 自己保存值，提交时用 `ref`/`FormData` 一次性读取。

**为什么需要**：受控让你实时校验、禁用按钮、联动其它字段；非受控更简单，在"提交时才读一次"的场景更省心，也最契合 React 19 的 Actions（直接拿 `FormData`，不用为每个字段建 `useState`）。

**怎么用**。受控输入：

```tsx
import { useState } from 'react';

export function ControlledName() {
  const [name, setName] = useState('');
  const invalid = name.length === 0;
  return (
    <input
      value={name}
      onChange={(e) => setName(e.target.value)} // 每次输入写回 state
      aria-invalid={invalid}
      aria-describedby="name-tip"
    />
  );
}
```

非受控 + `FormData`（配合 React 19 的 Actions，提交时一次性读取，无需每个字段一个 state）：

```tsx
import { useActionState } from 'react';

// action 接收上一次 state 与打包好的 FormData，返回新 state
async function createCard(prev: { msg: string }, formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  await new Promise((r) => setTimeout(r, 500)); // 模拟网络请求
  return { msg: title ? `已创建：${title}` : '标题不能为空' };
}

export function CardForm() {
  const [state, action, pending] = useActionState(createCard, { msg: '' });
  return (
    // 提交时 React 自动把各字段打包成 FormData 传给 action；非受控，无需逐字段 state
    <form action={action}>
      <input name="title" aria-describedby="tip" />
      <button type="submit" disabled={pending}>{pending ? '提交中…' : '创建'}</button>
      {state.msg && <p id="tip" role="alert">{state.msg}</p>}
    </form>
  );
}
```

**坑在哪**：

- 受控输入忘了写 `onChange`，输入框变成只读（值永远是 state 初始值）。
- `value={undefined}` 会让 React 把受控组件切回非受控并报错——要么始终传 `value`，要么用 `defaultValue` 做非受控。
- React 19 推荐"提交时读 `FormData`"的 Actions 写法，能省掉一堆 `useState`；别为每个字段都建 state。

### 3.8 useEffect：副作用与清理函数

**是什么**：`useEffect`（effect hook）用于在"渲染之后"执行副作用（side effect）——发请求、订阅、操作 DOM、设定时器——这些在 render 里不能做的事都放这里。它返回一个**清理函数（cleanup）**，在下一次 effect 运行前或组件卸载时执行。

**为什么需要**：render 必须是纯函数（阶段 2 的"纯计算"）。副作用会破坏纯函数、还会在 `StrictMode` 双调用下加倍，所以必须隔离到 effect。依赖数组 `[deps]` 控制重跑时机：不写每次都跑，写空 `[]` 只挂载时跑一次，不传数组则每次渲染都跑。

**怎么用**（用 `AbortController` 解决请求竞态，呼应阶段 2）：

```tsx
import { useEffect, useState } from 'react';

export function SearchResults({ query }: { query: string }) {
  const [results, setResults] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then(setResults)
      .catch((err) => {
        if (err.name !== 'AbortError') console.error('加载失败', err); // 忽略主动取消
      });
    // 清理：query 变化时取消上一个请求，避免旧请求后到覆盖新结果（竞态）
    return () => controller.abort();
  }, [query]); // 只有 query 变才重发

  return <ul>{results.map((r) => <li key={r}>{r}</li>)}</ul>;
}
```

**坑在哪**：

- **把 effect 当 `watch` 用**（监听 state 变化去"派生"另一个 state）——应该直接算或用 `useMemo`/派生，而不是 effect 里 `setX`。
- **依赖数组撒谎**：用了某个变量却不写进依赖项，导致闭包捕获旧值。别用 `// eslint-disable-next-line` 掩盖，用 3.9 的 `useEffectEvent` 或修正设计。
- 忘记返回清理函数 → 事件监听/定时器/订阅泄漏，在 `StrictMode` 下会看到"双份"现象。

### 3.9 useEffectEvent：剥离多余依赖

**是什么**：`useEffectEvent`（React 19.2 新增）创建一个"事件函数"——它总是读到**最新**的 props/state，但**不会**成为 effect 的依赖。用来把"读最新值"的逻辑从依赖数组里挪出来。

**为什么需要**：经典场景——effect 依赖 `onTick` 回调，但回调每次渲染都是新引用，导致 effect 反复重跑。过去用 `useRef` 存最新值再 `ref.current`，很绕。`useEffectEvent` 直接解决"依赖数组里塞了不该有的值"这个老问题。

**怎么用**：

```tsx
import { useEffect, useEffectEvent, useState } from 'react';

export function Timer({ onTick }: { onTick: () => void }) {
  const [count, setCount] = useState(0);

  // 事件函数：读最新的 onTick，但不进入依赖数组
  const logTick = useEffectEvent(() => {
    onTick();
  });

  useEffect(() => {
    const id = setInterval(() => {
      setCount((c) => c + 1);
      logTick(); // 调用时拿到的是最新 onTick
    }, 1000);
    return () => clearInterval(id);
  }, []); // 依赖数组无需包含 onTick，effect 只挂载一次

  return <p>计时：{count}</p>;
}
```

**坑在哪**：

- `useEffectEvent` 创建的函数**不能**写进依赖数组，也**不能**当普通函数传给别的组件做 prop——它必须在 effect 内部调用。
- 它只解决"读最新值"，不解决"值变了要重跑 effect"——后者本就该进依赖数组。

### 3.10 ref 作为 prop 与 ref 清理函数

**是什么**：React 19 起，`ref` 可以像普通 prop 一样从父传给函数组件（不再需要 `forwardRef`）。ref 回调（传函数而不是 `{ current }` 对象）现在可以**返回一个清理函数**，在节点卸载或 ref 目标切换时执行。

**为什么需要**：过去函数组件要暴露 ref 必须包一层 `forwardRef`，嵌套时 `forwardRef` 层层透传很啰嗦。19 把 ref 当普通 prop，组件签名更干净。ref 回调返回清理函数，让"挂载时订阅 / 卸载时解绑"成对出现，杜绝泄漏（呼应阶段 2 的"记得移除监听"）。

**怎么用**：

```tsx
import { useState } from 'react';

// ref 直接作为普通 prop（无需 forwardRef）
type DialogProps = { ref?: React.Ref<HTMLDivElement> };

export function Dialog({ ref }: DialogProps) {
  return <div ref={ref}>对话框内容</div>;
}

// ref 回调返回清理函数（19.2）：节点卸载时执行
export function AutoFocusInput() {
  const inputRef = (node: HTMLInputElement | null) => {
    node?.focus();
    // 返回清理函数：组件卸载或 ref 目标变化时调用，可在这里移除手动监听
    return () => {
      // 例如 observer.disconnect()、removeEventListener(...)
    };
  };
  return <input ref={inputRef} />;
}
```

**坑在哪**：

- `useRef` 是**可变盒子**，`ref.current` 变了**不会**触发重渲染——别拿它当 state 用。它适合存 DOM 引用、定时器 id、上一次渲染的值。
- ref 回调如果你忘了 `return` 清理函数，React 19 会当作"没有清理函数"；要清理就显式返回一个函数。
- 清理函数的返回值是 React 19.2 的新能力，旧版（19.0/19.1）的 ref 回调返回值会被忽略。

### 3.11 key 与列表渲染

**是什么**：渲染列表时，每个元素需要一个稳定且唯一的 `key`（键），帮 React 在列表变化时识别"哪个是原来的哪个"，从而正确复用/移动/删除 DOM 节点。

**为什么需要**：没有 key（或用了会变的 key），React 只能用位置（index）猜测，列表插入/排序/过滤后，组件内部状态（输入框内容、焦点）会错位到错误项上。`key` 是 React 做列表 diff 的身份证。

**怎么用**：

```tsx
type Todo = { id: string; text: string };

// 正确：用稳定唯一 id 作 key
export function TodoList({ todos }: { todos: Todo[] }) {
  return (
    <ul>
      {todos.map((t) => (
        <li key={t.id}>{t.text}</li>
      ))}
    </ul>
  );
}
```

错误写法（用 index 作 key，列表变动后状态错乱）：

```tsx
// 错误：index 在插入/删除/排序后会错位，导致输入框内容"串台"
// {todos.map((t, index) => <li key={index}>{t.text}</li>)}
```

**坑在哪**：只有在"列表永不增删排序、纯展示"时 index 才勉强可用。只要列表会变，必须用数据自身的稳定 id。用 index 作 key 是 React 最常见的隐蔽 bug 来源之一。

### 3.12 条件渲染与短路陷阱

**是什么**：React 里用 `{condition ? <A /> : <B />}` 或 `&&` 来条件渲染（conditional rendering）。JSX 里 `false`、`null`、`undefined` 都会被渲染成"什么都不显示"。

**为什么需要**：UI 经常要"有数据才显示、没数据显示空态"。但 `&&` 短路有个隐蔽坑：左操作数 falsy 时，JSX 会把它的值本身渲染出来，而不是什么都不显示。

**怎么用**：

```tsx
// 错误：count 为 0 时，`0 && <Badge/>` 的结果是数字 0，页面上会显示 "0"
// {count && <Badge count={count} />}

// 正确：用三元或 Boolean 显式控制，保证 falsy 时渲染 null 而非 0/'' 
export function Badge({ count }: { count: number }) {
  return <>{count > 0 ? <span className="badge">{count}</span> : null}</>;
}

// 多分支用三元或提早 return
export function Panel({ user }: { user: User | null }) {
  if (!user) return <p>请先登录</p>; // 提早 return 也是条件渲染
  return <h1>你好，{user.name}</h1>;
}
```

**坑在哪**：`{count && <X />}` 在 `count === 0` 时渲染出 `0`，`{name && <X />}` 在 `name === ''` 时渲染出空字符串（尚可），但 `0` 会显形。凡是可能取 `0`/`''` 的数值/字符串，用三元 `? ... : null` 或 `Boolean(...)` 显式控制，别依赖 `&&` 的"巧合"。

### 3.13 React 19 Actions：useActionState / useFormStatus / useOptimistic

**是什么**：Actions 是 React 19 的"表单与突变"方案——把"提交"当成一个异步函数（`action`），React 自动管理其 pending/error 状态，并在提交期间禁用表单。配套三个 Hook：`useActionState`（读 action 的 state 与 pending）、`useFormStatus`（子组件读父 `<form>` 的提交状态）、`useOptimistic`（乐观更新）。

**为什么需要**：过去表单提交要手写一串 `useState` 管理 `pending`/`error`/`data`，样板代码多。Actions 把这套状态内置，且天然配合 `<form action={fn}>` 的渐进增强（无 JS 也能提交）。它替代了社区里 `react-final-form`/`useFormState` 一类方案。

**怎么用**：

```tsx
import { useActionState, useFormStatus } from 'react';

// action：接收上一次 state 与 FormData，返回新 state
async function subscribe(prev: { ok: boolean; msg: string }, formData: FormData) {
  const email = String(formData.get('email') ?? '');
  await new Promise((r) => setTimeout(r, 800)); // 模拟网络
  if (!email.includes('@')) return { ok: false, msg: '邮箱格式不正确' };
  return { ok: true, msg: '订阅成功' };
}

// 子组件用 useFormStatus 读父 form 的 pending（只能在 form 内部）
function SubmitButton() {
  const { pending } = useFormStatus();
  return <button disabled={pending}>{pending ? '提交中…' : '订阅'}</button>;
}

export function NewsletterForm() {
  const [state, formAction, pending] = useActionState(subscribe, { ok: false, msg: '' });
  return (
    <form action={formAction}>
      <input name="email" type="email" aria-describedby="tip" />
      <SubmitButton />
      {state.msg && (
        <p id="tip" role="alert" aria-invalid={!state.ok}>
          {state.msg}
        </p>
      )}
    </form>
  );
}
```

乐观更新（先显示预期结果，失败再回滚）：

```tsx
import { useOptimistic, useState } from 'react';

type Msg = { id: number; text: string; sending?: boolean };

export function Chat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  // useOptimistic：在真实数据之上叠加"乐观态"，真实提交成功后会被真实值覆盖
  const [optimistic, addOptimistic] = useOptimistic(
    messages,
    (list, next: Msg) => [...list, { ...next, sending: true }],
  );

  function send(formData: FormData) {
    const text = String(formData.get('text') ?? '');
    const id = Date.now();
    addOptimistic({ id, text }); // 先立刻显示（发送中）
    setTimeout(() => setMessages((prev) => [...prev, { id, text }]), 1000); // 真实落库后覆盖
  }

  return (
    <form action={send}>
      <input name="text" />
      <button>发送</button>
      <ul>
        {optimistic.map((m) => (
          <li key={m.id}>{m.text}{m.sending ? '（发送中）' : ''}</li>
        ))}
      </ul>
    </form>
  );
}
```

**坑在哪**：

- `useFormStatus` **只能在 `<form>` 的子组件里**用，直接在 form 同级拿不到 pending。
- `useOptimistic` 的更新**必须在 action 内部**调用，否则不生效。
- `useActionState` 的 action 签名是 `(prevState, formData) => newState`，别忘了第一个参数是上一次 state（用于累积错误等信息）。

### 3.14 Suspense 与 use() 处理异步

**是什么**：`Suspense`（悬念）是一个边界组件，包裹"还在加载"的内容时显示 `fallback`；`use()`（React 19 新增）让你在渲染中直接读取一个 Promise 或 Context 的值，且**可以在条件分支里调用**（不像普通 Hook 必须在顶层、按顺序调用）。

**为什么需要**：数据加载是异步的，组件需要"等到数据好再渲染"。`use()` + `Suspense` 让异步取数像同步写——`const data = use(promise)`，Promise 没好时 React 自动把子树挂到最近的 `Suspense` 边界，数据好后再继续渲染。

**怎么用**：

```tsx
import { Suspense, use } from 'react';

function fetchUser(id: string): Promise<{ name: string }> {
  return new Promise((resolve) => setTimeout(() => resolve({ name: 'Ada' }), 500));
}

function User({ userPromise }: { userPromise: Promise<{ name: string }> }) {
  const user = use(userPromise); // 渲染中读 Promise；可放条件分支
  return <p>你好，{user.name}</p>;
}

export function Profile({ id }: { id: string }) {
  const userPromise = fetchUser(id); // Promise 在组件外创建一次
  return (
    <Suspense fallback={<p>加载中…</p>}>
      <User userPromise={userPromise} />
    </Suspense>
  );
}
```

**坑在哪**：

- `use()` 只能用于**在组件外已创建好**的 Promise（如在父组件 `fetchUser(id)`），不要在渲染里现 `new Promise`——否则每次渲染都是新 Promise，永远挂起。
- `Suspense` 只能捕捉"用 `use`/懒加载抛出的 promise 挂起"，**抓不到**事件处理里的异步错误，那要用错误边界 + `try/catch`。
- `use()` 读 Context 比 `useContext` 灵活（可条件调用），但读 Promise 必须配 `Suspense`。

### 3.15 React Compiler 1.0：useMemo/useCallback 的新定位

**是什么**：React Compiler 1.0（2025-10-07 GA，2026-09 验证）是构建期工具，自动给你的组件做**记忆化（memoization）**——它分析组件，对 props/state 没变的子树跳过重渲染，等效于自动加 `useMemo`/`useCallback`/`memo`。

**为什么需要**：手动记忆化容易写错（漏包、错依赖、过度包）。官方数据：初始加载与导航最高约 12% 提升，部分交互约 2.5 倍。它的出现让"记忆化"从"每处必写"降级为"性能逃生舱"。

**怎么用**（先写正确，让编译器优化）：

```tsx
import { useMemo } from 'react';

type Item = { id: string; price: number };

// 旧习惯（Compiler 之前）：手动记忆化排序，避免每次渲染重排
const sorted = useMemo(() => items.toSorted((a, b) => a.price - b.price), [items]);

// Compiler 1.0 之后：组件是纯函数，编译器自动做等效记忆化
// 上面的 useMemo 可以删掉——编译器会替你跳过没必要的重算
// 但"昂贵计算 / 要当 prop 传的对象"仍是手动 useMemo 的合理逃生舱
```

接入（Vite 8 + `@vitejs/plugin-react` v6，Oxc 编译）：

```ts
// vite.config.ts（示意）
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react({
      babel: { plugins: [['babel-plugin-react-compiler']] },
    }),
  ],
});
```

**坑在哪**：

- Compiler 要求组件是**纯函数**：不改入参、渲染中不做副作用、不依赖可变外部变量。否则它无法安全记忆化，`StrictMode`/编译检查会报警。
- 旧教程"到处 `useMemo`/`useCallback`"在 Compiler 时代反而是负担——包错依赖还会变慢。先写正确，profiler 证明热点再手动加。
- 原理仍要懂（面试与调试需要）：记忆化靠引用相等，依赖变了才重算。

### 3.16 错误边界与 StrictMode

**是什么**：错误边界（error boundary）是能捕获"子树渲染/生命周期错误"的组件，用 `componentDidCatch`/`getDerivedStateFromError` 兜底；注意它**只能是类组件（class component）**。StrictMode 是开发期包裹组件，故意双调用 render/effect 以暴露不纯代码。

**为什么需要**：单个组件抛错不应让整页白屏。错误边界把崩溃限制在局部并显示友好兜底。`StrictMode` 的双调用会放大"render 里有副作用"的 bug，逼你写纯组件——它是开发助手，不是运行时功能（生产构建会被去掉）。

**怎么用**：

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error }; // 渲染期出错 → 切到兜底 UI
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('渲染错误', error, info.componentStack); // 上报
  }

  render() {
    if (this.state.error) {
      return <p role="alert">出错了：{this.state.error.message}</p>;
    }
    return this.props.children;
  }
}
```

**坑在哪**：

- 错误边界**捕获不了**事件处理器里的错误、异步回调里的错误——那些要用 `try/catch` 自己处理。它只管"渲染阶段"抛出的错误。
- 别为了消除 `StrictMode` 的双调用告警而关掉 `StrictMode`；那是症状，根因是 effect 不纯，去修 effect 而不是关开关。

---

## 四、与 Java 经验的对照

| Java 经验 | 前端对应 | 注意差异 |
| --- | --- | --- |
| Servlet/JSP 的请求-响应模型 | 组件的**渲染-提交**：输入 props/state → 输出 UI | 组件是纯函数反复调用，不是一次性的请求处理；状态留在客户端，不随响应结束销毁 |
| 类继承复用（`extends`） | **组合**：`children` / 自定义 Hook / 复合组件 | UI 复用是"has-a"不是"is-a"；React 几乎没有继承组件的场景 |
| Spring 的 Bean 单例与依赖注入 | 状态提升（state lifting）+ Context / props | 优先 props；Context 是跨层逃生舱，滥用会全树重渲染 |
| 观察者模式（`Observable`/`Listener`） | `useSyncExternalStore` / Zustand 订阅（阶段 7 详述） | 前端订阅在 React 调度里，乱序更新由协调处理 |
| `equals`/`hashCode` 决定对象身份 | 引用相等决定更新（不可变数据是刚需） | 直接改对象不触发更新，必须返回新引用 |
| MVC 里 Controller 改 Model 后手动刷 View | 改 state → React 自动重渲染（单向数据流） | 你只改状态，不碰 DOM |
| 事务（要么全成要么全败） | 一次渲染是"原子的"（不可变 + 批处理） | 多次 `setState` 在事件内自动批处理为一次渲染 |
| 线程池并发执行任务 | 无；单线程 + 调度器（并发是优先级调度，非多线程） | `startTransition`/`useDeferredValue` 是"让出紧急度"，不是新线程 |
| `try/catch` 全局兜底 | 错误边界（仅类组件）+ `try/catch` | 错误边界抓不到事件/异步错误 |
| JUnit 单测 | Vitest + @testing-library/react（测行为不测实现） | 用 RTL 模拟用户点击，而非断言内部 state |

---

## 五、实践练习

### 练习 1（必做）：思维切换 10 题（4 小时）

**目标**：把阶段 2 的 10 段 jQuery 代码改写成 React 组件，固化"状态驱动"反射。

**步骤**：
1. 逐段找出 jQuery 里"选中 DOM → 改 DOM"的地方，改成"state + 组件"。
2. 重点体会：全文没有一个 `document.querySelector`，渲染由 React 接管。

**验收点**：10 段代码改写后，交互行为与原 jQuery 版一致，且无任何手动 DOM 操作。

### 练习 2（必做）：Hooks 专项（6 小时）

**目标**：逐个写最小 demo 并解释原理，建立 Hook 直觉。

**步骤**：为以下每个写可运行 demo：`useState` 惰性初始化与函数式更新、`useReducer` 状态机、`useEffect` 清理与竞态处理（请求返回顺序）、`useRef` 保存上一次值、`useId`、`useTransition` 优化筛选、`useOptimistic` 点赞、`use()` 读 Promise、`<Activity>` 保留 Tab 状态、`useEffectEvent` 剥离依赖。

**验收点**：能口述每个 Hook 的"设计意图 + 一个坑"，并贴出运行截图。

### 练习 3（必做）：看板应用 Kanban（14 小时）

**目标**：产出本阶段核心作品。

**步骤**：
1. 多列（Todo/Doing/Done），任务可新增、编辑、删除、移动
2. 拖拽排序（自研 Pointer Events 或 dnd-kit）
3. 搜索 + 标签/优先级筛选 + 排序
4. 乐观更新：移动卡片先本地更新再"提交"
5. 状态本阶段先用 `useReducer` + Context，阶段 7 迁 Zustand
6. 持久化到 `localStorage`（阶段 9 迁 Dexie）
7. 完整键盘操作 + `aria-live` 播报
8. 分层：`components/`（展示）· `hooks/`（逻辑）· `lib/`（纯函数）· `types/`

**验收点**：TypeScript 严格模式零错误；React Compiler 开启；Lighthouse 可访问性 ≥ 95。

### 练习 4（必做）：表单专项（4 小时）

**目标**：吃透受控与 Actions 两种表单范式。

**步骤**：
1. 纯 React 实现多步注册表单：跨步校验、字段数组、异步唯一性校验、提交中状态、错误汇总
2. 用 `useActionState` + `useOptimistic` 重写一遍，对比代码量与心智负担

**验收点**：两个版本行为一致；能说出各自适用场景。

### 练习 5（进阶）：虚拟列表（4 小时）

**目标**：不依赖库实现 1 万条任务的虚拟滚动列，滚动 60fps。

**步骤**：手算 `scrollTop` 只渲染可视区 + buffer；对比 `@tanstack/react-virtual` 实现，总结差异。

**验收点**：DevTools Performance 中滚动 FPS ≥ 55。

### 练习 6（进阶）：编译器实验（3 小时）

**目标**：亲手验证 React Compiler 的效果边界。

**步骤**：
1. 开启 Compiler，用 Profiler 对比优化前后重渲染次数
2. 故意写一段"不纯"代码（渲染中 push 数组），看编译器/ESLint 是否报错
3. 记录：`useMemo` 删除后性能是否变化

**验收点**：能解释"编译器替你做了什么"以及"什么时候仍需手动记忆化"。

### 练习 7（挑战）：测试（4 小时）

**目标**：用测试锁住行为。

**步骤**：用 Vitest + @testing-library/react 为看板写测试：用户行为（新增/拖拽/筛选）、自定义 Hook（`renderHook`）、覆盖率 ≥ 70%。

**验收点**：`pnpm test` 通过；覆盖率报告 ≥ 70%。

---

## 六、常见坑与自查清单

### 高频坑

- 依赖数组撒谎（`// eslint-disable-next-line`）→ 用 `useEffectEvent` 或修正设计
- 用 index 当 `key` → 插入/排序时状态错乱
- 把派生数据存进 state → 直接算
- 在渲染中做副作用（订阅、发请求）→ 放 effect 或事件
- `useEffect` 里请求不处理竞态 → 用 `AbortController` / 忽略标记
- Context value 传新对象 → 全树重渲染，用 `useMemo` 或拆分 Context
- 事件处理器里 `setState` 后立刻读新值 → 读不到，用函数式更新或 effect
- 用 `useMemo` 包一切 → Compiler 时代反而是负担
- 忘记 `StrictMode` 双调用导致重复请求 → 说明 effect 不纯，修 effect 而不是关 StrictMode
- 条件渲染 `count && <X/>` 在 `count===0` 时显示 0 → 用三元 `? ... : null`
- 直接改对象/数组不触发更新 → 必须返回新引用
- `onClick={handleClick()}` 立即调用 → 应 `onClick={handleClick}`
- 非受控组件 `value={undefined}` → 切回受控并报错，用 `defaultValue` 或始终传 `value`
- `useFormStatus` 用在 `<form>` 同级拿不到 pending → 必须放子组件
- `useOptimistic` 更新不写在 action 内 → 不生效

### 自查清单

- [ ] 能解释 `UI = f(state)`，并举例说明命令式写法的危害
- [ ] 说出 15 个以上 Hook 的用途与至少一个坑
- [ ] 能正确使用 `useActionState` + `useOptimistic` 完成一次乐观更新
- [ ] 用 `<Activity>` 做过状态保留
- [ ] 能解释 `key` 的作用与错误用法的后果
- [ ] 开启 React Compiler 后项目正常运行，且能解释它替你做了什么
- [ ] 看板应用在纯键盘下可完成全部核心操作
- [ ] 有用 `@testing-library/react` 写的真实用户行为测试
- [ ] 能区分"渲染"与"提交"两阶段，并说清副作用为什么只能放 effect
- [ ] 用 `useFormStatus` 在 `<form>` 子组件里读过提交状态
- [ ] 能说出 ref 作为 prop 与 ref 回调清理函数（19.2）的写法
- [ ] `use()` 读 Promise 时配了 `Suspense`，且 Promise 不在渲染里现 new

---

## 七、参考资料

- react.dev 官方 "Learn" 新版教程（含 Compiler 视角，务必通读）
- React 19 发布说明、React 19.2 发布说明（2025-10 发布，2026-09 验证）
- React Compiler 文档与 `eslint-plugin-react-hooks` v6
- 《React 官方文档 · Escape Hatches》章节（ref / effect / 逃生舱的心法）
- Kent C. Dodds：Testing Library 理念文章
- 验证时间：2026-09；版本以 React 19.2、TypeScript 7、Vite 8、Tailwind 4 为准（与 `track.json` 的 `toolchain` 一致）
