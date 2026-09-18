# 阶段 5：Tailwind CSS 4 与样式系统

| 项目 | 内容 |
| --- | --- |
| **周期** | 1.5 周（约 15 小时） |
| **前置** | 完成阶段 1（CSS 基础扎实）与阶段 4（Vite 就绪） |
| **本阶段技术栈** | Tailwind CSS 4.3 + `@tailwindcss/vite` |
| **产出物** | 一套可复用的**设计令牌体系** + 15 个以上常用组件的样式实现 + 主题切换能力 |

> ⚠️ **版本提示**：Tailwind v4 是**配置范式的根本改变**——从 JS 配置文件（v3 的 `tailwind.config.js`）转向 **CSS-first 配置**（`@theme` / `@utility` / `@custom-variant`）。网上大量 v3 教程已经过时，请**只参考 v4 官方文档**。当前最新为 **4.3**（2026-05-08，新增滚动条样式、`zoom`、`tab-size` 等，并强化了 `@variant`），4.2 起还提供了 `@tailwindcss/webpack`。

---

## 一、本阶段在学习路径中的位置

- **上承**：阶段 4 你已经用 Vite 8 把工具链标准化，跑起了 `dev` / `build`，也理解了 `dist/` 产物。阶段 1 你还手写过原生 CSS（盒模型、Flex / Grid、变量、`@media`）。但原生 CSS 写组件时，样式散落在 `.css` 文件、与结构分离，复用靠"复制粘贴 class"或"全局 class 污染"。
- **本阶段**：建立 **utility-first（原子化优先）** 心智模型——把样式拆成一组**单一职责的原子类**（如 `flex`、`p-4`、`text-sm`），直接在标记里组合。你会用 CSS-first 配置把品牌色、间距、字号做成**设计令牌（design token）**，并通过 `@theme` 自动生成对应工具类。
- **下接**：阶段 6 的 [React 19](./06-React19核心.md) 会把"一堆类名"封装成 `<Button variant="primary">` 组件。本阶段打好的令牌体系与组件样式库，会直接被 React 组件复用——你到时候只写语义 props，不再拼类名。

> utility-first 不是"HTML 里堆 class"这么简单。真正的价值是：**设计令牌约束 + 组件抽象边界**，否则就会退化成"用 Tailwind 写行内样式"。

---

## 二、学习目标（可验收）

学完本阶段，你应该能够：

1. 能用 `@tailwindcss/vite` 完成零配置接入，并解释 v4 与 v3 在配置方式、引擎（Oxide）、性能上的差异。
2. 掌握 **utility-first 思维**：能不看文档写出常见布局、间距、排版、颜色、状态变体的类名组合。
3. 能用 `@theme` 建立**语义化设计令牌**（颜色 / 间距 / 字号 / 圆角），实现多主题（亮 / 暗 / 品牌）切换，且组件里不出现魔法值（magic number）。
4. 会用 `@utility` 定义自定义工具类、用 `@custom-variant` 定义自定义变体（含暗色模式策略）。
5. 掌握**抽象与复用**的三种手段，并知道各自的适用边界：组件抽取（React）、`@apply`（谨慎）、CSS 变量 + 工具类组合。
6. 能处理动态类名、条件类名、类名冲突（`tailwind-merge`）、类名排序（`prettier-plugin-tailwindcss`）。
7. 理解 utility-first 的**代价**：HTML 冗长、可读性、与设计师协作方式的变化，并知道规避办法。

---

## 三、核心概念详解

### 3.1 @tailwindcss/vite 接入与 CSS-first 配置范式

**是什么**：`@tailwindcss/vite` 是 Tailwind 官方的 Vite 插件（Vite 插件 / Vite plugin 即扩展 Vite 构建流程的模块），让 Tailwind 在**构建期扫描源码、生成对应 CSS**，无需独立的 PostCSS 配置。v4 的核心理念是 **CSS-first 配置**：所有配置写在 CSS 里，不再依赖 `tailwind.config.js`。

