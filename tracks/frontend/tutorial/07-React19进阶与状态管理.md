# 阶段 7：React 19 进阶与 Zustand 5 状态管理

| 项目 | 内容 |
| --- | --- |
| **周期** | 3 周（约 30 小时） |
| **前置** | 完成阶段 6（React 19 核心） |
| **本阶段技术栈** | React 19.2（2025-10 发布，2026-09 验证）· Zustand 5（2026-09 验证）· React Router 7（Data Router）· TanStack Query · react-hook-form + zod · Tailwind 4 |
| **产出物** | 把阶段 6 的看板升级为**多页面应用**：路由 + 全局状态 + 服务端数据层 + 表单校验 + 错误/加载/空状态体系 |

---

## 一、本阶段在学习路径中的位置

- **上承**：阶段 6 [阶段 6：React 19 核心](./06-React19核心.md) 你用 React 19.2 写出了单页看板（状态先放 `useReducer` + Context）。但全局状态怎么管、多个页面怎么切、服务端数据怎么缓存、大表单怎么校验，这些还没解决——所有状态都挤在顶层，切页面就丢。
- **本阶段**：把单页看板升级成**多页面应用（MPA 形态 + SPA 体验）**。核心是建立**状态分层**心智：URL 状态 / 服务端数据 / 全局 UI 状态 / 组件局部状态各归其位。具体要啃：并发特性、React Router 7、TanStack Query、**Zustand 5**、`useSyncExternalStore` 原理、性能优化与错误兜底。
- **下接**：阶段 8 [阶段 8：Motion 13 交互动效](./08-Motion13交互动效.md) 用 Motion 13 给这套多页面应用加上交互动效与无障碍动画。

> 阶段 6 教你"怎么写组件"，阶段 7 教你"状态该放哪、页面该怎么切"。这一阶段最容易犯的错是"所有状态都塞进全局 store"——本阶段的架构认知（3.1）就是专门治这个的。

---

## 二、学习目标（可验收）

学完本阶段，你应该能够：

1. 能设计**分层清晰**的前端状态架构，并说出每类状态该放哪里（URL / 服务端缓存 / 全局 store / 组件局部）。
2. 熟练使用 **Zustand 5** 管理全局状态，掌握 slice 拆分、中间件（`persist` `immer` `devtools`）、选择器与浅比较、`useShallow`、store 之外访问、`createStore` + Context 的多实例方案。
3. 掌握 **React Router 7**（Data Router：`loader` / `action` / `useNavigation` / 错误边界 / 路由级代码分割）。
4. 掌握**服务端数据层**：TanStack Query 的查询键设计、缓存与失效、乐观更新、分页/无限滚动、竞态处理。
5. 掌握复杂表单方案（react-hook-form + zod），理解其与 React 19 Actions 的取舍。
6. 建立完整的**异步 UI 状态体系**：加载 / 错误 / 空 / 部分失败 / 重试 / 骨架屏。
7. 能诊断并优化真实性能问题（重渲染追踪、bundle 拆分、请求瀑布）。

---

## 三、核心概念详解

### 3.1 状态分层（本阶段最重要的架构认知）

**是什么**：状态分层（state stratification）是把应用里的"状态"按生命周期和归属分成几类，每类用最合适的工具存放——而不是统统塞进一个全局对象。

**为什么需要**：阶段 6 你所有状态都在顶层。一旦应用变多页、有服务端数据，问题就来了：把"当前在第几页"存进 store，刷新就丢了（它本该在 URL 里）；把"服务端列表"手抄进 store，就有两份真相、缓存永远不同步。分层让每类状态只有单一来源。

**怎么用**。先记住这张归属表，再写代码：

| 状态类型 | 归属 | 工具 |
| --- | --- | --- |
| **URL 状态**（页码、筛选、选中项） | URL | React Router `useSearchParams` |
| **服务端数据**（列表、详情、用户信息） | 服务端缓存 | TanStack Query |
| **跨页面 UI 状态**（主题、侧边栏、当前工作区） | 全局 store | **Zustand** |
| **组件局部状态**（输入框、展开/收起） | 组件 | `useState` |
| **表单状态** | 表单库 | react-hook-form |
| **一次性交互状态**（弹窗开关） | 组件或 URL | — |

