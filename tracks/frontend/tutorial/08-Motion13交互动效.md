# 阶段 8：Motion 13 交互动效

| 项目 | 内容 |
| --- | --- |
| **周期** | 1.5 周（约 15 小时） |
| **前置** | 完成阶段 7（React 19 进阶 + Zustand 5 状态管理，看板应用已具备清晰的状态层）、阶段 1（CSS transition/transform 基础） |
| **本阶段技术栈** | **Motion**（原 Framer Motion）13.2（2026-09 验证）· React 19 |
| **产出物** | 为看板应用加一层"动效系统"：页面/列表/弹窗/拖拽动效 + 团队可复用的动效规范页 |

> ⚠️ **品牌与版本**：Framer Motion 已于 2024-11 更名为 **Motion**。新项目安装 `motion` 包并从 **`motion/react`** 导入；`framer-motion` 包名仍在同步发布（同版本号 13.2），Framer 平台内的代码组件仍从 `framer-motion` 导入，两者不要混用。当前 13.2.0（2026-09-02 验证）；13.0（2026-08-05）移除了对 `@emotion/is-prop-valid` 的可选依赖；13.1（2026-08-10）增强了 `Reorder`（多维、自动轴向识别、RTL）。`reducedMotion` 默认 `"never"`，涉及无障碍动效必须显式开启 `"user"`。

---

## 一、本阶段在学习路径中的位置

- **上承**：阶段 6 你已经用 React 19 把看板应用搭起来了，阶段 7 又用 Zustand 5 把状态分层管理清楚——"数据怎么流动"你已经理顺（见 [阶段 7：React 19 进阶与状态管理](./07-React19进阶与状态管理.md)）。但界面是"跳变"的：新增卡片瞬间出现，删除瞬间消失，拖拽是生硬的 DOM 重排。这份状态层就是你上一阶段的产出物。
- **本阶段**：给界面补上**动效（animation）**这一层。核心是建立"动效表达空间关系、指示状态变化、引导注意力"的心智模型，而不是堆炫技——你会学到 Motion 的声明式原语、弹簧/缓动选择、手势、布局动画、`AnimatePresence` 进出场，以及最容易被忽视的两件事：**无障碍动效**和**性能**。
- **下接**：阶段 9 用 [阶段 9：Dexie 4 本地数据持久化](./09-Dexie4本地数据持久化.md) 把这份看板的数据层从 `localStorage` 迁到 IndexedDB——动效是"表现"，持久化是"根基"，两者叠加才是一个能用的真实应用。

> 动效是锦上添花，但加错了地方比不加更糟。本阶段一半的篇幅在教你"什么时候不该加动画"。

---

## 二、学习目标（可验收）

1. 理解动效的**目的**：表达空间关系、指示状态变化、引导注意力——而不是"看起来炫"。
2. 掌握 Motion 的核心原语：`motion.*` 组件、`animate` / `initial` / `exit`、`transition`（spring vs tween）、`variants`、手势（`whileHover/whileTap/whileDrag/whileFocus`）、`drag`、`layout` / `layoutId`、`AnimatePresence`。
3. 掌握 `useMotionValue` / `useTransform` / `useSpring` / `useScroll` / `useVelocity` / `useAnimationFrame`，实现滚动驱动与指针驱动效果。
4. 会用 `AnimatePresence` 做进场/退场动画，理解 `mode="popLayout"` 与 `mode="wait"` 的差异。
5. 掌握**性能原则**：只动 `transform` / `opacity`、`will-change` 的正确用法、避免布局动画的抖动、批量动画。
6. 掌握**无障碍动效**：`reducedMotion` 配置（Motion 默认是 `"never"`，必须显式开启 `"user"`）、`useReducedMotion()`、`prefers-reduced-motion` 降级。
7. 能判断"哪些动效该用 CSS、哪些该用 Motion"，并建立团队级动效规范（时长/缓动/位移距离）。

---

## 三、核心概念详解

### 3.1 动效的价值：它到底在解决什么问题

**是什么**：动效（animation）是界面在**两种状态之间过渡**的视觉表现。它把"瞬间跳转"变成"连续变化"，让人脑能追踪"东西去哪了"。

