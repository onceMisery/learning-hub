# 阶段 1：现代 HTML + CSS 地基重建

| 项目 | 内容 |
| --- | --- |
| **周期** | 2.5 周（约 25 小时） |
| **前置** | 会写简单 HTML 标签、能看懂 CSS 选择器（对应 [阶段 0 环境准备](./README.md) 已跑通基础环境） |
| **本阶段技术栈** | 原生 HTML5 + CSS3，**不使用任何框架 / 构建工具** |
| **产出物** | 一个纯静态响应式作品集主页（3 个以上页面，或 1 个长页面 + 多断点），无任何 JS 框架依赖，Lighthouse 性能与无障碍 ≥ 90 |

---

## 一、本阶段在学习路径中的位置

- **上承**：你在 [阶段 0 环境准备](./README.md) 已经装好 Node、pnpm、VS Code，能新建一个 `index.html` 并用浏览器打开。但此时你对 HTML / CSS 的认知还是"凑出能看的样子"——标签随便用 `div`，样式靠复制粘贴，一旦换屏幕宽度就乱。
- **本阶段**：重建你的**地基**。核心是建立三件事：① 用语义化标签 + A11y 让页面"对人和机器都可读"；② 真正理解**盒模型、层叠、格式化上下文**这些"为什么这么排"的底层机制，而不是背属性；③ 用 Flexbox / Grid / 容器查询把**响应式（布局）** 变成一种可推导的约束，而非一堆媒体查询的堆砌。这一阶段的产出物是一个"死"的静态页面——内容写死在 HTML 里，但这正是下一阶段要解决的起点。
- **下接**：阶段 2 [JavaScript 深度补强与去 jQuery 化](./02-JavaScript深度补强与去jQuery化.md) 会教你用 JavaScript 让这个静态页面"活"起来，建立**状态驱动**的心智模型：数据 → 渲染函数 → DOM。地基不牢，阶段 2 的状态驱动就无从落地。

> 一句话：**阶段 1 决定你写出的页面"对不对、好不好、能不能自适应"，阶段 2 才决定它"动不动"。** 这两项没有捷径，全靠手写几十个布局练出来。

---

## 二、学习目标（可验收）

学完本阶段，你应该能够：

1. **不看 MDN 也能**正确写出含 `header` / `nav` / `main` / `section` / `article` / `aside` / `footer` 的语义化结构，并解释每个标签在**可访问性（A11y）** 上的含义。
2. 独立解释**盒模型**（`content-box` vs `border-box`）、**外边距折叠**、**BFC（块级格式化上下文）** 的触发条件与实际用途。
3. 用 **Flexbox** 实现任意一维布局（导航栏、卡片列表、垂直居中），用 **Grid** 实现任意二维布局（圣杯布局、瀑布流式宫格、仪表盘骨架），并说清 `min-width: 0`、`auto-fit` + `minmax`、`grid-template-areas` 各自解决什么。
4. 用 **CSS 自定义属性** 搭建一套**设计令牌**（颜色 / 间距 / 字号 / 圆角 / 阴影），并基于它实现**深色模式**，全程不写死任何字面量颜色。
5. 写出移动端优先的**响应式（布局）** 页面，熟练使用 `clamp()`、容器查询、现代视口单位（`dvh` / `svh` / `lvh`）。
6. 说出至少 5 条 **jQuery 时代常见的 CSS 反模式**及现代替代方案。
7. 用 DevTools 定位并修复三类问题：**布局抖动**、文字溢出、**层叠上下文（stacking context）** 导致的 `z-index` 异常。

---

## 三、核心概念详解

> 本节每一个概念小节都按四步走：**是什么 → 为什么需要 → 怎么用 → 坑在哪**。请务必把每个代码块复制到本地 `.html` 文件里跑一遍——CSS 是"眼睛会了手不会"的典型，不手写几十遍没有肌肉记忆。

### 3.1 语义化 HTML 与可访问性（A11y）

**是什么**：语义化 HTML 是指"用含义正确的标签表达内容结构"，而不是用一堆 `<div class="header">` 装饰样式。可访问性（Accessibility，缩写为 A11y）是指让残障用户（尤其是依赖屏幕阅读器的用户）也能顺畅使用页面。

**为什么需要**：浏览器、搜索引擎、屏幕阅读器都不是"看图理解页面"的，它们读的是 DOM 结构。你用 `<div onclick>` 堆出来的页面，对屏幕阅读器来说只是一串无意义的盒子，用户听到的会是"按钮？不知道是什么"。语义化标签等于一份"自带说明书"的结构，机器一读就懂。

先看一个完整、可直接运行的语义化页面骨架：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <!-- viewport 是响应式（布局）的前提：禁止手机把页面当成 980px 桌面宽度缩放 -->
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>作品集 · 林默</title>
</head>
<body>
  <!-- 跳转到主内容：屏幕阅读器与键盘用户第一个 Tab 就跳过大段导航 -->
  <a class="skip-link" href="#main">跳到主要内容</a>

  <header>
    <!-- nav 带 aria-label，页面有多个 nav 时帮助区分"主导航 / 页脚导航" -->
    <nav aria-label="主导航">
      <a href="/">首页</a>
      <a href="/works">作品</a>
      <a href="/about">关于</a>
    </nav>
  </header>

  <!-- main 在整页只应出现一次，它是屏幕阅读器"跳到主要内容"的目标 -->
  <main id="main">
    <article>
      <h1>林默的设计作品集</h1>
      <section aria-labelledby="works-title">
        <h2 id="works-title">精选作品</h2>
        <figure>
          <img src="cover.jpg" alt="一个使用网格布局的电商首页设计稿" loading="lazy" decoding="async" />
          <figcaption>图 1：电商首页重设计</figcaption>
        </figure>
      </section>
    </article>
  </main>

  <footer>
    <p>&copy; 2026 林默</p>
  </footer>