**坑在哪**：核心原则——**能放局部不放全局；服务端数据永不手抄进 store；URL 是天然的状态容器（可分享、可后退）**。最常见的错误是两处真相（store 里一份、服务端一份），改了一处另一处不更新。

### 3.2 并发特性：startTransition 与 useDeferredValue

**是什么**：并发特性（concurrent features）让 React 区分"紧急更新"（输入、点击）和"非紧急更新"（大列表重算、搜索结果）。`startTransition` 把一个 state 更新标记为低优先级；`useDeferredValue` 返回一个"滞后版"的值，让重活延后、输入框保持灵敏。

**为什么需要**：一个巨大的筛选列表，每次按键都同步重算会让输入卡顿（INP 指标变差）。把"列表重算"降级为非紧急更新，用户输入永远跟手，React 在空闲时再算。

**怎么用**：

```tsx
import { useState, useDeferredValue, startTransition } from 'react';

export function Search() {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query); // 非紧急：输入保持灵敏，列表可滞后

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    // 把状态更新标记为"非紧急"，React 优先保证本次输入渲染流畅
    startTransition(() => setQuery(value));
  }

  return (
    <>
      <input value={query} onChange={onChange} />
      {/* 用 deferred 渲染重列表，输入时不会卡 */}
      <ResultList query={deferred} />
    </>
  );
}
```

**坑在哪**：`startTransition`/`useDeferredValue` 不创建新线程（JS 始终单线程），只是让 React 调度器优先处理紧急更新。不要在 transition 里放"必须立刻看到结果"的逻辑（比如打开弹窗），否则会有可见延迟。

### 3.3 <Activity>：保留子树状态（19.2）

**是什么**：`<Activity>`（React 19.2 新增）是 React Router 7 的 `<Offscreen>` 演进版——以 `visible`/`hidden` 模式保留子树的状态、同时卸载其副作用，用于"预渲染/保留表单草稿/切换 Tab 不丢输入"。

**为什么需要**：过去用 `display:none` 隐藏 Tab 会让组件继续跑副作用、占资源；用条件渲染卸载又会丢掉输入内容。`<Activity>` 在 `hidden` 时保留 state（像没卸载），但卸载 `useEffect` 订阅，切回 `visible` 时状态还在。

**怎么用**：

```tsx
import { Activity } from 'react';

function Tabs({ tab }: { tab: 'a' | 'b' }) {
  return (
    <>
      {/* hidden 模式下保留子树状态、卸载副作用，切回 visible 时状态还在 */}
      <Activity mode={tab === 'a' ? 'visible' : 'hidden'}>
        <PanelA />
      </Activity>
      <Activity mode={tab === 'b' ? 'visible' : 'hidden'}>
        <PanelB />
      </Activity>
    </>
  );
}
```

**坑在哪**：`<Activity>` 是 React 19.2 才有的 API，确认依赖版本；它保留 state 但会卸载 effect，依赖 effect 副作用（如每秒轮询）的组件在 `hidden` 时会暂停，切回需重新挂载 effect。

### 3.4 路由：React Router 7（Data Router）

**是什么**：React Router 7 的 Data Router 用 `createBrowserRouter` 声明式配置路由，并把"取数"和"突变"从组件里搬出来：`loader`（进入路由前并行取数）、`action`（表单提交突变）、`errorElement`（路由级错误兜底）、`useNavigation`（全局 pending 状态）。

**为什么需要**：阶段 6 你在组件里 `useEffect` 发请求，导致"先渲染空壳再异步填"。Data Router 的 `loader` 在渲染前就把数据备好，配合 `errorElement` 做全局错误兜底，路由级代码分割还能按页懒加载。

**怎么用**（嵌套路由 + loader）：

```tsx
import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
  Link,
  useLoaderData,
  useNavigation,
} from 'react-router-dom';

async function boardLoader({ params }: { params: { id: string } }) {
  const res = await fetch(`/api/boards/${params.id}`);
  if (!res.ok) throw new Response('Not Found', { status: 404 });
  return res.json();
}

function BoardDetail() {
  const board = useLoaderData() as { id: string; name: string };
  const nav = useNavigation();
  return (
    <section aria-busy={nav.state === 'loading'}>
      <h1>{board.name}</h1>
    </section>
  );
}

function Layout() {
  return (
    <div>
      <nav><Link to="/">首页</Link></nav>
      <Outlet /> {/* 子路由渲染到这里 */}
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <p role="alert">出错了</p>,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'boards/:id', element: <BoardDetail />, loader: boardLoader },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
```