**为什么需要**：人眼对"突然出现 / 突然消失"的物体会自动归类为"不相关"，而对"平滑移动"的物体会归为"同一个"。没有动效的界面，用户每次操作都在重新建立心智地图；动效则承担三种职责：
- **表达空间关系**：列表项被拖到别处，布局平滑让位，用户知道它"移动"了而非"删除又重建"。
- **指示状态变化**：按钮按下有缩放回弹，明确告诉用户"点到了"。
- **引导注意力**：新消息从顶部滑入，把视线引过去。

**怎么用**：不是每段都给代码，先给一条判断清单——一个动效至少满足下面一条才该加：
- 它在解释"什么变了 / 东西去哪了"？
- 它在给用户"操作已生效"的反馈？
- 它在把注意力引向关键变化？

```tsx
// 反例：纯装饰的无限旋转，既不解释状态也不引导注意力，只会让人烦躁
<motion.div
  animate={{ rotate: 360 }}
  transition={{ repeat: Infinity, duration: 2 }}
/>;

// 正例：加载态用旋转，但它是"有意义"的——表示"正在工作"
<motion.div
  animate={{ rotate: 360 }}
  transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
  aria-label="加载中"
/>;
```

**坑在哪**：**"动效越多越高级"是最大的误区**。WCAG 2.3.3 明确要求：交互触发的动效如果超过 5 秒必须能关闭；纯装饰的循环动效应默认关闭。先把"该不该加"想清楚，再想"怎么加"。下面这些场景**默认不加动画**：
- 高频刷新（股票 tick、实时日志）——抖得人眼晕。
- 大段文本重排——逐字滑动反而难读。
- 纯展示型图标——没有状态变化可表达。
- 用户已开启"减弱动效"——见 3.11，全部降级。

### 3.2 安装与导入：为什么是 `motion/react` 而不是 `framer-motion`

**是什么**：Motion 是 2024-11 从 **Framer Motion** 更名而来的动画库；React 绑定从 `motion/react` 导入，底层也支持 `motion/three`、`motion/vue` 等。

**为什么需要**：品牌更名带来一个现实问题——npm 上同时存在 `motion` 和 `framer-motion` 两个包，且**同版本号同步发布**（13.2 的 `motion` 与 13.2 的 `framer-motion` 功能一致）。新项目应装 `motion` 并从 `motion/react` 导入；只有 Framer 平台内的代码组件仍需 `framer-motion`。**两个包同时装进一个项目会造成两套实例、动画状态不互通**——这是最常见的环境坑。

```bash
# 新项目：装 motion，不要装 framer-motion
pnpm add motion

# 查看已装版本，确认只有其一
pnpm ls motion framer-motion
# motion      13.2.0
# framer-motion  （不应出现）
```

```tsx
// 正确：新项目从 motion/react 导入
import { motion, AnimatePresence } from 'motion/react';

// 错误：和上面混用 framer-motion，会得到两套互不相关的动画上下文
import { motion } from 'framer-motion';
```

**坑在哪**：
- 13.0（2026-08-05）移除了对 `@emotion/is-prop-valid` 的可选依赖。过去有些项目靠它来决定哪些 prop 透传给 DOM，移除后如果你自定义了 `motion` 组件且依赖这个行为，需要自己处理 prop 过滤，否则会有多余的 prop 落到 DOM 上产生 React 警告。
- 13.1（2026-08-10）增强了 `Reorder`（多维、自动轴向识别、RTL），升级时注意拖拽排序行为变化。
- 不要把两个包同时列进 `dependencies`，`pnpm ls` 看到 `framer-motion` 就卸载它。

### 3.3 声明式动画原语：initial / animate / exit / transition

**是什么**：Motion 把动画建模为"目标状态"而非"逐帧指令"。`initial` 是挂载（mount）时的起始态，`animate` 是常态目标态，`exit` 是卸载（unmount）时的终态，`transition` 描述补间方式。

**为什么需要**：jQuery 时代的 `$(el).animate({opacity:0})` 是命令式——你告诉引擎"每一步怎么动"。声明式只说"我想让它变成这样"，引擎负责补间。好处是动画与**状态**绑定：状态变了，动画自动推导，不用手动管理时间线。这与阶段 2 的状态驱动、阶段 6 的 `UI = f(state)` 一脉相承。

