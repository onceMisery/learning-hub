# 04 · 阶段 3：React 组件与交互

## 学完你能做什么

- 用"状态驱动"的方式写界面（而不是 jQuery 式的"选中元素 → 改元素"）
- 拆出可复用的组件与自定义 Hook，避免一个 800 行的巨型组件
- 避开 React 最高频的 6 个坑（依赖数组、`key`、StrictMode 双调用、派生状态、事件竞态、滥用 `useMemo`）
- 为组件写测试，让重构有安全网

**前置**：阶段 1（会写样式）、阶段 2（会建类型）。

---

## 1. 心智模型：UI = f(state)

```tsx
// jQuery 思维（本项目里不该出现）
document.querySelector('#count')!.textContent = String(count + 1);

// React 思维
const [count, setCount] = useState(0);
return <span>{count}</span>;
```

一句话：**你永远不碰 DOM，你只改 state，React 负责把 UI 变成 state 该有的样子。**

这带来一条铁律：**state 是唯一数据源**。一旦你在 state 之外还保存了一份"当前列表"，两份数据迟早会不一致 —— 本项目用 `useLiveQuery` 订阅数据库，就是为了消灭这份副本（见阶段 4）。

---

## 2. 最小可运行示例：可增删的列表

新建任意组件文件，或直接看本项目的 `src/renderer/features/board/ColumnView.tsx`。核心只有三块：

```tsx
function Demo() {
  const [items, setItems] = useState<string[]>([]);   // 1. 状态
  const [text, setText] = useState('');

  const add = () => {                                  // 2. 事件里改状态
    if (!text.trim()) return;
    setItems((prev) => [...prev, text.trim()]);        //    必须新建数组，不能 push
    setText('');
  };

  return (
    <>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <button onClick={add}>添加</button>
      <ul>
        {items.map((item, index) => (
          <li key={item + index}>{item}</li>           {/* 3. key */}
        ))}
      </ul>
    </>
  );
}
```

**验证方式**：`npm run dev` 后增删几项，React DevTools 的 Components 面板里能看到 state 变化。

> 上面的 `key` 用了 `item + index` 是**反面教材**（仅为让示例能跑）。正确做法见 3.2。

---

## 3. 六个高频坑（本项目里都处理过）

### 3.1 依赖数组撒谎

```tsx
useEffect(() => {
  const timer = setTimeout(() => showNotification(theme), 1000);
  return () => clearTimeout(timer);
}, [theme]);   // theme 一变就重建定时器，其实没必要
```

React 19 的解法是用 `useEffectEvent` 把"事件"从 effect 里剥离：

```tsx
const onTick = useEffectEvent(() => showNotification(theme));
useEffect(() => {
  const timer = setTimeout(onTick, 1000);
  return () => clearTimeout(timer);
}, []);       // 依赖干净了
```

> **不要用 `// eslint-disable-next-line react-hooks/exhaustive-deps` 掩盖问题**，那等于关掉火警警报。

### 3.2 用 index 当 key

```tsx
{items.map((item, i) => <li key={i}>…</li>)}   // ❌ 插入/排序后状态错乱
{items.map((item) => <li key={item.id}>…</li>)} // ✅
```

本项目所有列表都用 `card.id`（UUID）。原因：key 是 React 判断"这是同一个元素吗"的依据，用 index 会导致插入头部时 React 以为只是内容变了，输入框内容、动画状态会串位。

### 3.3 StrictMode 双调用不是 bug

开发环境里 `useEffect` 会执行两次。这是 React 故意的：暴露不纯的副作用。本项目 `App.tsx` 里的初始化用了 `cancelled` 标记：

```tsx
useEffect(() => {
  let cancelled = false;
  void ensureSeed().then((id) => { if (!cancelled) setBoardId(id); });
  return () => { cancelled = true; };
}, []);
```

**正确的修复是让副作用可重入，而不是关掉 StrictMode。**

### 3.4 把派生数据存进 state

```tsx
const [filtered, setFiltered] = useState([]);
useEffect(() => { setFiltered(cards.filter(...)); }, [cards]);  // ❌ 多一次渲染 + 可能不同步
const filtered = useMemo(() => cards.filter(...), [cards]);     // ✅ 直接算
```

本项目 `BoardView.tsx` 就是 `useMemo` 直接算。

### 3.5 事件竞态

用户输入"abc"：请求 a(b) → a(bc) → a(bcd)，返回顺序无法保证，可能用旧结果覆盖新结果。
本项目规避方式是**根本不在渲染层发请求**（数据在 Dexie 里，是同步可见的）；真要发请求时用 `AbortController`：

```tsx
useEffect(() => {
  const controller = new AbortController();
  void fetch(url, { signal: controller.signal }).then(/* … */).catch(() => {});
  return () => controller.abort();
}, [url]);
```

### 3.6 到处包 `useMemo` / `useCallback`

React Compiler 1.0 已稳定，构建期自动做记忆化，`useMemo` 的定位变成了**逃生舱**（真的测出性能问题才用）。本项目只在 `BoardView` 里用了一次 `useMemo`（过滤几千条卡片，属于真实开销）。

---

## 4. 组件怎么拆（本项目的分层）

```
App.tsx                    装配：主题、初始化、弹窗
└─ TitleBar               纯展示 + 调 api
└─ Toolbar                表单 + 调 api / db
└─ BoardView              取数据（useLiveQuery）+ 过滤
   └─ ColumnView          取本列数据 + 新增卡片
      └─ CardItem         单卡片展示 + 拖放
CardDialog                编辑弹窗
components/ui/Button      无业务通用组件
lib/cn、lib/id、lib/search 纯函数
```

**规则**：

- `components/ui/` 里的组件**不认识业务**（Button 不知道什么叫"卡片"）
- `features/board/` 里的组件认识业务，但**不认识其他 feature**
- 有状态逻辑要复用就抽自定义 Hook（本项目 `hooks/useTheme.ts`），不要抽 HOC

---

## 5. 组件测试（可复制）

`tests/ui.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/Button';

it('外部 className 能覆盖默认尺寸', () => {
  render(<Button className="px-8">保存</Button>);
  const button = screen.getByRole('button', { name: '保存' });
  expect(button.className).toContain('px-8');
  expect(button.className).not.toContain('px-3');   // tailwind-merge 移除了冲突项
});
```

```bash
npm test
```

**预期输出**（实测）：

```
 ✓ tests/operations.test.ts (6 tests) 47ms
 ✓ tests/ui.test.tsx (3 tests) 386ms

 Test Files  2 passed (2)
      Tests  18 passed (18)（含本阶段的 ui 测试 3 项）
```

**为什么测行为不测实现**：断言"用户能看到什么 / 能点到什么"，重构内部实现时测试不会碎；断言内部 state 则相反。

---

## 6. 本阶段踩坑速查

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| 改了 state 页面没变 | 直接修改了原数组/对象 | `setItems([...items, x])` 新建引用 |
| 输入框打字卡 | 大表单受控 + 每次全量重渲染 | 拆分组件 / `useDeferredValue` / 换非受控 |
| effect 执行两次 | StrictMode（正常现象） | 让副作用可重入；不要关 StrictMode |
| 弹窗关不掉 / 事件重复触发 | 监听器没清理 | effect 返回清理函数；IPC 订阅 return 取消函数 |
| 列表插入后内容串位 | 用 index 当 key | 用稳定 id |
| `Cannot update a component while rendering` | 渲染期间调了 setState | 移到 effect 或事件里 |