`action` 处理突变（表单提交），用 `<Form method="post">` 提交：

```tsx
import { type ActionFunction } from 'react-router-dom';

// 路由 action：处理 POST 突变，返回后 router 自动重定向/刷新 loader 数据
export const createBoardAction: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const name = String(formData.get('name') ?? '');
  await fetch('/api/boards', {
    method: 'POST',
    body: JSON.stringify({ name }),
    headers: { 'Content-Type': 'application/json' },
  });
  return { ok: true };
};
// 路由配置加 action: createBoardAction；<Form method="post"> 提交后自动触发
```

**坑在哪**：`loader` 里**串行 await**多个请求会形成请求瀑布，用 `Promise.all` 并行；筛选用 `useSearchParams` 单一数据源，别用 `useEffect` 去同步 URL 与状态（会双份真相）。

### 3.5 数据请求与缓存：TanStack Query

**是什么**：TanStack Query 是"服务端数据层"——它把服务端数据（列表、详情）从组件状态里剥离出来，统一做缓存、失效、重试、乐观更新、分页。你只声明"怎么取"，它管"什么时候取、取回来存哪、过期怎么办"。

**为什么需要**：阶段 6 你在 `useState`/`useEffect` 里手写请求，要自己管 loading/error/cache/竞态，容易漏。Query 把这套样板内置，且其缓存是**单一真相**（呼应 3.1 的"服务端数据永不手抄进 store"）。

**怎么用**（层级化 query key + 精准失效）：

```tsx
import {
  useQuery,
  useMutation,
  useQueryClient,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';

const queryClient = new QueryClient();

async function fetchCards(boardId: string): Promise<Card[]> {
  const res = await fetch(`/api/boards/${boardId}/cards`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`); // 404/500 才 reject
  return res.json();
}

export function CardList({ boardId }: { boardId: string }) {
  // 层级化 query key：便于精准失效
  const { data, isLoading, error } = useQuery({
    queryKey: ['boards', boardId, 'cards'],
    queryFn: () => fetchCards(boardId),
  });

  const qc = useQueryClient();
  const addCard = useMutation({
    mutationFn: (card: Card) =>
      fetch(`/api/boards/${boardId}/cards`, {
        method: 'POST',
        body: JSON.stringify(card),
      }).then((r) => r.json()),
    // 成功后只失效该看板的卡片缓存，不盲目全清
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boards', boardId, 'cards'] }),
  });

  if (isLoading) return <p>加载中…</p>;
  if (error) return <p role="alert">加载失败</p>;
  return <ul>{data?.map((c) => <li key={c.id}>{c.text}</li>)}</ul>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CardList boardId="b1" />
    </QueryClientProvider>
  );
}
```

无限滚动（配合 `IntersectionObserver` 触底加载下一页）：

```tsx
import { useInfiniteQuery } from '@tanstack/react-query';