```tsx
import { motion } from 'motion/react';

function FadeInCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}                 // 挂载瞬间：透明 + 下移 12px
      animate={{ opacity: 1, y: 0 }}                  // 目标：完全显示 + 归位
      exit={{ opacity: 0, y: -8 }}                    // 卸载瞬间：上移淡出
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      看板卡片
    </motion.div>
  );
}
```

> 注意：`exit` 单独写在 `motion` 组件上**不会执行**，它必须被 `AnimatePresence` 包裹（见 3.7）。这是新手第一个卡点。

**坑在哪**：
- `exit` 不生效，八成是漏了 `AnimatePresence` 包裹。
- `initial` 在 SSR / 首屏可能闪烁——可用 `<MotionConfig initial={false}>` 跳过首帧动画（见 3.11）。
- `animate` 传入的值与上一次**完全相等**时不会重播；需要强制重播用 `key` 或 `animate` 控制。

### 3.4 弹簧与缓动：type: 'spring' vs 时长式 tween

**是什么**：`transition.type` 决定补间曲线。两种主力：`'spring'`（物理弹簧，带 `stiffness` 刚度 / `damping` 阻尼 / `mass` 质量）和 `'tween'`（时长 + `ease` 缓动函数）。

**为什么需要**：弹簧模拟真实物体的回弹，手感"自然"，适合位移、缩放、拖拽落位；时长式适合颜色、透明度这类没有"动量"的属性。Motion 的默认规则：**物理属性（`x/y/scale/rotate`）默认 spring，视觉属性（`opacity/color`）默认 tween**——所以不写 `transition` 也有合理手感。

```tsx
// 弹簧：调刚度与阻尼控制"弹不弹"
<motion.div
  animate={{ x: 100 }}
  transition={{ type: 'spring', stiffness: 320, damping: 30 }}
  // stiffness 越大越快到达目标；damping 越小越"晃"
/>

// 时长式：精确控制时长与缓动曲线
<motion.div
  animate={{ opacity: 1 }}
  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
  // ease 用 cubic-bezier 的 4 个控制点数组
/>
```

`spring` 的直觉调参（记下这组就够日常用）：
- `stiffness` 默认 100，`damping` 默认 10；想"稳重不晃"用 `stiffness: 300, damping: 30`。
- 想"果冻弹"用 `stiffness: 500, damping: 12`。

**坑在哪**：
- 弹簧没有固定 `duration`，`transition.duration` 对 spring 无效（除非用 `type: 'tween'`）。
- 想"弹簧但约 0.3 秒到"，用 `transition={{ type: 'spring', duration: 0.3, bounce: 0.25 }}`（Motion 支持用 `duration + bounce` 近似弹簧）。
- `mass` 越大越"重"、到达越慢，拖拽落位常调它增强"惯性感"。

### 3.5 手势：whileHover / whileTap / drag / dragConstraints

**是什么**：Motion 把常见手势抽象成 props：`whileHover`（悬停态）、`whileTap`（按下态）、`whileFocus`（聚焦态）、`whileInView`（进入视口）、`drag`（拖拽）与 `dragConstraints`（拖拽边界）。

**为什么需要**：在 jQuery 时代，悬停/按下要手写 `mouseenter/mouseleave/mousedown/mouseup` 再命令式改样式；现在把"手势 → 目标态"直接声明在组件上，且**手势态天然走动画管线**，不会闪。

```tsx
import { motion } from 'motion/react';

function Button() {
  return (
    <motion.button
      whileHover={{ scale: 1.04 }}        // 悬停轻微放大，引导"可点"
      whileTap={{ scale: 0.96 }}          // 按下回缩，即时反馈"点到了"
      whileFocus={{ outline: '2px solid #4f8cff' }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      提交
    </motion.button>
  );
}

function DraggableCard() {
  return (
    <motion.div
      drag                       // 开启拖拽
      dragConstraints={{ left: -200, right: 200, top: -100, bottom: 100 }}
      // 限制拖拽范围，拖到边界停下；若不想越界回弹可加 dragElastic={0.2}
      dragSnapToOrigin          // 松手回弹到原点
      whileDrag={{ scale: 1.1, zIndex: 10 }}
    >
      可拖拽卡片
    </motion.div>
  );
}
```

若要把拖拽约束到某个父容器内（更常见），用 `dragConstraints` 传一个 ref：

