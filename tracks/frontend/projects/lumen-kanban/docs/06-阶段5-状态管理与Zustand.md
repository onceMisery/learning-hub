# 06 · 阶段 5：状态管理与架构分层

## 学完你能做什么

- 拿到任何一个状态，能立刻判断它该放在哪一层
- 用 Zustand 5 管跨组件 UI 状态，并知道 v4→v5 的破坏性变更
- 避免"把数据库数据抄一份进 store"这个最致命的架构错误
- 用 `persist` 做选择性持久化，并理解为什么要 `partialize`

**前置**：阶段 4（数据层已就位）。

---

## 1. 状态分层：先判断归属，再选工具

| 状态类型 | 例子 | 归属 | 工具 |
| --- | --- | --- | --- |
| URL 状态 | 页码、筛选、选中项 | URL | `searchParams`（本项目暂未引入路由） |
| **服务端数据** | 用户列表、订单详情 | 服务端缓存 | TanStack Query（本项目**无服务端，故不用**） |
| **持久化业务数据** | 看板、列、卡片 | **数据库** | **Dexie + useLiveQuery** |
| 跨页面 UI 状态 | 当前看板、主题、侧栏开合 | 全局 store | **Zustand** |
| 组件局部状态 | 输入框内容、弹窗开关 | 组件内部 | `useState` |
| 表单状态 | 字段值、校验错误 | 表单库 | react-hook-form（本项目表单简单，未引入） |

**本项目只用了两层**：Dexie（业务数据）+ Zustand（UI 状态）。

> **最常见的架构错误**：把 Dexie 里的卡片数组再 `setState` 一份进 store。结果是两份真相，任何一处写入都要记得同步另一处，且内存翻倍。判断标准很简单：**这份数据刷新页面后还应该存在吗？** 是 → 数据库；否 → store 或组件。

---

## 2. 最小可运行示例：10 行的 store

`src/renderer/store/ui.ts`：

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      query: '',
      theme: 'system',
      setQuery: (query) => set({ query }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'lumen-ui',
      version: 1,
      partialize: (state) => ({ theme: state.theme }),   // 只持久化主题
    },
  ),
);
```

组件里用：

```tsx
const theme = useUiStore((state) => state.theme);        // 原子化选择器
```

**验证方式**：切到"暗" → 刷新页面 → 仍然是暗色；而搜索框内容刷新后清空（因为没被持久化）。

---

## 3. Zustand 5 的三个关键点

### 3.1 必须用具名导入

```ts
import { create } from 'zustand';        // ✅ v5
import create from 'zustand';            // ❌ v5 已移除默认导出
```

### 3.2 选择器返回新对象时，必须用 `useShallow`

```ts
// ❌ 每次渲染都返回新对象 → 引用永远不等 → 无限重渲染
const { query, setQuery } = useUiStore((s) => ({ query: s.query, setQuery: s.setQuery }));

// ✅ 浅比较
import { useShallow } from 'zustand/react/shallow';
const { query, setQuery } = useUiStore(
  useShallow((s) => ({ query: s.query, setQuery: s.setQuery })),
);

// ✅ 更简单：拆成多次原子化调用（本项目采用）
const query = useUiStore((s) => s.query);
const setQuery = useUiStore((s) => s.setQuery);
```

**为什么**：Zustand 5 基于 `useSyncExternalStore`，快照比较默认用 `Object.is`。返回新对象 = 每次都不等 = 死循环。

> v4 的写法 `useStore(selector, shallow)` 第二个参数在 **v5 已被移除**，改用 `useShallow` 包裹。`createWithEqualityFn` 移到了 `zustand/traditional`。

### 3.3 `persist` 要配 `partialize`

```ts
partialize: (state) => ({ activeBoardId: state.activeBoardId, theme: state.theme }),
```

**为什么**：search 词属于"一次性 UI 状态"，持久化它会导致用户下次打开时看到一个莫名其妙的过滤结果。默认全量持久化是懒人陷阱。

**还要配 `version` + `migrate`**：将来给 UI 状态加字段时，老用户的 localStorage 里没有该字段，需要迁移（与 Dexie 的 `upgrade` 同理）。

---

## 4. 方案取舍：为什么不用 Context 或 Redux

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| **Zustand** | 1KB；store 可在 React 外访问（`getState()`）；选择器粒度订阅；测试不用渲染组件 | 需要一点心智成本理解选择器 | ✅ 本项目选择 |
| Context + useReducer | 零依赖 | Provider 包裹；value 变化会重渲染整棵子树（除非拆分多个 Context 或 memo）；无法在 React 外访问 | 适合低频变更的主题/语言 |
| Redux Toolkit | 完善的 DevTools、中间件、规范化缓存 | 样板代码多；小项目过度设计 | 大型团队 / 强规范需求 |

**什么时候该从 Zustand 换到 Redux**：需要时间旅行调试、严格的状态变更审计、或者团队里有很多人同时改同一份状态需要强约束时。

---

## 5. 本项目没有引入的两样东西（以及什么时候该引入）

| 工具 | 本项目为什么不用 | 什么时候该用 |
| --- | --- | --- |
| **TanStack Query** | 没有服务端，数据真源在本地 IndexedDB，Query 管的"服务端缓存/失效/重试"全部不适用 | 接了真实后端 API 后，用它管所有远端数据，把 Zustand 收缩成纯 UI 状态 |
| **React Router** | 单窗口单页应用，看板切换用状态即可 | 需要多页面、深链（`myapp://board/123`）、前进/后退语义时 |

---

## 6. 本阶段踩坑速查

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| `Maximum update depth exceeded` | 选择器返回新对象 | 拆成原子选择器或用 `useShallow` |
| `create is not a function` | 用了默认导入 | 改 `import { create } from 'zustand'` |
| `useStore(selector, shallow)` 报错 | v5 移除了第二个参数 | 用 `useShallow` |
| 刷新后旧数据残留 | `persist` 没有版本号/迁移 | 配 `version` + `migrate` |
| 改了 store 组件不更新 | 在 store 外部直接改了对象 | 只能通过 `set` 更新（配合 immer 中间件可写"可变"语法） |
| React 外想读状态 | — | `useUiStore.getState()` / `.subscribe()` |