**为什么需要**：v3 的配置是"JS 文件里写主题 → 再让构建工具读取"，配置和样式被割裂在两种语言里，且每次改主题都要在 JS 与 CSS 之间来回跳。v4 把配置直接放进 CSS，编辑主题就是编辑样式，并利用 Rust 写的引擎 **Oxide**，扫描与生成速度比 v3 快一个量级。

**怎么用**：三步接入——装包、挂插件、在入口 CSS 写一行 `@import`：

```bash
# 安装 Tailwind 4 与官方 Vite 插件（阶段 4 的 pnpm 环境）
pnpm add -D tailwindcss @tailwindcss/vite
```

```ts
// vite.config.ts —— 挂上插件（与 react() 并列）
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

```css
/* src/index.css —— 只需一行，替代 v3 的 @tailwind base/components/utilities 三件套 */
@import "tailwindcss";
```

**坑在哪**：① v3 的 `@tailwind base;` / `components;` / `utilities;` 指令在 v4 **已废弃**，照抄会报错；v4 一行 `@import "tailwindcss"` 全包含。② v3 的 `tailwind.config.js` **不再被自动识别**，若必须保留旧配置，用 `@config "./tailwind.config.js"` 显式引入——但新项目请直接走 CSS-first。③ 入口 CSS 必须被 `main.tsx` 真正 `import`，否则构建期扫不到、样式为空。

### 3.2 @theme：把设计令牌落到令牌体系

**是什么**：`@theme` 是 v4 的主题声明块。你在里面定义的 CSS 变量（**设计令牌**，design token）会被 Tailwind 自动"翻译"成对应的工具类。例如声明 `--color-brand-500`，就自动获得 `bg-brand-500` / `text-brand-500` / `border-brand-500` 等。

**为什么需要**：阶段 1 你写过 `:root { --primary: #3b82f6 }`，但那只是个变量，用完还得手写 `.btn { background: var(--primary) }`。`@theme` 让**一个令牌自动派生出整套工具类**，设计师改色板只动一处，全站类名随之生效，组件里再也不出现 `#3b82f6` 这种魔法值。

**怎么用**：覆盖颜色 / 间距 / 字号 / 圆角四类最常定制的令牌：

```css
/* src/index.css */
@import "tailwindcss";

@theme {
  /* 颜色令牌：自动生成 bg-/text-/border-/ring- 等工具类 */
  --color-brand-500: oklch(0.62 0.19 255);
  --color-brand-600: oklch(0.55 0.19 255);
  --color-surface:   var(--color-slate-50);
  --color-danger:    var(--color-red-500);

  /* 字号令牌：自动生成 text- 工具类（text-display / text-body） */
  --font-size-display: 2.25rem;
  --font-size-body:    1rem;

  /* 间距令牌：自动生成 p-/m-/gap- 工具类（spacing-18 → p-18） */
  --spacing-18: 4.5rem;

  /* 圆角令牌：自动生成 rounded- 工具类（rounded-card → rounded-card） */
  --radius-card: 0.75rem;

  /* 缓动令牌：自动生成 ease- 工具类 */
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
}
```

用法：

```html
<button class="bg-brand-500 text-white rounded-card px-4 py-2 text-body hover:bg-brand-600">
  提交
</button>
```

推荐再做一层**语义令牌（semantic token）**，把"品牌主色"映射到"主要按钮背景"这种语义，组件只引用语义、不直接引用原始色板。这样换肤时改一层即可：

```css
@theme {
  /* 原始色板（primitive）：只描述颜色本身 */
  --color-blue-500: oklch(0.62 0.19 255);

  /* 语义令牌（semantic）：描述"它用在哪" */
  --color-btn-primary-bg:    var(--color-blue-500);
  --color-btn-primary-fg:    var(--color-white);
  --color-surface:           var(--color-slate-50);
  --color-text-muted:        var(--color-slate-500);
}
```

```html
<!-- 组件引用语义令牌，而非原始色——换肤只需改语义层 -->
<button class="bg-btn-primary-bg text-btn-primary-fg">提交</button>
<aside class="bg-surface text-text-muted">侧栏说明</aside>
```

**坑在哪**：① 令牌命名**决定了生成的类名**：`--color-brand-500` 生成 `bg-brand-500`，但 `--color-brand` 生成 `bg-brand`，二者不是同一套命名空间，别混。② 令牌值推荐用 `oklch()` / `oklab()` 等现代色彩函数，这样后续做暗色、做对比度调整更可控；用 hex 也行，但失去色彩空间的优势。③ `@theme` 默认**只在 `:root` 作用域生成**，若要按主题切换（亮 / 暗），请看 3.5 的 `@custom-variant` 与多层 `@theme`。

### 3.3 @utility 与 @custom-variant：自定义工具类与变体

**是什么**：`@utility` 让你声明**自定义工具类**（utility class），`@custom-variant` 让你声明**自定义变体**（variant，即"在某种条件下才生效"的前缀，如 `hover:` / `focus:` / `dark:`）。

**为什么需要**：Tailwind 自带几百个工具类，但总有覆盖不到的：一行 `tab-size: 4`、一个"仅在 `data-theme=dark` 时"的变体。v3 你得写插件或 `@apply` 到自定义 class；v4 用原生 CSS at-rule 就能扩展，零 JS。

**怎么用**：自定义工具类与变体：

```css
/* 自定义工具类：用法 tab-4 直接当原子类 */
@utility tab-4 {
  tab-size: 4;
}

/* 自定义变体：theme-dark:xxx 在 [data-theme="dark"] 作用域下生效 */
@custom-variant theme-dark (&:where([data-theme="dark"], [data-theme="dark"] *));

/* 暗色模式策略（推荐"class / data 属性"策略，而非默认的媒体查询） */
@custom-variant dark (&:where(.dark, .dark *));
```

```html
<pre class="tab-4 font-mono">function f() { return 1; }</pre>
<div class="dark:bg-slate-900 dark:text-white">暗色下变深底白字</div>
```

v4.3 **强化了 `@variant`**，支持更复杂的选择器组合，例如基于父级状态或任意属性：

```css
@custom-variant hocus (&:hover, &:focus);   /* 组合多个选择器 */
```

**坑在哪**：① `@utility` 里**不能**再写 `@apply` 引用不存在的类，且自定义工具类**不参与**主题的自动响应式，需要响应式就自己加 `@media`。② `@custom-variant` 的 `&` 代表"应用该变体的元素本身"，写错选择器层级会导致变体永远不匹配。③ 默认暗色是 `prefers-color-scheme`（跟随系统）；若你要"用户手动切换"的 class 策略，必须显式 `@custom-variant dark`，否则 `dark:` 只在系统暗色时生效。

### 3.4 核心工具类速查（必须形成肌肉记忆）

**是什么**：工具类（utility class）是 Tailwind 提供的、单一职责的原子样式。布局 / 间距 / 排版 / 颜色等高频场景都有对应类。

**为什么需要**：utility-first 的底线是"常见样式不查文档"。下面这些类每天都会用，必须形成肌肉记忆，否则你会反复打断思路去翻表。

**怎么用**：按场景分组速记（完整列表看官方文档）：

```html
<!-- 布局：容器 / 显示 / Flex / Grid -->
<div class="container mx-auto flex items-center justify-between gap-4">
  <nav class="grid grid-cols-3 gap-2">
    <span class="col-span-2"></span>
  </nav>
</div>

<!-- 尺寸与间距：4px 基准（p-4 = 1rem = 16px） -->
<section class="w-full max-w-screen-md h-screen p-4 m-2 mt-8 space-y-3">

<!-- 排版：字号/行高 合成 text-{size}，跟踪/行高/截断 -->
<p class="text-lg leading-relaxed tracking-tight font-semibold truncate line-clamp-2 text-balance">

<!-- 颜色：bg-/text-/border-/ring- + 透明度修饰符 /50 + 任意值 [#fff] -->
<span class="bg-brand-500/50 text-white border border-slate-200 [color:#1a1a1a] ring-2 ring-brand-500">

<!-- 边框与效果 -->
<article class="rounded-card shadow-md outline outline-2 outline-brand-500">

<!-- 交互态：hover/focus/disabled + group/peer -->
<button class="group hover:bg-brand-600 focus-visible:ring-2 disabled:opacity-50">
  <span class="group-hover:underline">悬停我才下划线</span>
</button>
<input class="peer border invalid:border-red-500" />
<p class="hidden peer-invalid:block text-red-500">格式不对</p>

<!-- 响应式（移动优先，断点 sm/md/lg/xl/2xl）与暗色 -->
<main class="grid-cols-1 md:grid-cols-3 dark:bg-slate-900">

<!-- 逻辑属性（v4.2+）：ms-/me-/ps-/pe- 随书写方向翻转，做国际化时比 ml-/mr- 更稳 -->
<article class="ps-4 me-2 border-s border-e-0">

<!-- 状态与功能变体：has-*/aria-*/data-* 让"父级或自身状态"直接驱动样式 -->
<label class="has-[:checked]:border-brand-500 aria-[current=true]:font-bold data-[open]:block">

<!-- 条件渲染类：print: 打印样式、supports-[...]: 特性检测 -->
<nav class="print:hidden supports-[display:grid]:grid">

<!-- v4.3 新增高频：滚动条 / zoom / tab-size -->
<div class="scrollbar-thin scrollbar-thumb-rounded hover:zoom-105 tab-size-4">
<!-- 无障碍降级：用户开启"减少动态效果"时自动关掉动画 -->
<button class="motion-reduce:animate-none motion-safe:transition">动效按钮</button>
```

**坑在哪**：① 间距刻度是 **4px 基准**（`p-1` = 0.25rem = 4px，`p-4` = 1rem），记错基准就会差出倍数。② 响应式是**移动优先**——`md:grid-cols-3` 表示"默认 1 列，`md` 断点及以上才 3 列"，别写成"只在 md 是 3 列"。③ `truncate` 要配合 `overflow-hidden` 的父级约束宽度才生效；`line-clamp-2` 是 v4 内建，无需插件。④ 任意值 `[color:#1a1a1a]` 能解燃眉之急，但**滥用说明令牌没建好**（见阶段目标 3）。

### 3.5 响应式、断点与暗色模式

**是什么**：**断点（breakpoint）** 是响应式布局的临界视口宽度（如 `sm` = 640px）。Tailwind 用移动优先的断点前缀让元素在不同视口套用不同类。`@custom-variant dark` 则控制暗色模式的触发条件。

**为什么需要**：同一套界面要在手机、平板、桌面都好看，必须按视口切换布局。暗色模式同理——不是"换 backgroundColor"这么简单，而是一整套颜色令牌的翻转，需要统一切换点。

**怎么用**：断点 + 容器查询（component-level 响应式）+ 暗色切换：

```css
/* src/index.css —— 暗色用 data 属性策略，由 <html data-theme="dark"> 控制 */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
```

```html
<!-- 移动优先：手机竖排，md 起横排，2xl 起三列 -->
<article class="flex flex-col gap-4 md:flex-row md:items-center 2xl:grid 2xl:grid-cols-3">

<!-- 容器查询：以"父容器宽度"而非视口为准（组件级响应式更稳） -->
<div class="@container">
  <div class="grid grid-cols-1 @md:grid-cols-2 @lg:grid-cols-3">...</div>
</div>

<!-- 暗色：仅当 data-theme=dark 时生效 -->
<button class="bg-white text-black dark:bg-slate-800 dark:text-white">切换主题</button>
```

主题切换脚本（用阶段 4 的 `import.meta.env` 思路同理，这里用 `localStorage` 记忆）：

```ts
// src/theme.ts
export function initTheme() {
  const saved = localStorage.getItem('theme');
  const theme = saved ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
}
```

**坑在哪**：① **媒体查询 vs 容器查询**选错粒度：页面级布局用断点（`md:`），组件级响应式（卡片在窄侧栏竖排、宽主区横排）必须用 `@container`，否则卡片跟着整页视口变，在窄侧栏里就崩。② 暗色默认是 `prefers-color-scheme`，要做"用户手动覆盖 + 跟随系统 + 记忆"，必须显式 `@custom-variant dark` 并自己写切换逻辑，否则 `dark:` 不听你使唤。③ 别忘了 `color-scheme`：在 `@theme` 里设 `--color-scheme: dark` 让浏览器原生控件（滚动条、下拉）也跟着变色。

### 3.6 组件抽象边界：何时提取组件而非 @apply

**是什么**：当多个地方需要同一组类名时，你有三个复用手段——① React 组件封装（语义 props）、② `@apply` 把工具类合并进一个自定义 CSS 类、③ CSS 变量 + 工具类组合。

**为什么需要**：复用是必然需求，但**复用错了边界**，Tailwind 就从"原子可组合"退化成"行内样式换皮"。核心判据：**是否带状态 / 是否跨技术栈**。

**怎么用**：三种手段的边界：

```css
/* 手段② @apply：仅用于"第三方库无法改类名"或"极高频重复的基础样式" */
@layer components {
  .btn-base { @apply inline-flex items-center justify-center rounded-card px-4 py-2; }
}
/* ⚠️ 滥用代价：@apply 把原子类"烧录"进一个普通类，
   丧失 hover:/focus:/dark: 等响应式与状态变体的可组合性，且 CSS 体积不降反升 */
```

```tsx
// 手段① 组件封装（首选）：状态、变体、可访问性一并封装
// 用 cva 管理变体矩阵，用 tailwind-merge 支持外部 className 覆盖
import { cva, type VariantProps } from 'class-variance-authority';
import { twMerge } from 'tailwind-merge';

const button = cva('inline-flex items-center rounded-card px-4 py-2', {
  variants: {
    variant: { primary: 'bg-brand-500 text-white', ghost: 'bg-transparent border' },
    size: { sm: 'text-sm', lg: 'text-lg px-6' },
  },
  defaultVariants: { variant: 'primary', size: 'sm' },
});

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={twMerge(button({ variant, size }), className)} {...props} />;
}
```

**坑在哪**：① **`@apply` 滥用代价最大**——每 `@apply` 一次就是把一组原子类固化，后续想加 `hover:` 还得回到 CSS 改，失去"在标记里组合"的灵活性；且 `@apply` 合并的样式**不参与** Tailwind 的响应式生成。② 组件 props 传 `className` 时**不合并**会覆盖默认样式，必须用 `twMerge` + `clsx`。③ 能用"变量 + 工具类组合"解决的（同一套间距体系下的微调），不要抽组件——组件是有运行时成本的抽象。

### 3.7 动态类名的陷阱与 @source

**是什么**：Tailwind 在**构建期**扫描你的源码字符串，找出"静态出现"的类名并生成对应 CSS。动态拼接的类名（运行时才拼出来）扫描器看不到，就不会生成。

**为什么需要**：这是 utility-first 的根本约束——CSS 是**构建（build）**期生成的，不是运行时解析。理解这条，你才不会写出"类名拼对了但样式没生效"的诡异 bug。

**怎么用**：永远让**完整类名静态出现在源码里**：

```tsx
// ❌ 错误：扫描器看不到 `text-${color}-500` 的拼接结果，类不会生成
<div className={`text-${color}-500`} />

// ✅ 正确：完整类名出现在源码中，可被扫描
const colorMap = { red: 'text-red-500', blue: 'text-blue-500' } as const;
<div className={colorMap[color]} />
```

```css
/* 当类名来自 CMS / 后端 / 运行时字符串时，用 @source 强制生成 */
@source inline("bg-brand-500 text-white rounded-card");
/* 排除不需要扫描的目录，减小产物 */
@source not "node_modules/some-lib/dist";
```

**坑在哪**：① 字符串拼接动态类名是**最高频坑**，记住铁律"完整类名必须静态出现在源码"。② `@source inline("...")` 是兜底，不是日常手段——能静态写就静态写。③ 如果类名来自 `props` 但值有限（如 `variant`），用 `cva` 的变体映射（见 3.6）比运行时拼接更稳、还有类型约束。

### 3.8 v3 → v4 迁移差异清单

**是什么**：Tailwind v4 相比 v3 是**配置范式与引擎的双重变更**，不是小版本升级。下面是一份可对照的迁移差异清单。

**为什么需要**：你大概率会搜到 v3 教程（2026 年仍有大量存量），直接照抄会踩一堆"写法已过时"的坑。先把差异刻进脑子，再决定信哪篇。

**怎么用**：差异对照表（来自官方迁移指南）：

| 维度 | v3 写法（已过时） | v4 写法 |
| --- | --- | --- |
| 入口指令 | `@tailwind base; @tailwind components; @tailwind utilities;` | `@import "tailwindcss";` |
| 配置文件 | `tailwind.config.js`（JS） | CSS-first：`@theme` / `@utility` / `@custom-variant` |
| 暗色策略 | `darkMode: 'class'` | `@custom-variant dark (&:where(.dark, .dark *));` |
| 主题扩展 | `theme: { extend: { colors: {...} } }` | `@theme { --color-brand-500: ... }` |
| 自定义类 | 插件 `addComponents` | `@utility name { ... }` |
| 自定义变体 | 插件 `addVariant` | `@custom-variant name (...)` |
| 构建接入 | PostCSS 插件 `tailwindcss` | `@tailwindcss/vite` 或 `@tailwindcss/postcss` |
| 透明度修饰 | `bg-black/50`（v3.0+ 也支持） | 同左，且更稳 |
| 引擎 | JIT（JS） | Oxide（Rust），扫描更快 |
| Webpack | 用 PostCSS | 4.2 起有 `@tailwindcss/webpack` |

**坑在哪**：① 不要边搜边抄——先确认文档是 v4 还是 v3，v3 的 `tailwind.config.js` 全文在 v4 不成立。② `darkMode: 'class'` 这类 JS 配置项在 v4 **没有等价字段**，必须改用 `@custom-variant dark`。③ 升级时先用官方 `@tailwindcss/upgrade` 工具自动改大部分，再手动补 `@theme` 与变体。

### 3.9 与原生 CSS 协作：@layer 分层与第三方优先级

**是什么**：Tailwind 把生成的样式放进若干 **层（layer）**：`base` / `components` / `utilities`，利用 CSS 的 **层叠（cascade）** 与 **特异性（specificity）** 规则控制优先级——同一特异性下，`utilities` 层永远压过 `components` 压过 `base`。

**为什么需要**：你迟早要引入第三方 CSS（UI 库、normalize）或写少量原生 CSS。如果不理解分层，就会出现"我的工具类被第三方样式覆盖"或"自己写的 CSS 盖不住 Tailwind"的特异性战争。

**怎么用**：用 `@layer` 把你的自定义样式放进对应层，确保优先级符合预期：

```css
@import "tailwindcss";

/* 放进 utilities 层：优先级最高，能压过组件默认样式 */
@layer utilities {
  .text-shadow-glow { text-shadow: 0 0 8px currentColor; }
}

/* 放进 components 层：介于 base 与 utilities 之间 */
@layer components {
  .card { @apply rounded-card border p-4; }
}

/* 原生 CSS 变量 + 媒体查询，与 Tailwind 共存 */
:root { --safe-top: env(safe-area-inset-top); }
@media (min-width: 1024px) {
  .prose-wide { max-width: 70ch; }
}
```

第三方样式优先级处理：

```css
/* 让第三方库的样式先于 Tailwind utilities，从而被工具类覆盖 */
@layer base, third-party, components, utilities;
@layer third-party {
  @import "some-lib/style.css"; /* 放中间层，工具类仍可覆盖它 */
}
```

**坑在哪**：① **特异性战争**：你手写 `.btn { ... }`（特异性 0,1,0）会压过 `bg-brand-500`（特异性 0,1,0 但位于 utilities 层，层叠胜出）——理解"层 > 特异性"是关键，别盲目加 `!important`。② 第三方样式若**不**放进任何 Tailwind 层，会落在"无层"区，特异性相同时**无层样式优先于有层样式**，于是它可能盖掉你的工具类。用 `@layer` 把第三方包进中间层即可。③ `@apply` 只能引用**已生成**的工具类，引用尚未定义或拼写错的类会构建报错。

---

## 四、与 Java 经验的对照

| Java 世界的经验 | 前端的对应关系 | 注意差异 |
| --- | --- | --- |
| 常量类 / 主题配置类 | `@theme` 里的 CSS 变量（设计令牌，运行时可变） | 令牌是**编译期扫描生成工具类**的源头；Java 常量是运行期值，无"自动派生"能力 |
| 工具类静态方法 | utility 类（无状态、可组合） | 工具类是"原子样式"，靠**类名组合**而非方法调用；顺序无先后，靠层叠决定最终效果 |
| 继承基类复用样式 | 组件封装 + 变体 props（组合优于继承） | 前端**不靠继承**复用样式；`cva` 的变体矩阵近似"Builder"，但本质是组合 |
| Lombok `@Builder` 链式调用 | 类名链式叠加（`hover:bg-x focus:ring-y`） | 同样依赖"约定 + IDE 提示"，但链式是**类名拼接**而非方法链，无编译期校验 |
| 编译期常量 | 构建期扫描生成（**类名必须静态出现在源码中**） | 这是与 Java 最大的不同：类名是构建期产物，动态拼接的类不会生成（见 3.7） |
| Spring Profile / 配置多环境 | 多主题（`data-theme`） + 环境变量 | 主题切换是**运行时 DOM 属性**，不是启动参数；靠 CSS 层叠翻转令牌 |
| CSS 预处理器（Sass/Less 变量） | `@theme` + 原生 CSS 变量 | v4 不再需要 Sass 变量管主题；原生 CSS 变量即可运行期切换 |

---

## 五、实践练习

### 练习 1（必做）：类名速记训练（3 小时）

**目标**：把高频类名变成肌肉记忆。

**步骤**：不看文档，用 Tailwind 复刻 10 个真实界面片段（登录卡片、数据卡片、面包屑、头像组、Badge、Alert、Tabs、Table、分页器、空状态）。每个片段写完后对照官方文档检查是否用了更地道的类名。

**验收点**：10 个片段全部不查文档完成；对照后每个都能指出"更地道的写法"。

### 练习 2（必做）：设计令牌体系（4 小时）

**目标**：建立三层令牌与多主题。

**步骤**：

- 定义三层令牌：primitive（色板 / 字阶 / 间距刻度）→ semantic（`--color-bg`、`--color-fg-muted`、`--color-danger`）→ component。
- 实现三套主题：亮色、暗色、高对比度，通过 `<html data-theme="...">` 切换。
- 接入 `prefers-color-scheme` 自动跟随系统 + 用户手动覆盖 + `localStorage` 记忆（参考 3.5 脚本）。
- 验收：全项目**零**硬编码颜色值（`rg "#[0-9a-fA-F]{3,6}" src/` 应有结果但全部位于 `@theme` 文件中）。

**验收点**：`data-theme` 切换即时生效；命令行搜索确认没有散落的十六进制颜色。

### 练习 3（必做）：组件样式库（5 小时）

**目标**：沉淀 15 个组件样式。

**步骤**：用 Tailwind 实现 15 个组件，每个都支持 `variant` / `size` / `disabled` / `loading` 状态：Button、Input、Textarea、Select、Checkbox、Radio、Switch、Card、Dialog（纯 CSS + `<dialog>`）、Dropdown、Tooltip、Tabs、Breadcrumb、Pagination、Skeleton。

要求：

- 用 `cva` 管理变体。
- 用 `twMerge` 支持 `className` 覆盖。
- 键盘可达 + `:focus-visible` 焦点环 + `aria-*` 变体。
- `motion-reduce:` 降级。

**验收点**：15 个组件全部可交互与可访问；外部 `className` 能正确覆盖而非丢失默认样式。

### 练习 4（进阶）：响应式与容器查询（2 小时）

**目标**：掌握组件级响应式。

**步骤**：做一个"组件级响应式"卡片：在 300px 侧栏里竖排、在 800px 主区里横排，**用 `@container` 而不是媒体查询**。再加一个随视口变化的排版系统（`clamp()` + Tailwind 任意值）。

**验收点**：卡片在窄容器竖排、宽容器横排，且是"容器宽度"驱动而非整页视口。

### 练习 5（进阶）：生产优化（2 小时）

**目标**：理解产物体积与可维护性。

**步骤**：

- 查看 `dist/assets/*.css` 体积，记录优化前后。
- 用 `@source not` 排除不需要扫描的目录。
- 对比"全量 utility"与"精简主题（移除未用色板）"的产物差异。
- 接入 `prettier-plugin-tailwindcss` 统一类名排序。

**验收点**：CSS 产物体积可解释；类名顺序被插件自动规整。

### 练习 6（挑战）：主题可视化编辑器（3 小时）

**目标**：把令牌体系玩透。

**步骤**：做一个页面，可实时调色（输入 oklch 值）→ 通过 CSS 变量注入 → 全站主题即时切换 → 导出为 `@theme` 片段。

**验收点**：调色实时反映到全站；导出的 `@theme` 片段可直接粘贴进 `index.css` 复用。

---

## 六、常见坑与自查清单

### 高频坑

- **照抄 v3 教程**：`@tailwind base;` / `tailwind.config.js` / `darkMode: 'class'` → v4 全变，改用 `@import "tailwindcss"` 与 `@custom-variant`。
- **字符串拼接动态类名** → 类不生成（见 3.7），完整类名必须静态出现。
- **类名顺序靠手写** → 用 `prettier-plugin-tailwindcss` 自动排序，避免前后不一致。
- **组件 props 传 `className` 时不合并** → 用 `twMerge` + `clsx`，否则覆盖默认样式。
- **处处 `@apply`** → 丧失可组合性，且 CSS 体积不降反升（见 3.6）。
- **`dark:` 不生效** → 检查暗色策略是 media 还是 class / data 属性，需要手动切换就必须 `@custom-variant dark`。
- **忘了可访问性** → `focus-visible` 焦点环、`motion-reduce:` 降级、`aria-*` 变体。
- **任意值滥用**（`w-[13px]` 满天飞）→ 说明令牌体系没建好，优先补 `@theme`。
- **第三方样式盖住工具类** → 用 `@layer` 把第三方包进中间层，理解"层 > 特异性"（见 3.9）。

### 自查清单

- [ ] 能独立用 `@theme` / `@utility` / `@custom-variant` 扩展 Tailwind
- [ ] 不查文档写出 30 个以上高频类名（布局 / 间距 / 排版 / 颜色 / 状态变体）
- [ ] 掌握 `group-*` / `peer-*` / `has-*` / `data-*` / `aria-*` 变体
- [ ] 会用容器查询（`@container`）而不是媒体查询做组件级响应式
- [ ] 组件库全部支持 `className` 覆盖与 `motion-reduce` 降级
- [ ] 理解何时该用 `@apply`、何时不该（组件抽象边界）
- [ ] 能解释 Tailwind 扫描生成的工作原理，以及动态类名失效的根因
- [ ] 对照 v3 → v4 差异清单，能指出旧教程里哪些写法已过时
- [ ] 理解 `@layer` 分层与**层叠 / 特异性**如何决定样式优先级

---

## 七、参考资料

- Tailwind CSS v4 官方文档（Theme / Utilities / Variants / Functions & Directives）：`https://tailwindcss.com/docs`
- Tailwind 官方博客：v4.0（2025-01-22）、v4.1（2025-04-03）、v4.3（2026-05-08，新增滚动条 / `zoom` / `tab-size` / 强化 `@variant`）
- `@tailwindcss/vite` 插件文档：`https://tailwindcss.com/docs/installation/using-vite`
- `class-variance-authority`（cva）文档：`https://cva.style`
- `tailwind-merge` 文档：`https://github.com/dcastil/tailwind-merge`
- 官方迁移指南（v3 → v4）：`https://tailwindcss.com/docs/upgrade-guide`
- 验证时间：2026-09；版本号与 `track.json` 的 `toolchain` 一致（Tailwind CSS 4.3、Vite 8.0）。