</body>
</html>
```

再补两块关于"键盘可达性"与"ARIA 基础"的关键代码。键盘可达性的第一原则是：**任何能用鼠标点的东西，都必须能用键盘 Tab 到、并用回车 / 空格触发**。

```css
/* 1. 永远保留清晰可见的焦点样式，不要用 outline: none 一刀切关掉 */
:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

/* 2. 跳转链接：平时藏起来，键盘聚焦时才出现（屏幕阅读器始终能读到） */
.skip-link {
  position: absolute;
  left: -999px;
}
.skip-link:focus {
  left: 1rem;
  top: 1rem;
  background: #fff;
  padding: 0.5rem 1rem;
  z-index: 100;
}
```

ARIA（Accessible Rich Internet Applications）是用属性给"没有原生语义的元素"补语义。但记住一条铁律：**能用原生语义标签就别用 ARIA**。ARIA 只在该用的时候用：

```html
<!-- 错误：用 div 伪装按钮，屏幕阅读器读不出"这是个按钮"，回车也不会触发 -->
<div class="btn" onclick="submit()">提交</div>

<!-- 正确：原生 button 自带可聚焦、可回车触发、可被读屏识别 -->
<button type="button" onclick="submit()">提交</button>

<!-- ARIA 用于补语义：一个用 div 实现的"实时通知区"，告诉读屏"内容变了要播报" -->
<div aria-live="polite" id="toast"></div>

<!-- 图标按钮：看不见文字，用 aria-label 提供可读名称 -->
<button type="button" aria-label="关闭对话框">
  <svg aria-hidden="true"><!-- 装饰性图标对读屏隐藏 --></svg>
</button>
```

**坑在哪**：

- 一个页面**只应有一个 `<h1>`**，且层级不要跳级（`h1` 直接跳 `h3` 会破坏文档大纲，读屏用户按标题导航时会迷失）。
- `alt` 不是"必须写"，而是"必须有决策"：装饰性图片写 `alt=""`（空字符串，读屏跳过），信息性图片写准确描述。**不要**给装饰图写 `alt="图片"`。
- 表单里 `<label for="id">` 的 `for` 必须和输入框 `id` 精确对应，否则点击文字无法聚焦输入框，屏幕阅读器也不知道标签属于谁。
- 不要滥用 `tabindex="1"` 这类正数——它会打乱自然 Tab 顺序。只用 `tabindex="0"`（纳入自然顺序）和 `tabindex="-1"`（可程序聚焦、但不参与 Tab 流，常用于弹窗）。

### 3.2 盒模型与 margin 折叠

**是什么**：盒模型（box model）描述每个元素在页面上占多大空间——它由 `content`（内容）、`padding`（内边距）、`border`（边框）、`margin`（外边距）四层组成。外边距折叠（margin collapsing）是指**垂直方向上相邻的两个 margin 会合并成其中一个的最大值**，而不是相加。

**为什么需要**：默认 `box-sizing: content-box` 下，`width` 只算 content，你设了 `width: 100px` 再加 `padding: 20px`，实际宽度是 140px——这是无数"宽度算错、换行错位"的根源。统一改成 `border-box` 后，`width` 就是最终占用的宽度（padding / border 向内挤），心智负担立刻减半。

```css
/* 全局重置：让所有元素都按 border-box 计算，这是现代项目的标配第一行 */
*,
*::before,
*::after {
  box-sizing: border-box;
}

.box {
  width: 100px;       /* border-box 下：content + padding + border 总宽 = 100px */
  padding: 20px;
  border: 2px solid #000;
  /* 此时 content 区域自动变成 100 - 40 - 4 = 56px */
}
```

margin 折叠的演示——下面两段代码中，两个相邻 `p` 之间的间距是 `30px`（取最大值），而不是 `20 + 30 = 50px`：

```html
<style>
  .a { margin-bottom: 20px; }
  .b { margin-top: 30px; }