```tsx
import { motion } from 'motion/react';
import { useRef } from 'react';

function BoundedDrag() {
  const box = useRef<HTMLDivElement>(null);
  return (
    <div ref={box} style={{ width: 320, height: 320 }}>
      <motion.div drag dragConstraints={box} dragElastic={0.15}>
        只能在父框内拖
      </motion.div>
    </div>
  );
}
```

**坑在哪**：`drag` 默认会捕获指针并把元素变成"可拖"——如果元素内部还有可点击区域，记得用 `dragListener={false}` + 手动 `onPointerDown` 控制触发点，否则整块都变成拖动区，按钮点不动。另外 `whileInView` 需要进入视口才触发，配合 `viewport={{ once: true }}` 可让进场动画只播一次、不回滚重复播。

### 3.6 布局动画：layout / layoutId 共享元素过渡

**是什么**：`layout` 让元素在**尺寸或位置变化**时自动补间（而非瞬间跳变）；`layoutId` 让"同一逻辑元素"在**不同组件树位置间**做共享元素过渡（如列表卡片 → 详情页大图）。

**为什么需要**：阶段 6 你用 React 做列表重排时，DOM 是"先删旧的、再插新的"，视觉上是硬跳。给参与布局变化的元素加 `layout`，Motion 会测量前后位置差，用 `transform` 补间出"平滑让位"的效果——这正是看板拖拽排序需要的体验。

```tsx
import { motion } from 'motion/react';

// 列表重排：卡片位置变化时平滑让位
<motion.li layout transition={{ type: 'spring', stiffness: 500, damping: 40 }}>
  {item.title}
</motion.li>

// 共享元素：列表缩略图 → 详情大图，用同一个 layoutId 串联
function Thumb({ id }: { id: string }) {
  return <motion.img layoutId={id} src={`/t/${id}.jpg`} onClick={open} />;
}
function Detail({ id }: { id: string }) {
  return <motion.img layoutId={id} src={`/f/${id}.jpg`} />;  // 同一 layoutId → 跨组件变形
}
```

**坑在哪**：
- `layout` 走的是 `transform` 补间，但**测量**本身会读布局；不要同时动画 `padding/margin` 又加 `layout`，会抖动。
- 共享元素 `layoutId` 必须**同时只有一个**在视图里对应——两个相同 `layoutId` 的组件同时挂载会错乱。
- 父级也要加 `layout` 才能正确传导子项位置变化。
- 内容尺寸差异大的共享元素（缩略图 → 大图）建议加 `layoutId` + `borderRadius` 同步动画，避免圆角突变。

### 3.7 AnimatePresence：进出场与列表过渡

**是什么**：`AnimatePresence`（动画退场）是让被条件渲染卸载的 `motion` 子组件**先播完 `exit` 动画再真正移除**的容器。

**为什么需要**：React 卸载组件是瞬间的，`exit` 动画来不及播。没有它，删除列表项就是"啪"地消失。包一层 `AnimatePresence`，Motion 会拦截卸载、播完 `exit`、再移除——列表增删、弹窗开关都靠它。

```tsx
import { motion, AnimatePresence } from 'motion/react';

function CardList({ items }: { items: { id: string }[] }) {
  return (
    <ul>
      <AnimatePresence mode="popLayout">
        {items.map((it) => (
          <motion.li
            key={it.id}
            layout
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}        // 必须有 AnimatePresence 才会播
            transition={{ duration: 0.2 }}
          >
            {it.id}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
```

`mode` 三个取值的差异（重点）：
- `mode="sync"`（默认）：进出场同时进行，可能重叠。
- `mode="wait"`：等进场/退场之一播完再播另一个——适合弹窗（先淡出旧、再淡入新）。
- `mode="popLayout"`：退场元素**脱离文档流**，其余元素立刻用 `layout` 补间让位——**列表增删首选**，避免塌陷抖动。

**坑在哪**：
- 子组件**必须有稳定 `key`**，`AnimatePresence` 靠 key 识别"谁进谁出"；用数组下标当 key 会匹配错乱。
- 首屏不想播进场，用 `<AnimatePresence initial={false}>`。
- React 19 StrictMode 下 13.1.1 已修复双调用导致的退场异常，老版本需留意。
- 嵌套的 `AnimatePresence` 要分别传 `key` 命名空间，避免退场被外层提前移除。

### 3.8 Reorder：声明式拖拽排序列表