function useArchived(pageSize = 20) {
  return useInfiniteQuery({
    queryKey: ['archives'],
    queryFn: ({ pageParam }) =>
      fetch(`/api/archives?cursor=${pageParam}`).then((r) => r.json()),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor ?? undefined, // 没有下一页返回 undefined
  });
}
// 触底时用 fetchNextPage() 追加页；queryFn 的 signal 来自 request，可取消
```

**坑在哪**：query key 设计扁平（如 `['cards']`）会导致失效"要么过度要么不到"——用层级数组 `['boards', id, 'cards']` 才能精准失效。缓存策略：`staleTime`（多久算新鲜）、`gcTime`（缓存保留时长）、`refetchOnWindowFocus`（窗口聚焦是否刷新）。切换页面时用 `signal` 取消上一个请求（呼应阶段 2 的 `AbortController`）。

### 3.6 Zustand 5 全面用法

**是什么**：Zustand 5 是一个极简的全局状态库，基于 `useSyncExternalStore`（阶段 7 详述其原理），要求 React 18+。它用 `create` 定义一个 store，组件用选择器订阅自己关心的切片，状态变化才重渲染。

**为什么需要**：阶段 6 的 Context + `useReducer` 在"高频变动的全局 UI 状态"场景下会让全树重渲染（Context value 一变，所有消费者重渲染）。Zustand 的**原子选择器**让每个组件只订阅自己需要的字段，避免无谓重渲染。

**怎么用**（create + 选择器 + `useShallow` + 中间件）：

```ts
import { create } from 'zustand'; // v5 必须具名导入，无默认导出
import { persist, devtools, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/react/shallow'; // v5 浅比较选择器

type Filter = 'all' | 'doing' | 'done';
type BoardState = {
  activeBoardId: string | null;
  filter: Filter;
  setActiveBoard: (id: string) => void;
  setFilter: (f: Filter) => void;
};

export const useBoardStore = create<BoardState>()(
  devtools(
    persist(
      immer((set) => ({
        activeBoardId: null,
        filter: 'all',
        setActiveBoard: (id) => set({ activeBoardId: id }),
        setFilter: (f) => set({ filter: f }),
      })),
      { name: 'board-ui', version: 1, migrate: (s) => s }, // 升级旧数据用 migrate
    ),
  ),
);

// 原子选择器：只订阅需要的字段，引用不变就不重渲染
const filter = useBoardStore((s) => s.filter);

// 返回对象必须用 useShallow，否则每次渲染新引用 → 无限重渲染
const { activeBoardId, setActiveBoard } = useBoardStore(
  useShallow((s) => ({ activeBoardId: s.activeBoardId, setActiveBoard: s.setActiveBoard })),
);

// store 之外访问（事件回调 / 定时器 / 测试）：直接读、改、订阅
useBoardStore.getState().setFilter('done');
useBoardStore.subscribe((s) => console.log('filter 变了', s.filter));
```

**从 Zustand 4 迁移到 5 的坑**（v4 教程里的写法在 v5 已失效）：

```ts
// ❌ v4 写法（已移除）
// import create from 'zustand';                 // 默认导出已移除
// useStore(selector, shallow);                  // 第二个 equalityFn 参数已移除
// createWithEqualityFn(...)                      // 移到 zustand/traditional

// ✅ v5 写法
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
// 需要旧语义（带 equalityFn 的 create）：从 zustand/traditional 引入
import { createWithEqualityFn } from 'zustand/traditional';
```

**坑在哪**：

- 选择器返回**新对象/新数组**（如 `s => ({a, b})`）每次都是新引用 → 无限重渲染，必须用 `useShallow` 或拆成原子选择器。
- 把服务端数据也塞进 Zustand → 双份真相，缓存不同步，交给 TanStack Query。
- `persist` 升级后旧数据不兼容会崩溃 → 必须写 `migrate` 函数。
- store 是纯 JS 对象，测试时直接 `getState()` 断言，无需渲染组件。

### 3.7 Context vs 外部 store 的取舍

**是什么**：Context 和 Zustand 这类外部 store 都能做"跨层传值"，但适用场景不同。Context 适合**低频、局部共享**的值（主题、当前用户）；外部 store 适合**高频变动、需选择器、要持久化**的全局状态。

**为什么需要**：Context 的痛点是——只要 Provider 的 value 引用变了，**所有**消费者组件都重渲染，哪怕它只用了 value 里没变的那一项。状态频繁变时，Context 会成为性能杀手。外部 store 的选择器机制只重渲染真正用到变化字段的组件。

**怎么用**：

```tsx
import { createContext, useContext } from 'react';

// 低频、局部共享 → Context 合适（值很少变，消费者少）
const ThemeContext = createContext<'light' | 'dark'>('light');
function useTheme() {
  return useContext(ThemeContext);
}

// 高频、跨页面、需 selector/持久化 → 用 Zustand 等外部 store
// 反例：把会频繁变的全局状态放 Context，任一消费者改值都让全树重渲染
```

**坑在哪**：别用 Context 存"会频繁变的全局状态"——那正是 Zustand 的活。两者的取舍本质是"有没有选择器 + 变动频率"。能用 props 透传就别用 Context，能用局部 state 就别用全局。

### 3.8 useSyncExternalStore 原理（呼应阶段 2 的 Proxy）

**是什么**：`useSyncExternalStore`（use-sync-external-store）是 React 订阅"外部可变数据源"的官方原语——Zustand、Redux 都基于它。它接收 `subscribe`（订阅函数）和 `getSnapshot`（读当前值），在数据源变化时让组件重渲染。

**为什么需要**：阶段 2 你用 `Proxy` 手写过 `reactive` + `effect` 的响应式系统：改属性自动触发副作用。React 组件不能直接"观察"外部对象，需要一个安全的桥。`useSyncExternalStore` 就是这个桥，且保证了并发下的"一致性读取"（避免撕裂）。

**怎么用**（极简外部 store，呼应阶段 2 的 Proxy 练习）：

```ts
import { useSyncExternalStore } from 'react';

// 极简外部 store——呼应阶段 2 用 Proxy 手写的响应式系统
let listeners: Array<() => void> = [];
let count = 0;

function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener); // 退订
  };
}