</style>
<p class="a">第一段</p>
<p class="b">第二段</p>
<!-- 两段之间实际间距 = max(20, 30) = 30px，这就是 margin 折叠 -->
```

**坑在哪**：

- margin 折叠**只发生在块级元素的垂直方向**（左右 margin 不折叠，inline / flex / grid 子项也不折叠）。
- 最常见的"踩坑现场"：父元素没有 `border` / `padding`，它的第一个子元素的 `margin-top` 会"穿透"到父元素外面，导致父元素和子元素一起下移。解决：给父元素加 `overflow: hidden`、`padding-top`、`border-top`，或（更语义化）用 `padding` 代替子元素的 `margin-top`。
- 想彻底消除折叠困扰，记住一句话：**能用 `padding` 就别用 `margin` 控制内部间距；用 `gap`（见 3.5 / 3.6）代替 `margin` 控制兄弟间距**。

### 3.3 BFC（块级格式化上下文）

**是什么**：BFC（Block Formatting Context，块级格式化上下文）是 CSS 渲染时的一个**独立布局区域**。一旦一个元素创建了 BFC，它就成了一个"隔离舱"——内部元素的布局不会影响外部，外部也无法侵入内部。

**为什么需要**：BFC 解决三个高频实际问题：① 清除浮动（父元素包不住浮动的子元素时）；② 阻止 margin 折叠（隔离舱内的 margin 不与外部折叠）；③ 阻止文字环绕浮动元素（让文字不钻到 `float` 元素下面）。

```css
/* 触发 BFC 的若干方式（任选其一即可创建隔离舱） */
.bfc {
  overflow: hidden;          /* 最常用，但会裁掉溢出内容 */
  /* 或者： */
  display: flow-root;        /* 现代专用属性，专为创建 BFC 而生，无副作用 */
  /* 或者： */
  display: flex;
  display: grid;
  /* 或者： */
  position: absolute;
  float: left;
}
```

清除浮动的经典场景——父元素没有高度，因为子元素都浮动了：

```html
<style>
  .parent { display: flow-root; }   /* 创建 BFC，父元素重新"看见"浮动子元素的高度 */
  .child  { float: left; width: 100px; height: 100px; background: #ccc; }
</style>
<div class="parent">
  <div class="child"></div>
</div>
<!-- 没有 display: flow-root，parent 高度为 0；加上后高度 = 100px -->
```

**坑在哪**：`overflow: hidden` 虽然能触发 BFC，但**会裁掉超出边界的内容**（比如下拉菜单、tooltip 被切掉）。优先用 `display: flow-root`——它是语义最干净的 BFC 触发器，不带任何副作用。

### 3.4 层叠、特异性与层叠上下文

**是什么**：**层叠（cascade）** 是 CSS 决定"多条规则冲突时哪条生效"的机制，优先级大致是：`!important` > 内联样式 > 作者样式（`id` / 类 / 标签）> 用户代理（浏览器默认）。**特异性（specificity）** 是层叠里判断"选择器谁更具体"的计分。而 **层叠上下文（stacking context）** 是渲染时用于决定元素在 Z 轴上"谁盖谁"的三维空间——它是 `z-index` 真正起作用的范围。

**为什么需要**：你一定遇到过"我设了 `z-index: 9999` 还是被盖住"。原因几乎总是：那个 `z-index` 是相对于**它所在的层叠上下文**计数的，而它被困在了一个父级层叠上下文里，跟外面的元素根本不在同一个"楼层"比较。理解这三者的关系，才能从根上解释 `z-index` 失效。

先看特异性怎么算——用 (a, b, c) 表示 `(id 数, 类/属性/伪类数, 标签/伪元素数)`：

```css
/* 特异性 (0,0,1) —— 一个标签 */
p { color: black; }

/* 特异性 (0,1,0) —— 一个类，赢 */
.text { color: blue; }

/* 特异性 (1,0,0) —— 一个 id，赢过上面所有 */
#title { color: red; }

/* 坑：特异性只看"个数"，不考虑你写得有多长 */
/* (0,1,0)：一个类 */
.btn { color: green; }
/* (0,1,1)：一个类 + 一个标签，赢过上面的 .btn —— 即使它看起来更"短" */
div.btn { color: orange; }
```

`:is()` 与 `:where()` 对特异性的影响是面试高频题——`:is()` 取括号内**特异性最高的那个选择器**，而 `:where()` **特异性恒为 0**：

```css
/* :is() 取最大值：括号内 a / button 都是 (0,0,1)，整体特异性 (0,0,1) */
:is(a, button) { color: blue; }

/* :where() 永远是 (0,0,0) —— 这让它成为"安全兜底"，不会被你的类选择器覆盖 */
:where(a, button) { color: blue; }   /* 特异性 0，轻易被 .link 覆盖 */

/* 实战价值：用 :where() 写 reset，保证用户随时能用普通类覆盖 */
:where(h1, h2, h3) { margin: 0; }    /* 用户写 .title { margin: 1rem } 即可覆盖 */
```

再看层叠上下文的触发与 `z-index` 失效——下面代码的 `z-index: 9999` 其实只在 `.modal-layer` 内部有效：

```html
<style>
  .parent {
    position: relative;
    z-index: 1;                 /* 这一行创建了层叠上下文！ */
    opacity: 0.99;              /* 注意：opacity < 1 也会创建层叠上下文 */
  }
  .child {
    position: absolute;
    z-index: 9999;              /* 相对 parent 的内部楼层，不是全局 */
  }
  .sibling-outside {
    position: absolute;
    z-index: 2;                 /* 在 parent 之外比较，盖住了整个 parent 及其子元素 */
  }
</style>
<div class="parent">
  <div class="child"></div>     <!-- 即使 z-index 9999，也被 sibling-outside 盖住 -->
</div>
<div class="sibling-outside"></div>
```

**坑在哪**：

- 创建层叠上下文的属性不止 `z-index`：还包括 `opacity < 1`、`transform`、`filter`、`will-change`、`isolation: isolate`、`contain`、`position: fixed`。**只要祖先里有任意一条，子元素的 `z-index` 就被关进它内部**。
- 调试 `z-index` 失效，先往 DOM 树上找"是谁创建了层叠上下文"，而不是一味加大数字。一个常见修法是给问题元素加 `isolation: isolate`，人为给它建一个干净上下文。

### 3.5 Flexbox：一维布局的主力

**是什么**：Flexbox（弹性盒布局）是为**一维**（要么一行、要么一列）布局设计的模型。核心是两个轴：**主轴（main axis）** 由 `flex-direction` 决定，**交叉轴（cross axis）** 与之垂直。

**为什么需要**：在 Flexbox 之前，垂直居中、等高列、自动分配剩余空间这些需求都要用 `float` / `table` / 负 margin 各种 hack。Flexbox 把这些"本该一行代码解决"的事情变成了真正的布局原语。

`flex: <grow> <shrink> <basis>` 是三段式简写，务必理解每个值：

```css
.nav {
  display: flex;
  gap: 1rem;                    /* 现代首选：用 gap 代替 margin 控制间距，避免折叠 */
  align-items: center;          /* 交叉轴居中（垂直居中） */
}
.nav .logo { flex: 0 0 auto; }  /* 不放大、不缩小、尺寸由内容决定 */
.nav .spacer { flex: 1 1 auto; }/* 吃掉所有剩余空间，把后面的元素推到最右 */
.nav .links { flex: 0 0 auto; }
```

**最重要的坑：`min-width: 0`**。Flex 子项默认 `min-width: auto`，意味着"最小尺寸不能小于内容"。当子项里有长文本或长 URL 时，它会撑破容器、导致溢出或不换行：

```css
/* 错误：长文本会把卡片撑到容器外，flex 布局"看起来坏了" */
.card { display: flex; }
.card .body { /* 默认 min-width: auto */ }

/* 正确：允许子项收缩到比内容更窄，文本才能换行 / 截断 */
.card .body { min-width: 0; }
.card .body .title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;      /* 单行省略号，必须配合 min-width: 0 才生效 */
}
```

**坑在哪**：

- flex 子项会默认**拉伸**到交叉轴满高（`align-items: stretch`），这常导致"卡片莫名其妙一样高"——这是特性不是 bug，想要顶部对齐就设 `align-items: flex-start`。
- `margin: auto` 在 flex 里有妙用：单个子项的 `margin-left: auto` 会把它右边所有空间吃掉，等价于"推到最右"，比 `spacer` 更简洁。
- 不要拿 Flexbox 做二维网格（多行多列对齐），那是 Grid 的活——Flexbox 擅长"一条线"，Grid 擅长"一张表"。

### 3.6 Grid：二维布局

**是什么**：Grid（网格布局）是为**二维**（同时控制行和列）布局设计的模型。它把容器划成"轨道（track）"，子项可以显式地摆进任意单元格。

**为什么需要**：圣杯布局、仪表盘、卡片宫格这类"既要管列又要管行"的布局，用 Flexbox 得嵌套多层且难以对齐。Grid 一次声明就能把整张表定义清楚，子项用 `grid-area` 直接落位。

`auto-fit` + `minmax()` 是自适应宫格的王牌——它能在"列数随宽度自动增减"的同时，让每列至少 240px、剩余空间均分：

```css
.gallery {
  display: grid;
  /* auto-fit：尽量多放列；minmax(240px, 1fr)：每列最小 240px、最大平分剩余 */
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1rem;
}
/* 容器变窄时列数自动减少，变宽时自动增加——无需任何媒体查询 */
```

`grid-template-areas` 用"画图"的方式定义布局，可读性极高，是圣杯布局的最佳写法：

```css
.layout {
  display: grid;
  grid-template-columns: 200px 1fr 200px;
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    "header header header"
    "nav    main   aside"
    "footer footer footer";
  min-height: 100vh;
}
.layout > header { grid-area: header; }
.layout > nav    { grid-area: nav; }
.layout > main   { grid-area: main; min-width: 0; }   /* 又一次 min-width: 0 */
.layout > aside  { grid-area: aside; }
.layout > footer { grid-area: footer; }
```

**坑在哪**：

- Grid 子项同样有 `min-width: auto` 的默认问题，长内容仍会撑破列——记得给放文本的网格单元加 `min-width: 0` 或 `min-height: 0`。
- `1fr` 不是"等分剩余"，而是"等分**最小内容之外**的剩余"。如果某列内容很长，它会先占满自己需要的最小宽度，再参与 `1fr` 分配。需要强制均分时配合 `minmax(0, 1fr)`。
- `grid-auto-flow: dense` 可以回填前面的空洞，让布局更紧凑，但会**打乱视觉顺序**——对需要阅读顺序的列表慎用，它可能影响可访问性。

### 3.7 居中方案全解

**是什么**：居中（让一个元素在其容器内水平 / 垂直对齐）是前端最高频的需求，也是 jQuery 时代 hack 最多的地方。现代 CSS 有四种主流通用方案，各有适用边界。

**为什么需要**：不同场景（已知 / 未知尺寸、单元素 / 多元素、是否要脱离文档流）适合不同方案。背一种"万能写法"往往会踩坑，理解四者的边界才能一次写对。

```css
/* 方案 1：Flexbox —— 最通用，未知尺寸也能居中，且不脱离文档流 */
.parent {
  display: flex;
  justify-content: center;   /* 主轴（水平）居中 */
  align-items: center;       /* 交叉轴（垂直）居中 */
}