**是什么**：`Reorder` 是 Motion 内置的**拖拽排序**组件组（`Reorder.Group` + `Reorder.Item`），自动处理拖拽重排与动画。

**为什么需要**：手写拖拽排序要处理指针事件、计算落点、更新数组、重排动画、无障碍——几十行易错代码。`Reorder` 把它收敛成一个受控组件：你只管 `values` 和 `onReorder`。

```tsx
import { Reorder } from 'motion/react';

function SortableList({ items, setItems }: { items: string[]; setItems: (v: string[]) => void }) {
  return (
    <Reorder.Group axis="y" values={items} onReorder={setItems}>
      {items.map((value) => (
        <Reorder.Item key={value} value={value}>
          <motion.li layout>{value}</motion.li>
        </Reorder.Item>
      ))}
    </Reorder.Group>
  );
}
```

13.1（2026-08-10）增强：`axis` 支持**多维**（`axis="x"` / `"y"` / 不传则自由二维）、`auto` 轴向识别（根据拖拽方向自动选 x/y）、`layoutScroll` 配合滚动容器、RTL 文本方向正确。

```tsx
// 多维拖拽：不传 axis，元素可在平面内任意拖动排序
<Reorder.Group values={items} onReorder={setItems}>
  {items.map((v) => <Reorder.Item key={v} value={v}>{v}</Reorder.Item>)}
</Reorder.Group>;
```

**坑在哪**：`Reorder.Item` 的 `value` 必须是 `values` 数组里的**同一引用**（对象要同一对象，字符串要同一字符串），否则 `onReorder` 会算错顺序。和阶段 9 的 `useLiveQuery` 配合时，排序后务必写回数据库，否则刷新就还原。

### 3.9 滚动驱动动画：useScroll / useTransform

**是什么**：`useScroll`（滚动进度）读取容器或视口的滚动比例（`0~1` 的 `MotionValue`）；`useTransform`（变换）把它映射成位移/透明度/颜色等动画值。

**为什么需要**：滚动叙事（进度条、视差、吸顶、随滚动淡入）用原生 `scroll` 事件 + 手写插值既卡又啰嗦，且易触发强制同步布局（见阶段 2 的 3.10）。Motion 的滚动值走 `MotionValue`，**不触发 React 重渲染**，由浏览器合成层驱动，稳定 60fps。

```tsx
import { motion, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';

function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],     // 元素顶部进视口 → 底部出视口
  });
  // 滚动进度 0→1 映射成宽度 0%→100%
  const width = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);
  const opacity = useTransform(scrollYProgress, [0, 0.5, 1], [0, 1, 0]);

  return (
    <div ref={ref}>
      <motion.div style={{ width }} className="progress-bar" />
      <motion.h2 style={{ opacity }}>随滚动淡入的标题</motion.h2>
    </div>
  );
}
```

还可以用 `useScroll` 读全局滚动（`useScroll()` 不带 target），或用 `useVelocity(scrollY)` 检测滚动方向做"向下滚隐藏导航栏"：

```tsx
import { useScroll, useVelocity, useTransform, useSpring } from 'motion/react';

function HideOnScrollNav() {
  const { scrollY } = useScroll();
  const scrollVelocity = useVelocity(scrollY);
  const hide = useTransform(scrollVelocity, [-500, 0, 500], [1, 0, 0]); // 向下快滚→隐藏
  const y = useSpring(hide, { stiffness: 300, damping: 30 });
  return <motion.nav style={{ y }} />;
}
```

**坑在哪**：`useTransform` 返回的是 `MotionValue`，**必须**直接进 `style`（如 `style={{ width }}`），不能塞进普通 React `state` 再渲染——那样会每帧重渲染，性能雪崩。延迟读取用 `x.get()`，监听变化用 `x.on('change', cb)`（旧的 `value.onChange` 已废弃）。

### 3.10 变体与编排：variants / staggerChildren

**是什么**：`variants`（变体）是给动画状态起名字的对象；父子组件通过**同名变体**自动传播，配合 `staggerChildren`（错峰）/ `delayChildren`（延迟）做编排。

**为什么需要**：列表 20 项逐个淡入，若每项手写 `initial/animate` 要复制 20 遍且无法错峰。`variants` 让容器声明"子项按什么顺序进场"，子项只标注"我参与哪个变体名"。

