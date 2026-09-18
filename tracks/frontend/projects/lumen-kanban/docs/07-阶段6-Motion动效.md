# 07 · 阶段 6：Motion 动效

## 学完你能做什么

- 用 Motion 13 做出"有反馈感"的交互：卡片进出场、拖拽重排、弹窗过渡
- 判断哪些动画该写 CSS、哪些该用 Motion，以及哪些根本不该做
- 让动画不引起布局抖动、不拖慢性能、不冒犯前庭敏感用户

**前置**：阶段 3（React 组件）。

---

## 1. 安装与导入（品牌已更名）

```bash
npm i motion@13.2.0
```

```tsx
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
```

> **注意**：Framer Motion 已于 2024-11 更名为 **Motion**。`framer-motion` 包名仍在同步发布（同版本号），但新项目请用 `motion` 并从 `motion/react` 导入。**不要两个包混装**。

---

## 2. 最小可运行示例：卡片进出场

本项目 `src/renderer/features/board/CardItem.tsx`（精简版）：

```tsx
<motion.li
  layout                                              // 位置变化时自动补间（重排平滑）
  initial={{ opacity: 0, y: 8 }}                      // 入场起点
  animate={{ opacity: 1, y: 0 }}                      // 常态
  exit={{ opacity: 0, scale: 0.96 }}                  // 退场（必须配合 AnimatePresence）
  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
>
  {/* 卡片内容 */}
</motion.li>
```

外层必须有 `AnimatePresence`（`ColumnView.tsx`）：

```tsx
<AnimatePresence initial={false}>
  {visible.map((card) => <CardItem key={card.id} … />)}
</AnimatePresence>
```

`initial={false}` 表示**首屏不做入场动画**（否则一进页面 20 张卡片一起飞进来，很吵）。

**验证方式**：`npm run dev` → 新增一张卡片，它从下方 8px 淡入；删除时缩小淡出；拖动排序时其他卡片平滑让位（`layout` 的功劳）。

---

## 3. 关键概念与"为什么"

### 3.1 物理属性 vs 视觉属性

- 物理属性（`x/y/scale/rotate`）默认走 **spring**，能自然响应打断
- 视觉属性（`opacity/color`）默认走 **tween**（补间）

所以你写 `animate={{ x: 100 }}` 不需要指定 `type`，它默认就是弹簧。

### 3.2 `layout` 是重排动画的核心

`layout` 让 Motion 在 DOM 位置变化后自动做 FLIP 补间（先测量、再变换）。没有它，列表重排是"瞬移"。

**代价与边界**：`layout` 会做测量，大量元素同时开启动画会掉帧。**几百个元素以内没问题；虚拟滚动的长列表要关掉。**

### 3.3 `AnimatePresence` 的 mode

| mode | 行为 | 适用 |
| --- | --- | --- |
| `sync`（默认） | 进出同时进行 | 一般场景 |
| `wait` | 先等旧的退场完，再入场 | 页面切换、弹窗替换 |
| `popLayout` | 退场元素脱离文档流，其余元素立即补位 | **列表删除**（避免塌陷抖动） |

本项目列表删除推荐 `popLayout`（当前用默认 `sync`，卡片数量少时差异不明显；改成 `popLayout` 只需加一个属性）。

### 3.4 无障碍：`reducedMotion` 默认是 `"never"`

```tsx
<MotionConfig reducedMotion="user">
  <App />
</MotionConfig>
```

**这一行必须显式写**。Motion 默认不理会系统的"减弱动效"偏好，对前庭敏感的用户不友好。设为 `"user"` 后，开启系统减弱动效时动画会自动降级为瞬时。

另外本项目在 Tailwind 类名里也加了 `motion-reduce:transition-none`，双保险。

---

## 4. 性能原则

| 做 | 不做 |
| --- | --- |
| 动 `transform` / `opacity` / `filter`（走合成层，不触发布局） | 动 `width` / `height` / `top` / `left`（每帧触发布局，掉帧） |
| 需要尺寸过渡时用 `layout` 或 `scale` | 给几十个元素同时开 `layout` |
| 高频动画用 MotionValue（不触发 React 重渲染） | 用 `useState` 存动画中的数值 |

MotionValue 示例（滚动进度条）：

```tsx
const { scrollYProgress } = useScroll();
const width = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);
return <motion.div style={{ width }} />;
```

**为什么快**：MotionValue 的变化直接写 DOM style，**不经过 React 渲染**。如果用 `useState` + `onScroll`，每次滚动都会触发整个组件树重渲染。

---

## 5. 什么时候该用 CSS 而不是 Motion

| 场景 | 选择 | 原因 |
| --- | --- | --- |
| hover 变色、简单淡入 | **CSS / Tailwind** | 零 JS，性能最好 |
| 元素**卸载**时的退场动画 | **Motion** | CSS 做不到（元素已经没了） |
| 列表重排补位 | **Motion `layout`** | CSS 做不了 FLIP |
| 可打断的弹簧、手势拖拽 | **Motion** | 需要物理计算 |
| 页面级转场 | 两者皆可，优先 CSS `@starting-style` / View Transitions | 更简单 |

一句话：**CSS 能干净解决的就用 CSS，Motion 用来补 CSS 补不了的部分（卸载、重排、手势、弹簧）。**

---

## 6. 本阶段踩坑速查（含本项目真实踩到的）

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| **`Type '(event: DragEvent)' is not assignable to '(event: MouseEvent…, info: PanInfo)'`** | Motion 组件自带 `onDragStart/onDragOver/onDrop`（它自己拖拽手势的回调），与 React 原生拖放事件**签名冲突** | 把原生拖放事件挂在内层普通元素上，让 `motion.li` 只负责动画（本项目 `CardItem.tsx` 的做法） |
| 退场动画不执行 | 没有 `AnimatePresence` 包裹 | 加包裹，且子元素 `key` 必须稳定 |
| 元素删了但占位还在 | 退场期间元素仍在文档流 | `AnimatePresence mode="popLayout"` |
| 动画卡顿 | 动的是布局属性 | 改 `transform` / `opacity` |
| 包体积变大 | 引入了完整 `motion` | 用 `m` + `LazyMotion` 可降到约 4.6KB |
| 系统开了减弱动效但动画照跑 | 没设 `reducedMotion` | `<MotionConfig reducedMotion="user">` |
| `value.onChange(cb)` 报警告 | 旧 API | 改 `value.on('change', cb)` |