/* 方案 2：Grid place-items —— 比 Flex 更短，一句话双轴居中 */
.parent {
  display: grid;
  place-items: center;
}

/* 方案 3：绝对定位 + transform —— 元素脱离文档流，适合模态框 / 浮层 */
.parent { position: relative; }
.child {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);   /* 用自身尺寸回退一半，未知尺寸也有效 */
}

/* 方案 4：margin: auto（仅水平）—— 已知宽度的块级元素水平居中 */
.child {
  width: 200px;
  margin-inline: auto;        /* 等价于 margin-left/right: auto，逻辑属性写法 */
}
```

**坑在哪**：

- 方案 3 的 `transform` 居中会让元素**创建层叠上下文**（见 3.4），如果它内部还要用 `z-index` 跟外部比较，会陷入隔离舱。
- 旧教程里的 `top: 0; bottom: 0; margin: auto`（配合绝对定位做垂直居中）要求元素**有固定高度**才生效，未知高度请用方案 3 的 `translate` 法。
- 优先用方案 1 / 2——它们不脱离文档流，不会影响周围布局，是现代首选。

### 3.8 容器查询：组件级响应式（布局）

**是什么**：容器查询（Container Queries）让元素**根据它所在容器的尺寸**而非视口（viewport）尺寸来调整样式。语法由 `container-type`（声明"谁是查询容器"）和 `@container`（写条件）组成。

**为什么需要**：过去响应式（布局）只能看视口宽度（`@media (min-width: ...)`）。但同一个卡片放在"宽侧边栏"和"宽主内容区"时，视口一样宽、容器却不一样宽，媒体查询无能为力。容器查询让组件"自己知道自己的空间够不够"，这才是**组件化开发**的基石——组件不再依赖全局视口，到哪里都能自适应。

```css
/* 声明一个查询容器：它的子元素可以"问"它的内联尺寸（宽度） */
.card-container {
  container-type: inline-size;
  /* 可选：给容器命名，多个容器时用 @container sidebar 区分 */
  container-name: card;
}