// getSnapshot 必须返回稳定引用：相等时 React 跳过重渲染
function getSnapshot() {
  return count;
}

function inc() {
  count += 1;
  listeners.forEach((l) => l()); // 通知所有订阅者
}

// 组件里：数据源一变就重渲染
function useExternalCount() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
```

> 阶段 2 的 `reactive` 用 `Proxy` 在 `get` 时收集依赖、`set` 时触发；`useSyncExternalStore` 是 React 版的"订阅-通知"，Zustand 内部就是 `createStore` + 这个 Hook。理解了阶段 2 的练习，这里就是同一套思想。

**坑在哪**：`getSnapshot` 必须返回**稳定引用**——每次调用都返回新对象（如 `getSnapshot: () => ({count})`）会让 React 认为"一直在变"而无限重渲染，引用相等是关键。

### 3.9 性能优化实战

**是什么**：性能优化（performance optimization）在前端指减少不必要的重渲染、缩小 bundle、消掉请求瀑布。常用手段：`memo` 包纯展示组件、虚拟列表、`React Compiler 1.0` 自动记忆化、DevTools Profiler 定位热点、bundle 拆分。

**为什么需要**：看板列有上千卡片时，父组件一变就全量重渲染会卡。但"性能优化"最忌过早——先上 Profiler 找到真热点，再动手。React Compiler 1.0 开启后，大量手动记忆化反而是负担。

**怎么用**（`memo` + 虚拟列表思路）：

```tsx
import { memo } from 'react';

// 子组件用 memo 包：props 没变就跳过重渲染（Compiler 开启后多数可省略）
const Row = memo(function Row({ card }: { card: Card }) {
  return <li>{card.text}</li>;
});
// 巨额列表：只渲染可视区 + buffer（阶段 6 已练），或用 @tanstack/react-virtual
```

用 React DevTools Profiler 录制交互，开启 "Highlight updates" 高亮重渲染范围；或写 `useWhyDidYouRender` 诊断"为什么重渲染"。

**坑在哪**：Compiler 时代**不要**到处 `memo`/`useMemo`——包错依赖会更慢。先写正确、让编译器优化，profiler 证明热点再手动加。长列表用 `content-visibility: auto`（CSS）也能廉价提速。指标关注 LCP（最大内容绘制）/ INP（交互到下次绘制）/ CLS（累积布局偏移）。

### 3.10 错误边界与异常兜底

**是什么**：错误边界（error boundary）捕获渲染期错误；React Router 7 提供路由级 `errorElement` 兜底整页错误；组件级仍用阶段 6 的 `ErrorBoundary` 类组件。异步错误（loader/action）由路由的 `errorElement` 接住。

**为什么需要**：单页应用任何一处崩都不该白屏。路由级错误让"某个页面挂了"不影响其它页面，组件级错误限制崩溃范围到局部，配合 `aria-live` 把错误播报给读屏用户。

**怎么用**（路由级错误边界）：

```tsx
import { useRouteError } from 'react-router-dom';