```tsx
import { motion } from 'motion/react';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1 }, // 子项错峰 60ms
  },
};
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

function StaggerList({ data }: { data: string[] }) {
  return (
    <motion.ul variants={container} initial="hidden" animate="show">
      {data.map((d) => (
        <motion.li key={d} variants={item}>       {/* 名字与父一致即被编排 */}
          {d}
        </motion.li>
      ))}
    </motion.ul>
  );
}
```

**坑在哪**：父子变体名**必须一致**才传播（`container` 用 `'show'`，子项也要能解析到 `'show'`）。若子项用了 `initial/animate` 具体对象而非变体名，传播链就断了。手势态也能写成变体（`whileHover: 'hover'`），同样要名字对齐。

### 3.11 无障碍动效：reducedMotion="user"

**是什么**：`reducedMotion`（减弱动效）是 Motion 的全局开关，控制是否尊重系统的"减弱动效"偏好。`useReducedMotion()` 可在自定义动画里读这个偏好。系统级开关是 CSS 媒体查询 `prefers-reduced-motion`。

**为什么需要**：部分用户（前庭功能障碍、光敏等）对动画会不适甚至恶心。WCAG 要求尊重用户偏好。Motion 的 `reducedMotion` **默认是 `"never"`**——也就是说，你不显式设置，即使用户开了系统"减弱动效"，Motion 动画照样全开。这是合规性的硬伤，必须改。

```tsx
import { MotionConfig, motion, useReducedMotion } from 'motion/react';

// 全局开启：尊重用户系统设置（推荐放应用根）
<MotionConfig reducedMotion="user">
  <App />
</MotionConfig>;

// 自定义动画里手动分支
function Spinner() {
  const reduce = useReducedMotion();     // 用户开启减弱时为 true
  return (
    <motion.div
      animate={reduce ? {} : { rotate: 360 }}
      transition={{ repeat: Infinity, duration: 0.8 }}
    />
  );
}
```

`reducedMotion` 三个取值：
- `"never"`（默认，危险）：永不减弱。
- `"user"`（推荐）：跟随系统 `prefers-reduced-motion`。
- `"always"`：总是减弱（所有动画归零到终态）。

**坑在哪**：默认 `"never"` 是最大陷阱——很多团队上线后才发现前庭敏感用户被动画困扰。把它当成"状态码 200 才允许动画"一样对待：**默认开启 `"user"`**。`MotionConfig` 的 `initial={false}` 也常一起设，用来跳过首屏进场动画（避免 SSR 水合闪烁）。

### 3.12 性能：只动 transform / opacity，慎用 will-change

**是什么**：动画性能取决于它触发浏览器的哪一阶段。**合成层属性**（`transform` / `opacity` / `filter`）只走 GPU 合成，不重排不重绘；**布局属性**（`width/height/top/left/padding`）会触发 reflow，昂贵。

**为什么需要**：60fps 要求每帧 ≤ 16ms。动画 `top/left` 会让浏览器每帧重新计算布局 + 重绘，长列表直接掉到个位数 fps。只动 `transform`（位移用 `translate` 而非 `top`）和 `opacity`，动画永远在合成层跑。

```tsx
// 反例：动画 left → 每帧触发 layout，掉帧
<motion.div animate={{ left: 200 }} transition={{ duration: 0.3 }} />

// 正例：动画 x（= translateX）→ 只走合成层
<motion.div animate={{ x: 200 }} transition={{ duration: 0.3 }} />

// scale 代替 width 做"展开"效果
<motion.div animate={{ scaleY: 1 }} initial={{ scaleY: 0 }} style={{ transformOrigin: 'top' }} />
```

`will-change` 的代价：`will-change: transform` 会**提前把元素提层**，常驻占用显存。只在"真正要动且短时"的元素上加，动画结束应移除；别全局 `.card { will-change: transform }`，那等于把所有卡片常驻显存。

**坑在哪**：
- 需要"尺寸过渡"时优先 `layout`（见 3.6）或 `scale`，别动 `width/height`。
- 长列表动画限制同时动画的元素数；或用 CSS transition 替代 Motion（见 3.13）。
- 布局动画抖动：给父级加 `layout`，避免同时动画 `padding` 与 `layout`。
- 调试用 DevTools Performance 面板看 "Layout Shift / Layout" 行，理想为 0；Sources 面板的 "Rendering → Paint flashing" 能直观看到重绘区域。