/* 当容器宽度 ≥ 400px 时，卡片内部变成左右两栏 */
@container (min-width: 400px) {
  .card {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 1rem;
  }
}

/* 当容器较窄时，保持上下堆叠（默认写法写在 @container 之外即可） */
.card {
  display: block;
}
```

**坑在哪**：

- `container-type: inline-size` 只查询**内联轴（通常是宽度）**，不查高度（查高度要 `size`，但会牺牲性能且要求子元素不影响容器尺寸）。绝大多数场景用 `inline-size` 就够。
- 设置了 `container-type` 的元素，其 `contain` 会包含尺寸，可能导致它自身的 `height: 100%` 之类依赖被截断——给查询容器本身定好高度，别让它去依赖"自己内部内容的撑开"。
- 容器查询**不能嵌套查询自身**（一个元素不能同时是查询容器又基于自己查询），这是规范限制。

### 3.9 流式排版：clamp() 与现代视口单位

**是什么**：`clamp(min, preferred, max)` 是一个"取值夹子"——在最小值和最大值之间取 `preferred`，超出就截断。现代视口单位 `dvh` / `svh` / `lvh` 分别代表动态 / 小 / 大视口（viewport）高度，用来替代过去会"跳动"的 `vh`。

**为什么需要**：以前写 `font-size: 24px` 是死的，写 `vw` 又会随屏幕无限缩放。流式排版（fluid typography）用 `clamp()` 让字号"随屏幕平滑变化但有上下限"，一套代码覆盖手机到桌面。而 `100vh` 在移动端会包含 / 排除地址栏，导致"满屏元素被地址栏切掉"或"滚动时跳动"——`dvh`（dynamic viewport height）会在地址栏收起时自动更新，彻底解决这个问题。

```css
/* 流式标题：最小 1.5rem，理想值 = 视口宽度的 4%，最大 3rem */
h1 {
  font-size: clamp(1.5rem, 4vw, 3rem);
}

/* 流式间距：随屏幕从 1rem 平滑涨到 4rem */
.section {
  padding-block: clamp(1rem, 5vw, 4rem);
}

/* 满屏英雄区：用 dvh 而非 vh，避免移动端地址栏导致的内容被切 */
.hero {
  height: 100dvh;             /* 动态视口高度：地址栏收起时自动变高 */
  min-height: 100svh;         /* 兜底：至少占"小视口"（地址栏展开时）高度，避免露白 */
}
```

**坑在哪**：

- `clamp()` 的 `preferred` 必须是"会随视口变"的量（如 `vw`），否则退化成常量，失去意义。
- `dvh` 虽好，但**不支持**极老浏览器；生产环境用 `@supports` 做渐进增强（见 3.10）。
- 不要把 `clamp()` 用在所有字号上——正文正文保持固定值更易读，只给标题、间距这类"需要呼吸感"的元素用流式。

### 3.10 设计令牌分层与深色模式

**是什么**：**设计令牌（design token）** 是把颜色、间距、字号等设计决策抽象成"带名字的变量"的体系。它一般分三层：primitive（原始色板，如 `--blue-500`）→ semantic（语义令牌，如 `--color-bg`、`--color-primary`，指向原始色板）→ 组件级变量。深色模式（dark mode）则通过切换语义令牌指向不同的原始值来实现。

**为什么需要**：如果你在 200 个组件里写死了 `#ffffff`，要改主题就得改 200 处。用令牌后，**所有颜色只有一个来源**，切换深色模式只需改语义层映射，组件代码一行不动。这就是"运行时可变的主题"，对应 Java 里你会用常量类，但令牌是运行时可变、不是编译期常量。

```css
:root {
  /* 1. primitive：纯粹的色板，不带语义 */
  --blue-500: oklch(0.62 0.19 255);
  --gray-50:  oklch(0.98 0.00 0);
  --gray-900: oklch(0.21 0.00 0);
  --gray-950: oklch(0.14 0.00 0);

  /* 2. semantic：带语义，组件只引用这一层 */
  --color-bg: var(--gray-50);
  --color-surface: #fff;
  --color-text: var(--gray-900);
  --space-4: 1rem;
  --radius-md: 0.5rem;
}

/* 3. 深色模式：只翻转 semantic 层，组件零改动 */
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: var(--gray-950);
    --color-surface: #111;
    --color-text: var(--gray-50);
  }
}

/* 组件永远引用语义令牌，绝不写死字面量 */
.card {
  background: var(--color-surface);
  color: var(--color-text);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}
```

如果你想要"用户手动切换"而非跟随系统，用 `[data-theme]` 属性覆盖即可：

```css
/* 手动主题：在 <html data-theme="dark"> 时生效，优先级高于 prefers-color-scheme */
:root[data-theme='dark'] {
  --color-bg: var(--gray-950);
  --color-text: var(--gray-50);
}

/* 渐进增强：浏览器不支持 oklch 时退回 rgb（实际几乎都支持，这里演示写法） */
@supports not (color: oklch(0 0 0)) {
  :root { --blue-500: rgb(37, 99, 235); }
}
```

**坑在哪**：