// 在 router 配置的 errorElement 指向它；组件级仍用阶段 6 的 ErrorBoundary 类
function RouteError() {
  const error = useRouteError() as { status?: number; message?: string };
  return (
    <p role="alert">
      路由错误：{error.status ?? ''} {error.message}
    </p>
  );
}
// 也可在全局加 <ErrorBoundary> 包住 <RouterProvider>，双重兜底
```

**坑在哪**：错误边界抓不到**事件处理器**和**异步回调**里的错误——那些用 `try/catch`。loader/action 抛错会被路由 `errorElement` 接住，但组件内 `onClick` 里的 `fetch` 失败要自己 `catch`。

### 3.11 异步 UI 状态体系

**是什么**：异步 UI 状态体系指把"加载中 / 出错 / 空 / 部分失败"做成统一的可复用组件，而不是在每个页面各写一遍 `if (loading) ...`。

**为什么需要**：真实应用四类状态都要有：加载中给骨架屏、出错给重试、空给引导、部分失败（列表拿到但详情挂了）给降级。统一组件保证全站体验一致，且能被测试覆盖。

**怎么用**：

```tsx
import { type ReactNode } from 'react';

// 四类异步状态组件：加载 / 错误（含重试）/ 空（含引导）/ 部分失败
function AsyncState({
  status,
  onRetry,
  children,
}: {
  status: 'loading' | 'error' | 'empty' | 'ready';
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (status === 'loading') return <p>加载中…</p>;
  if (status === 'error') {
    return (
      <p role="alert">
        出错了 <button onClick={onRetry}>重试</button>
      </p>
    );
  }
  if (status === 'empty') return <p>暂无数据，去创建一个吧</p>;
  return <>{children}</>;
}
```

**坑在哪**：错误状态要带 `role="alert"` + `aria-live` 让读屏用户感知；重试按钮要防止重复点击（pending 时禁用，呼应阶段 6 的 `useFormStatus`/`useActionState`）。

### 3.12 复杂表单：react-hook-form + zod

**是什么**：react-hook-form（RHF）是非受控优先的表单库，用 `register` 注册字段、`useFieldArray` 管动态字段数组；zod 做 schema 校验，`zodResolver` 桥接，并用 `z.infer` 从 schema 推导出类型（呼应阶段 3 的类型体操）。

**为什么需要**：阶段 6 的受控表单字段多了会每个输入都重渲染、校验逻辑散落。RHF 非受控减少重渲染，`zod` 集中声明校验规则，复杂动态表单（标签增删、跨字段校验、异步唯一性）比手写清爽得多。

**怎么用**：

```tsx
import { useForm, useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

const schema = z.object({
  title: z.string().min(1, '必填').max(80, '太长'),
  tags: z.array(z.object({ label: z.string().min(1) })),
});
type FormValues = z.infer<typeof schema>; // 由 schema 推导出强类型（阶段 3 练过）

export function TaskForm() {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { tags: [] } });
  const { fields, append, remove } = useFieldArray({ control, name: 'tags' });

  function onSubmit(values: FormValues) {
    console.log(values); // 校验通过后拿到强类型 values
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('title')} aria-invalid={!!errors.title} />
      {errors.title && <p role="alert">{errors.title.message}</p>}
      {fields.map((f, i) => (
        <div key={f.id}>
          <input {...register(`tags.${i}.label` as const)} />
          <button type="button" onClick={() => remove(i)}>删</button>
        </div>
      ))}
      <button type="button" onClick={() => append({ label: '' })}>加标签</button>
      <button disabled={isSubmitting}>提交</button>
    </form>
  );
}
```

**坑在哪**：简单表单用 React 19 `useActionState` 更轻；复杂动态表单才上 RHF。`watch()` 放顶层会每次输入全表单重渲染——只 watch 局部字段。`z.infer` 的类型与运行时 schema 同源，改一处两处都更新。

### 3.13 多页面应用的目录与状态分层

**是什么**：多页面应用（multi-page app，指"路由划分的多个视图"）需要清晰的目录结构，把"路由装配 / 页面 / 业务特性 / 组件 / 逻辑 / 数据 / 状态 / 类型"分层，让状态归属一眼可见。

**为什么需要**：阶段 6 所有代码平铺，状态全在顶层。多页面后，store 切片、api 客户端、类型各自成目录，状态归属（3.1）才落得实。分层也是 Java 里"分层架构"在前端的对应物。

**怎么用**（推荐目录结构）：

```
src/
├── app/        # 路由配置与 provider 装配（Router、QueryClient、Store 的 Provider）
├── pages/      # 路由级页面（BoardList / BoardDetail / Settings）
├── features/   # 业务特性（boards / cards / filters，含该特性的组件与逻辑）
├── components/ # 纯展示组件（无业务状态）
├── hooks/      # 自定义 Hook（逻辑复用）
├── lib/        # 纯函数与 api 客户端（fetch 封装）
├── store/      # Zustand store 切片（boardSlice / uiSlice / filterSlice）
├── types/      # 全局类型（与服务端 DTO 对齐）
```

**坑在哪**：别把 api 客户端写进组件（放 `lib/`），别把本该在 store 的全局状态写进页面局部。目录分层的目的就是让"状态该放哪"有物理位置可对照——对照 3.1 的归属表逐层落地。

---

## 四、与 Java 经验的对照

| Java 经验 | 前端对应 | 注意差异 |
| --- | --- | --- |
| 领域服务 + 仓储层 | `lib/api` + TanStack Query（缓存即"仓储"） | Query 缓存是单一真相，别再手抄进 store |
| DTO / VO | zod schema + `z.infer` 类型 | schema 是运行时校验，类型由它推导（阶段 3） |
| 事务与一致性 | 乐观更新 + 失败回滚 | 前端无事务，靠 onError 回滚到上一状态 |
| 缓存（Redis） | Query 缓存（`staleTime` / `invalidate`） | 过期策略在前端显式配置，否则拿到旧数据 |
| 单例 Bean | 全局 store（单例）；多窗口/SSR 需 `createStore` + Context | store 是模块级单例，注意测试隔离 |
| AOP / 拦截器 | 中间件（`persist` / `devtools` / 自定义） | 中间件在状态读写时横切，类似切面 |
| 分层架构 | `pages / features / components / hooks / lib / store / types` | 物理分层让"状态归属"可对照 |
| 观察者模式（`Listener`） | `useSyncExternalStore` / Zustand 订阅 | 前端订阅在 React 调度里，靠引用相等判定变化 |
| 请求串行 / 线程池并行 | `loader` 里 `Promise.all` 并行取数 | JS 单线程，并行是并发编排不是多线程 |
| Servlet 过滤器链 | 路由 `action` → `loader` → `errorElement` | 取数/突变/兜底沿路由层级流动 |

---

## 五、实践练习

### 练习 1（必做）：Zustand 迁移（4 小时）

**目标**：把阶段 6 看板的 Context + `useReducer` 迁移到 Zustand 5。

**步骤**：
1. 拆分为 `boardSlice` / `uiSlice` / `filterSlice`
2. 接入 `persist`（带 `version` + `migrate` 迁移函数）、`devtools`、`immer`
3. 用 `useShallow` 修复"选择器返回新对象"导致的重渲染
4. 写 store 单元测试（不渲染组件，直接操作 `getState()`）

**验收点**：Profiler 中拖动一张卡片时，无关组件不重渲染。

### 练习 2（必做）：路由化改造（5 小时）

**目标**：把单页看板改成多页面。

**步骤**：
1. 改成多页面：看板列表 / 看板详情 / 设置 / 归档
2. 用 `loader` 预取数据、`action` 处理突变、`errorElement` 兜底
3. 筛选条件同步到 URL（`?status=doing&q=xxx`），刷新后保持
4. 路由级懒加载，验证 Network 里按路由加载 chunk

**验收点**：直接访问带 query 的 URL 能还原筛选状态；Network 按路由分包加载。

### 练习 3（必做）：服务端数据层（5 小时）

**目标**：接入 TanStack Query，统一服务端数据。

**步骤**：用 MSW（Mock Service Worker）模拟后端 API，接入 TanStack Query：
1. 设计 query key 层级，实现"新建卡片后只失效对应看板"
2. 无限滚动的归档列表
3. 请求取消（切换页面时 abort 上一个请求）
4. 错误重试 + 全局错误提示 + `aria-live`

**验收点**：Network 面板中无重复请求、无瀑布式串行请求。

### 练习 4（必做）：复杂表单（4 小时）

**目标**：吃透 RHF + zod 与 Actions 的取舍。

**步骤**："新建/编辑任务"表单：必填校验、日期范围校验、标签动态增删、附件（模拟）、异步校验（标题重复）、提交中禁用、错误定位与聚焦。用 RHF + zod 实现；再用 React 19 `useActionState` 实现一个简化版，写一份对比结论。

**验收点**：两个版本行为一致；对比结论说清各自适用场景。

### 练习 5（进阶）：状态架构评审（3 小时）

**目标**：建立"状态归属"的判断力。

**步骤**：对当前项目做一次"状态归属"评审，输出一张表：每个状态项 → 归属层 → 理由。把至少 3 个"放错地方"的状态纠正过来，并用 Profiler 证明改进。

**验收点**：输出评审表；至少 3 处纠正，且有 Profiler 对比数据。

### 练习 6（进阶）：性能专项（4 小时）

**目标**：真实性能问题的定位与优化。

**步骤**：
1. 用 Profiler 找出 3 处重渲染热点并修复
2. 分析 bundle，把首屏不需要的库拆出去，首屏 JS 体积下降 ≥ 20%
3. 优化 INP：把一次点击中的同步长任务拆分为 `startTransition` + 分片
4. 记录优化前后的 Lighthouse 与 INP 数据

**验收点**：首屏 JS 体积下降 ≥ 20%；INP 有明显改善并有数据佐证。

### 练习 7（挑战）：离线可用（3 小时）

**目标**：为阶段 9 的 Dexie 方案做铺垫。

**步骤**：在 Query 层加 `persistQueryClient`（localStorage），实现"断网后仍能查看上次数据 + 恢复网络后自动刷新"。

**验收点**：断网刷新页面仍能看到上次数据；恢复网络后自动重新拉取。

---

## 六、常见坑与自查清单

### 高频坑

- Zustand 选择器返回 `{ a, b }` 新对象 → 每次都变，必须 `useShallow`
- 把服务端数据也塞进 Zustand → 双份真相，缓存不同步
- Query key 设计扁平 → 无法精准失效，要么失效过度要么失效不到
- `persist` 升级后旧数据不兼容崩溃 → 必须写 `migrate`
- 路由 `loader` 里串行 await → 请求瀑布，用 `Promise.all`
- RHF 的 `watch()` 放顶层 → 每次输入全表单重渲染
- 用 `useEffect` 同步 URL 与筛选 → 用 `useSearchParams` 单一数据源
- 乐观更新失败不回滚 → 数据错乱
- 错误边界抓不到事件/异步错误 → 那些用 `try/catch`
- `getSnapshot` 返回新对象 → 无限重渲染（引用相等是关键）
- `<Activity>` 的 `hidden` 卸载了 effect → 依赖副作用的组件切回需重新挂载
- 过早 `memo`/`useMemo` → Compiler 时代反而是负担

### 自查清单

- [ ] 能为任意状态项判断它应该属于哪一层的状态
- [ ] 熟练使用 Zustand 5 的具名导入、`useShallow`、中间件与迁移
- [ ] 会设计层级化 query key，并做精准失效
- [ ] 路由具备 loader/action/errorElement/懒加载
- [ ] 有完整的加载/错误/空/部分失败四类 UI
- [ ] Profiler 能定位并修复重渲染
- [ ] 首屏 bundle 做过拆分优化并有数据佐证
- [ ] 能解释 `useSyncExternalStore` 原理（呼应阶段 2 的 Proxy 响应式）
- [ ] 能说出 Context 与外部 store 的取舍标准
- [ ] 用 `startTransition`/`useDeferredValue` 优化过输入卡顿

---

## 七、参考资料

- Zustand 官方文档（含 v4 → v5 迁移指南，2026-09 验证）
- TanStack Query 官方文档（Query Keys / Mutations / Optimistic Updates）
- React Router 7 官方文档（Data Router / Tutorial）
- react-hook-form + zod 官方文档
- MSW 官方文档
- react.dev：并发特性、`useSyncExternalStore`、`Suspense` 章节
- 验证时间：2026-09；版本以 React 19.2、Zustand 5、React Router 7、TypeScript 7、Vite 8 为准（与 `track.json` 的 `toolchain` 一致）