### 3.13 与 CSS 动画 / 原生 WAAPI 的取舍

**是什么**：CSS `transition` / `@keyframes` 与 Web Animations API（WAAPI，`el.animate()`）是浏览器原生动画能力；Motion 是建立在它们之上的声明式封装。

**为什么需要**：不是所有动效都值得上 Motion。简单的一次性 hover、loading spinner、纯 CSS 能表达的状态过渡，**原生更轻**：零 JS 运行时、无包体积。Motion 的价值在"与 React 状态绑定、编排、手势、布局动画、退场"这些复杂场景。

```css
/* 纯 CSS 就够：hover 变色、简单淡入，无需 React 参与 */
.card { transition: background-color 0.2s ease; }
.card:hover { background-color: #f0f4ff; }
```

```tsx
// 用 WAAPI 做一次性命令式动画（不进 React 渲染树）
function pulse(el: HTMLElement) {
  el.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }],
    { duration: 300, easing: 'ease-in-out' },
  );
}
```

**判断准则**（团队规范页要固化下来）：
- 单一、静态、与状态无关的过渡 → CSS。
- 一次性命令式、不进组件树 → WAAPI（`el.animate`）。
- 与状态绑定、列表增删、手势、布局动画、共享元素、退场 → Motion。

**坑在哪**：别为了"统一"把一切塞进 Motion——简单 hover 用 Motion 反而增加重渲染风险与包体积。也别在 Motion 元素上叠 CSS `transition` 同一属性，两套补间会打架。若用体积优化，可换 `m` + `LazyMotion`：完整版约 34kb，`m` + `domAnimation` 可降到 ~4.6kb（练习 3 要实测对比）。

---

## 四、与 Java 经验的对照

| Java 经验 | 前端对应（Motion 13） | 注意差异 |
| --- | --- | --- |
| Swing `Timer` 逐帧改属性做动画 | 声明式 `initial/animate/exit`，引擎插值 | 你描述目标态，不写逐帧逻辑；弹簧用物理参数而非手算 |
| 事件监听 + 手动 `repaint()` | 手势 props（`whileHover` / `whileTap` 等） | 手势态天生走动画管线，不会闪；无需手动重绘 |
| 布局管理器重新布局 | `layout` / `layoutId` 自动补间 | 跨组件共享元素用 `layoutId`，同一时刻只能一个 |
| 后台线程跑动画避免卡 UI | `MotionValue` 走合成层，不占 JS 主线程 | JS 单线程，但合成层动画由 GPU 跑，不阻塞事件循环 |
| JavaFX `Timeline` / `KeyFrame` 编排 | `variants` + `staggerChildren` 编排 | 父子同名变体自动传播，无需逐帧时间轴 |
| CSS `transition`（无对应 Java） | WAAPI `el.animate()` / Motion | 原生只用 CSS；复杂绑定才上 Motion |
| `prefers-reduced-motion` 无对应 | `MotionConfig reducedMotion="user"` | 默认 `"never"`，必须显式开启，否则无视系统设置 |

---

## 五、实践练习

### 练习 1（必做）：动效词汇表（4 小时）

**目标**：用 Motion 实现 12 个基础效果，建立"每个动效何时用"的判断力。

**步骤**：
1. 为每个效果写一个 `MotionPreset` 组件，配 TS 类型。
2. 每个组件写注释："什么时候该用它 / 不该用它"。
3. 把 12 个放进一个 `/motion-lab` 页面，可逐个点击预览。

**清单**：淡入上移、缩放弹出、折叠展开（height auto）、Tab 指示器（layoutId）、卡片翻转、列表错峰入场、退场动画（popLayout）、拖拽卡片 + 回弹、滑动删除、图片点击放大到详情页（共享元素）、滚动进度条、滚动视差。

**验收点**：12 个都能跑；每个的注释说清了适用与禁忌场景。

### 练习 2（必做）：看板动效增强（5 小时）

**目标**：把阶段 6/7 的看板应用加上动效层。

**步骤**：
1. 卡片新增/删除：`AnimatePresence` + `layout`，重排时其他卡片平滑让位。
2. 拖动卡片：拖拽 + `layout` + 落位回弹。
3. 列切换 Tab：指示器 `layoutId`。
4. 搜索筛选：结果变化时的错峰动画（`staggerChildren`）。
5. 弹窗：遮罩淡入 + 内容缩放 + `mode="wait"`。
6. 空/加载状态：骨架屏 shimmer。