- 令牌分层的好处是"组件不碰 primitive"，**严禁**在组件里直接用 `--blue-500`——否则主题切换时它不会变。纪律是：primitive 只在 semantic 层被引用一次。
- 深色模式别忘了图片 / 阴影 / 边框——纯白背景上的浅灰边框在深色下会消失，需要为语义层补充 `--color-border` 之类的令牌。
- `oklch()` 等现代颜色函数虽好，若团队要兼容旧浏览器，用 `@supports` 兜底（如上），别裸写。

### 3.11 现代选择器：:has() / :is() / :where()

**是什么**：`:is()` 和 `:where()` 是"分组选择器"的增强，`:has()` 是首个真正的**父选择器**（选择"包含某子元素"的父元素）。

**为什么需要**：过去想"卡片里有图片时换个布局"，只能靠 JS 或给父元素加 class。`:has()` 让纯 CSS 就能表达"父级条件"，是组件化样式的利器。`:is()` / `:where()` 则让一长串重复选择器变得简洁，且对特异性有精细控制（见 3.4）。

```css
/* :has()：当卡片内存在 <img> 时，整卡改成左右布局 */
.card:has(img) {
  display: grid;
  grid-template-columns: 120px 1fr;
}

/* :has() 还能做"表单校验可视化"：输入框无效时，其父 label 变红 */
label:has(input:invalid) {
  color: #dc2626;
}

/* :is()：一行代替 .a, .b, .c 的重复，特异性取括号内最高 */
:is(h1, h2, h3) {
  line-height: 1.2;
}

/* :where()：特异性恒为 0，适合写"随时可被覆盖"的基线样式 */
:where(ul, ol) {
  padding-inline-start: 1.5rem;
}
```

**坑在哪**：

- `:has()` 是**父选择器**，但它是"向后看"的——写 `.parent:has(.child)` 表示"包含 child 的 parent"。别写成 `.child:has(.parent)`（那是"包含 parent 的 child"，几乎不存在）。
- `:is()` 的特异性可能意外高于预期（取括号内最高），如果你只想做"弱基线"，用 `:where()` 更稳。
- `:has()` 在部分旧浏览器不支持，生产用前查 [caniuse](https://caniuse.com/css-has)；需要兼容时用 JS 兜底或接受渐进增强。

### 3.12 @layer：层叠层的优先级管理

**是什么**：`@layer`（层叠层）是 CSS 原生的"优先级分区"机制。你可以把样式分到不同层，层的先后声明决定优先级——**后声明的层优先级更高，且整个层都优先于未分层样式**。

**为什么需要**：jQuery 时代引入第三方 CSS（如某个 UI 库）时，它的样式总是盖过你的，你只能靠不断加 `!important` 或堆特异性去压。有了 `@layer`，你只要把第三方放到底层、自己的放高层，就能**不靠 `!important` 优雅地控制优先级**。这对应 Java 里你会用包 / 命名空间隔离，但 CSS 天生全局，隔离靠约定，而 `@layer` 给了语言级手段。

```css
/* 先声明层的顺序：reset 最弱，theme 次之，components 最强 */
@layer reset, theme, components;

/* reset 层：最弱的基线，用户随便一层都能覆盖它 */
@layer reset {
  * { margin: 0; box-sizing: border-box; }
}

/* components 层：最高优先级（最后声明），你的业务样式放这里 */
@layer components {
  .btn { padding: 0.5rem 1rem; background: var(--color-primary); }
}

/* 未分层的普通样式，优先级夹在 reset 和 components 之间 */
.btn { color: red; }   /* 会被 @layer components 里的 .btn 覆盖！ */
```

**坑在哪**：

- `@layer` 里声明的层**顺序在首次出现时就定死了**，后面再写 `@layer components { ... }` 只是往里加内容，不会改顺序。
- 分层的样式**无法用普通特异性"翻盘"**——哪怕你写 `body .btn` 也比不过 `@layer components` 里孤零零的 `.btn`。优先级是"层 > 层内特异性"。
- 想临时调整某一层顺序，可用 `@layer reset, components, theme;` 重新声明（顺序即优先级）。

### 3.13 渲染管线与布局抖动

**是什么**：浏览器把你的代码变成像素，要经过一条**渲染（render）** 管线：**样式计算 → 布局（Layout） → 绘制（Paint） → 合成（Composite）**。其中"布局"最贵（要算每个元素的位置尺寸），"合成"最便宜（只移动已画好的图层，典型如 `transform` / `opacity`）。

**为什么需要**：性能优化的核心就是"尽量只触发合成，避免触发布局"。而**布局抖动（layout thrashing，也叫强制同步布局）** 是指 JavaScript 在循环里"写样式 → 立刻读几何属性（如 `offsetHeight`）"，迫使浏览器在每轮循环都重排一次——一次循环重排几十次，页面直接卡死。

```js
// 错误：读和写在循环里交替，每次读取都强制浏览器先完成一次布局
const boxes = document.querySelectorAll('.box');
for (const box of boxes) {
  box.style.width = '200px';        // 写
  console.log(box.offsetHeight);    // 读 —— 触发强制同步布局（布局抖动）
}

// 正确：先批量读，再批量写，把重排次数从 N 次降到 1 次
const boxes2 = document.querySelectorAll('.box');
const heights = [];
for (const box of boxes2) heights.push(box.offsetHeight);  // 先全读
for (let i = 0; i < boxes2.length; i++) {
  boxes2[i].style.width = '200px';  // 再全写
}
```

**坑在哪**：

- 只改 `transform` / `opacity` 可以**跳过布局和绘制，直接合成**，是做动画的唯一高性能手段。永远用 `transform: translateX()` 做位移，而不是改 `left` / `margin`。
- `content-visibility: auto`（配合 `contain-intrinsic-size`）可以让"屏幕外的大块内容"跳过渲染，大幅提速长列表首屏。
- 调试时别只信 `console.log`——布局抖动必须用 DevTools 的 Performance 面板抓（见 3.14），看到一长串紫色"Layout"小条就是证据。

### 3.14 DevTools 调试实战

**是什么**：浏览器 DevTools 是阶段 1 的"显微镜"。本阶段最该练熟四块：盒模型面板、Layout 叠加层、Rendering 面板、Performance 面板。

**为什么需要**：CSS 的 bug 往往"看不见原因"——一个元素为什么这么高、为什么被盖住、为什么卡。靠猜不如靠 DevTools 直接看引擎给你的数据。

```css
/* 临时调试技巧：给可疑元素加高亮描边，快速定位"是哪个盒子在作怪" */
.debug, .debug * {
  outline: 1px solid red !important;   /* 上线前务必删除 */
}
```

实战清单（在浏览器里逐项点一遍）：

| 面板 | 你能看到什么 | 解决哪类问题 |
| --- | --- | --- |
| Elements → 盒模型图 | 元素的 content / padding / border / margin 精确值 | "宽度算错""被 margin 撑开" |
| Elements → Layout（Flex / Grid 叠加层） | 主轴 / 交叉轴、轨道线、间隙线 | "flex 子项为什么没居中""grid 列数不对" |
| Rendering → 勾选 Paint flashing | 哪些区域每次都在重绘（绿色闪烁） | 动画卡顿、过度绘制 |
| Performance → 录制 | 每一帧的 Layout / Paint / Script 耗时条 | 布局抖动、长任务 |
| Elements → 计算样式 | 最终生效的是哪条规则、被谁覆盖 | 特异性 / 层叠冲突 |

**坑在哪**：

- Performance 面板录制前先点"刷新"图标（带箭头的圆点），它会录制"从加载到稳定"的全过程，比手动开始更准。
- 看到 `z-index` 异常，先在 Elements 面板看元素的"堆叠上下文"祖先——DevTools 不会直接告诉你"谁创建了层叠上下文"，但你能从计算样式里逐个排查 `transform` / `opacity` / `position: fixed` 等。
- 别把调试用的 `outline` / `background: red` 提交进仓库，养成"用完即删"的习惯。

---

## 四、与 Java 经验的对照

| Java 世界的经验 | 前端的对应关系 | 注意差异 |
| --- | --- | --- |
| 类与继承体系 | CSS **层叠（cascade）** 与继承 | CSS 的"继承"是**属性级、按 DOM 树传递**的，没有"方法"概念；子类不会"继承行为" |
| 包 / 命名空间隔离 | `@layer`、BEM 命名、`@scope` | CSS **天生全局**，隔离靠约定与规范，不是语言强制；`@layer` 给了层级的优先级手段 |
| 常量类 / 枚举 | CSS 自定义属性 + **设计令牌** | 令牌是**运行时可变**的（切换主题），不是编译期常量；`--x` 可以随时被覆盖 |
| 布局管理器（Swing / JavaFX） | Flexbox / Grid | 前端布局是"**约束求解**"：父容器给规则、浏览器算结果，不写死坐标 |
| JVM 调优看 GC 日志 | DevTools Performance 看重排重绘 | 前端性能瓶颈多在**布局与绘制**，不在 JS 执行；`transform` / `opacity` 走合成最快 |
| 编译期类型检查 | 无（CSS 没有类型系统） | CSS 写错不会"编译失败"，只会在浏览器里"长得不对"，所以靠 DevTools 和纪律兜底 |
| 字段可见性（private / public） | 选择器特异性 + 约定 | CSS 没有真正私有，靠 `:where()` 降级、BEM 前缀、`@layer` 顺序模拟"封装" |

---

## 五、实践练习

> 每个练习都给出**目标 / 步骤 / 验收点**。所有代码零框架、零构建工具，直接用浏览器打开 `.html` 即可。

### 练习 1（必做）：语义化重构（3 小时）

**目标**：把你过去写过的（或网上随便找的）一段 `<div class="header">` 堆出来的 HTML，重构成语义化版本，并通过可访问性检查。

**步骤**：

1. 列出页面里所有"区块"，给每个区块选一个最合适的语义标签（`header` / `nav` / `main` / `article` / `section` / `aside` / `footer`）。
2. 把 `<div onclick>` 全部换成 `<button>` / `<a>`，补 `aria-label`。
3. 给所有 `<img>` 决策 `alt`（装饰图用 `alt=""`，信息图写描述）。
4. 加一个"跳到主内容"的 skip-link。

**验收点**：

- 无任何无意义的 `div` 嵌套（纯装饰容器允许，但交互 / 区块必须有语义）。
- 用 axe DevTools（浏览器扩展）检查，无 critical / serious 级别问题。
- 仅用键盘 Tab 能走完全部交互元素，焦点样式清晰可见。

### 练习 2（必做）：布局 30 题（6 小时）

**目标**：手写实现以下布局，每题单独一个 HTML 文件，禁止用框架。

**步骤**（覆盖原文全部题目）：

1. 圣杯布局（头部 + 三栏 + 底部，中间自适应）—— 分别用 Grid 和 Flex 各写一遍。
2. 粘性导航栏（`position: sticky`）。
3. 自适应卡片宫格（`repeat(auto-fit, minmax(240px, 1fr))`）。
4. 等高卡片 + 内容底部对齐的"卡片按钮"。
5. 未知宽高元素水平垂直居中（至少 4 种写法：flex / grid place-items / absolute+transform / margin auto）。
6. 长文本溢出省略（单行 + 多行 `-webkit-line-clamp`）。
7. 图片固定比例容器（`aspect-ratio`）+ `object-fit`。
8. 瀑布流（CSS `columns` 版 + Grid `dense` 版）。
9. 一个组件在侧边栏窄容器变竖向、在主区宽容器变横向（**必须用容器查询**）。
10. 使用 `:has()` 实现"当卡片内存在图片时改变整卡布局"。

**验收点**：10 题全部跑通；第 5、9、10 题主动用到了本阶段讲过的 `min-width: 0`、容器查询、`:has()`，并能在代码注释里讲清"为什么这么写"。

### 练习 3（必做）：设计令牌 + 深色模式（4 小时）

**目标**：建立一套三层令牌体系，并实现跟随系统的深色模式。

**步骤**：

1. 定义 primitive 层色板（至少 5 个灰阶 + 1 个主色，用 `oklch()`）。
2. 定义 semantic 层（`--color-bg` / `--color-surface` / `--color-text` / `--color-border` / `--color-primary`）。
3. 用 `@media (prefers-color-scheme: dark)` 翻转 semantic 层。
4. 选 3 个组件（卡片 / 按钮 / 导航），全部只引用语义令牌。

**验收点**：切换系统深色模式时全站配色自动切换；所有颜色 / 间距**不允许**在组件里写死字面量（做一次全局 `grep` 验证）。

### 练习 4（进阶）：纯 CSS 组件（4 小时）

**目标**：不写一行 JS，用现代 CSS 实现四个交互组件，体会"状态也可以由 CSS 表达"。

**步骤**：

1. 手风琴（`details` / `summary`，或 `:has()` + 隐藏 checkbox）。
2. Tooltip（`:hover` + `:focus-visible`，并照顾键盘可达）。
3. Tab 切换（radio + `:checked ~`）。
4. 模态框（`:target` 或 `popover` 属性）。

**验收点**：四个组件都能"只用键盘"完成全部交互；Tooltip / 模态框在 `prefers-reduced-motion` 下不闪动。

### 练习 5（挑战）：阶段产出物（6 小时）

**目标**：一个完整的作品集主页，作为阶段 1 的最终交付。

**步骤**：

1. 响应式（≤480 / 768 / 1280 / ≥1600 四个断点都要好看），用移动端优先（`min-width`）写法。
2. 深色模式 + 设计令牌。
3. 动效：`@starting-style` + `transition`（元素进入时淡入）。
4. 语义化完整、A11y 达标。

**验收点**：Lighthouse 性能与无障碍 ≥ 90 分；在 375px 与 1920px 下均正常、无横向滚动条；全站零行 JS 依赖（纯 CSS 交互）。

---

## 六、常见坑与自查清单

### 高频坑

- 只设 `height: 100%` 却忘了给 `html, body` 设高度 → 页面撑不满。
- Flex / Grid 子项文字溢出 → 加 `min-width: 0`（或 `min-height: 0`），这是本阶段最容易忘的一行。
- `position: absolute` 定位基准搞错 → 检查祖先是否有 `position: relative / absolute / fixed`。
- `z-index` 设到 9999 仍被盖住 → 被父级**层叠上下文**困住，去改祖先的 `z-index` 或 `isolation`。
- 用了 `transition: all` → 性能差且行为不可预期，永远写具体属性（如 `transition: transform 0.2s`）。
- `rem` 与 `px` 混用导致缩放失控 → 约定：尺寸用 `rem`，边框用 `px`，纯装饰间距用 `em`。
- 断点写成 `max-width` 优先 → 养成 **`min-width`（移动优先）** 习惯。
- `:is()` 特异性高于预期、`@layer` 顺序写反 → 优先用 `:where()` 做基线、用 `@layer` 显式声明顺序。
- 把 `transform` / `left` 混用做动画 → 动画位移只用 `transform`，否则触发布局卡顿。
- 容器查询元素"自己查自己" → 查询容器和被测元素不能是同一个。

### 自查清单（全部打勾才进下一阶段）

- [ ] 能默写出 Flex 与 Grid 各自的主轴 / 轨道相关属性及默认值。
- [ ] 解释清楚"为什么父元素设了 `overflow: hidden` 后子元素浮动不再溢出"（BFC 的三种触发之一）。
- [ ] 说出 3 种创建 BFC 的方式，及其解决的真实问题。
- [ ] 解释 `:is()` 与 `:where()` 在特异性上的区别，并各举一个使用场景。
- [ ] 独立用容器查询实现过一个组件的响应式。
- [ ] 能用 DevTools 的 Performance 面板指出一次布局抖动的证据。
- [ ] 阶段产出物在 375px 与 1920px 下均正常，无横向滚动条。
- [ ] 全站零行 JS 依赖（纯 CSS 交互），深色模式可随系统切换。

---

## 七、参考资料

- MDN：HTML 元素参考、CSS 布局（Flexbox / Grid / 多列）教程、可访问性指南（2026-09 验证，特性以 Chrome / Edge 150+ 为准）。
- web.dev：Learn CSS、Learn Responsive Design、Learn Accessibility（响应式与无障碍的官方系统教程）。
- CSS-Tricks：A Complete Guide to Flexbox / Grid（经典速查，注意部分旧写法以规范为准）。
- 规范：CSS Cascading and Inheritance Level 5、CSS Box Sizing、CSS Containment（容器查询与 `@layer` 的权威来源）。
- 验证时间：2026-09；现代 CSS 特性（`:has()`、`@layer`、容器查询、`dvh`、`oklch()`、`@property`）以 Chrome / Edge 150+ 与 Safari 18+ 为准，与 `track.json` 的 `toolchain` 一致。