**验收点**：连续快速操作 20 次无动画错乱、无元素残留、无跳动。

### 练习 3（必做）：无障碍与性能（3 小时）

**目标**：把合规与性能变成默认动作。

**步骤**：
1. 全局 `MotionConfig reducedMotion="user"`，开启系统"减弱动效"后验证所有动画降级。
2. 用 DevTools Performance 录制一次卡片重排，确认无 Layout 抖动（Layout Shift 记录为 0）。
3. 对比 `motion.div` 与 `m` + `LazyMotion` 的包体积差异并记录。

**验收点**：开启系统减弱动效后界面仍可用且无不适动画；Performance 面板 Layout Shift = 0。

### 练习 4（进阶）：滚动叙事页（3 小时）

**目标**：掌握滚动驱动动画。

**步骤**：用 `useScroll` + `useTransform` 做滚动驱动的作品集区块：进度条、视差图层、元素随滚动淡入、吸顶标题。要求滚动时稳定 60fps。

**验收点**：滚动时稳定 60fps；`MotionValue` 直接进 `style`，无每帧重渲染。

### 练习 5（挑战）：动效规范页（3 小时）

**目标**：把动效"令牌化"，形成团队可复用系统。

**步骤**：做 `/motion-guide` 页面，把所有动效令牌化（时长、缓动曲线、位移距离），支持在线调节并导出为一份 `motion-tokens.ts`。这就是团队可复用的动效系统雏形。

**验收点**：导出文件被看板应用实际引用；改令牌后动效统一变化。

---

## 六、常见坑与自查清单

### 高频坑

- 包/导入路径混用：`motion` 与 `framer-motion` 同时装 → 选一个，新项目用 `motion` + `motion/react`。
- 忘了 `AnimatePresence` 导致 `exit` 动画不执行。
- 条件渲染 `{isOpen && <motion.div/>}` 而没有 `AnimatePresence` → 直接消失。
- 动画 `width/height` → 掉帧，用 `scale` 或 `layout`。
- `useTransform` 返回的值直接进 `style` 却用了普通 state → 性能差，必须用 `MotionValue`。
- 选择器返回的 `variants` 名字在父子间不一致 → 传播失效。
- `reducedMotion` 默认 `"never"` → 忘了设置会让前庭敏感用户不适。
- 旧的 `value.onChange(cb)` 已改为 `value.on("change", cb)`。
- `Reorder.Item` 的 `value` 不是 `values` 同一引用 → 排序算错。
- 共享元素 `layoutId` 同时两个挂载 → 变形错乱。
- 滥用 `will-change` 常驻显存 → 只在短时动的元素上加。

### 自查清单

- [ ] 熟练使用 `motion/react` 导入，能说清与 `framer-motion` 的关系（2024-11 更名背景、13.0/13.1 变更）。
- [ ] 能独立实现列表重排（`layout`）、共享元素（`layoutId`）、退场（`AnimatePresence`，含 `mode` 差异）。
- [ ] 会用 `useMotionValue` / `useTransform` / `useScroll` 做滚动驱动动画，且 `MotionValue` 直接进 `style`。
- [ ] 全局配置了 `reducedMotion="user"` 并验证过降级。
- [ ] 能用 Performance 面板证明动画不掉帧、无布局抖动。
- [ ] 有一份可复用的动效令牌/规范（时长/缓动/位移距离）。
- [ ] 能判断"该用 CSS / WAAPI 还是 Motion"。

---

## 七、参考资料

- Motion 官方文档（React 章节）：[motion.dev](https://motion.dev)，含 450+ 官方示例（2026-09 验证）
- Motion Changelog：13.0 / 13.1 / 13.2 条目（13.2.0 于 2026-09-02 发布，13.0 移除 `@emotion/is-prop-valid`，13.1 增强 `Reorder`）
- Motion 官方杂志文章：何时该用 CSS 而不是 Motion
- 无障碍：WCAG 2.3.3 Animation from Interactions、`prefers-reduced-motion` 媒体查询
- 性能：MDN [CSS transform](https://developer.mozilla.org/docs/Web/CSS/transform) 与 [will-change](https://developer.mozilla.org/docs/Web/CSS/will-change)
