# 阶段 4：Vite 8 与现代前端工程化

| 项目 | 内容 |
| --- | --- |
| **周期** | 1.5 周（约 15 小时） |
| **前置** | 完成阶段 3（TypeScript 从类型思维到工程实践）；Node.js ≥ 22.12 |
| **本阶段技术栈** | Vite 8（Rolldown）· pnpm · TypeScript 7 · ESLint 9 · Prettier · Vitest · Git Hooks |
| **产出物** | 一份可复用的**项目脚手架模板**（后续每个阶段直接用它起步），含完整 lint / test / build 流程 |

> 为什么把工程化放在 React 之前：React 项目本身跑在 Vite 之上，先把工具链标准化，后面 7 个阶段就不用反复折腾环境。你后续写 React、Tailwind、Electron，跑的都是同一套 `dev` / `build` / `preview` 命令。

---

## 一、本阶段在学习路径中的位置

- **上承**：阶段 3 你已经用 TypeScript 7 重写了阶段 2 的 Todo 应用，给状态加上了类型约束，也理解了 `tsc` 的 `strict` 模式和工程化配置。但那时候你跑的是 `tsc --watch` + 浏览器手动刷新，没有真正的**构建（Build）**流程，也没有依赖管理和测试门禁。
- **本阶段**：把"能跑"升级成"能交付"。核心是建立**工程化心智模型**：源码 → 依赖管理 → 类型检查 → 测试 → 构建产物 → 提交门禁。你会在 Vite 8 之上把整套工具链标准化，并沉淀成可复用的脚手架。
- **下接**：阶段 5 用 [Tailwind CSS 4](./05-TailwindCSS4与样式系统.md) 在 Vite 8 之上建立样式系统；阶段 6 的 [React 19](./06-React19核心.md) 也直接复用本阶段的脚手架，所以这里不折腾，后面就一路顺风。

> 本阶段不写业务代码，但它是整条路线的"地基之下的地基"。环境卡半天、提交反复报错这种事，必须在这里一次性解决。

---

## 二、学习目标（可验收）

学完本阶段，你应该能够：

1. 能**从零**（空目录）搭出一个 Vite 8 + TS 7 项目，并解释 `vite.config.ts` / `tsconfig.json` / `package.json` 里**每一行**在做什么。
2. 解释 Vite 8 的**架构变化**：Rolldown 统一打包、Oxc 承担转换、开发态 ESM 原样服务、生产态全量打包这三者如何分工。
3. 说清**开发态与生产态的差异**（依赖预构建、HMR、tree-shaking、代码分割、产物分析），并知道为什么开发态"不打包"。
4. 配置好质量保障三件套：ESLint 9（flat config）+ Prettier + Vitest，并接入 pre-commit 钩子，让不合格的代码**提交不出去**。
5. 读懂并优化构建产物：分包策略、`rolldownOptions` 细粒度控制、体积分析、环境变量与模式、静态资源处理。
6. 掌握 pnpm workspace 的基本用法（硬链接、内容寻址、`pnpm-workspace.yaml`），为阶段 11 多包项目做准备。

---

## 三、核心概念详解

### 3.1 Vite 8 与 Rolldown：为什么快

**是什么**：Vite 8（2026-03-12 发布）把底层打包器统一成了 **Rolldown**（一个用 Rust 写的打包器，打包器 / bundler 即把零散模块合并成少数几个产物的工具）。它兼容 Rollup 的插件 API，但速度由 Rust 内核带来，官方 benchmark 显示构建提速 **10~30 倍**（Vite 8 发布说明）。同时 `@vitejs/plugin-react` v6 改用 **Oxc**（Rust 写的 JS 转换/压缩工具链）做 React Fast Refresh，**不再依赖 Babel**。

**为什么需要**：旧版 Vite 的链路是 `esbuild`（开发态依赖预构建）+ `Rollup`（生产态打包）+ `Babel`（React 转换），三套工具各自解析一遍 AST，重复劳动且行为不完全一致。Rolldown + Oxc 把"解析 / 转换 / 打包 / 压缩"收敛到一套 Rust 内核，既能提速，又能让开发态和生产态的行为更一致（更少"本地能跑、上线就崩"的诡异差异）。

**怎么用**：升级时多数项目**零改动**——Vite 8 自带兼容层，会自动把旧的 `esbuild` / `rollupOptions` 配置映射为 Rolldown / Oxc 等价配置。你只需要确认 Node 版本满足 **Node 20.19+ / 22.12+**，并把 `@vitejs/plugin-react` 升到 v6：

```bash
# 查看 Node 版本，务必 >= 22.12.0（或 20.19+）
node -v

# 升级 Vite 与 React 插件
pnpm add -D vite@^8 @vitejs/plugin-react@^6

# 验证当前版本
pnpm exec vite --version   # 应输出 8.x
```

对应到 `vite.config.ts` 的插件写法（Oxc 接管转换，无需 Babel）：

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()], // v6 内部用 Oxc 做 Fast Refresh，不再拉 Babel
});
```

Vite 8 额外新增的能力：

- `devtools` 选项：开启 Vite Devtools 面板，可视化查看模块图与依赖预构建。
- `resolve.tsconfigPaths: true`：内置 tsconfig 的 `paths` 别名解析（默认关闭）。
- 内置 `emitDecoratorMetadata`：TS 装饰器元数据无需额外插件。
- SSR 支持 `.wasm?init`：服务端也能按需加载 WASM。
- `server.forwardConsole`：浏览器 `console` 日志转发到终端，配合 AI 编程助手很好用。

**坑在哪**：Vite 8 以**纯 ESM** 发布，如果你的 `package.json` 没有 `"type": "module"`，配置文件的 `import` 语法会报错。另外，Rolldown 虽兼容 Rollup 插件 API，但**并非 100% 行为一致**——少数重度依赖 Rollup 内部事件钩子的插件可能需要等官方适配。遇到诡异打包差异时，先查该插件是否已声明支持 Vite 8 / Rolldown。

### 3.2 开发与构建：两套流程的差异

**是什么**：Vite 把**开发态（dev）**和**生产态（build）**分成两套完全不同的执行路径。开发态是"浏览器原生吃 ESM，按需编译、模块级热更新"；生产态是"Rolldown 全量打包、压缩、哈希命名、代码分割"。

**为什么需要**：开发时你最在乎**冷启动速度**和**改一行立刻看到效果**，所以不该做全量打包——Vite 让浏览器直接请求源文件，遇到 `.ts` / `.tsx` 才即时编译（并用 Esbuild / Oxc 极快转译）。而生产环境你最在乎**首屏体积**和**加载性能**，必须预先打包、压缩、做 tree-shaking。两套目标冲突，强行用一套流程只会两头不讨好。

**怎么用**：`pnpm dev` 走开发态，`pnpm build` + `pnpm preview` 走生产态验证：

```bash
pnpm dev        # 启动开发服务器，浏览器直接加载 ESM，改文件即 HMR
pnpm build      # Rolldown 打包到 dist/，含压缩与 tree-shaking
pnpm preview    # 用生产态产物起一个静态服务器，验证"上线长什么样"
```

关键差异对照：

| 维度 | 开发态 `dev` | 生产态 `build` |
| --- | --- | --- |
| 模块处理 | 源码按 ESM 原样发给浏览器 | Rolldown 合并打包成少量 chunk |
| 依赖 | 首次启动做**依赖预构建**（预打包 `node_modules`） | 直接打包进产物 |
| 更新 | HMR（模块级热替换，不刷新整页） | 无（产物是静态文件） |
| 压缩 | 不压缩，保留可读源码 | 压缩 + 哈希文件名 + tree-shaking |
| 类型检查 | 不做（交给 `tsc --noEmit`） | 不做（CI 里单独跑） |

**坑在哪**：**开发态不报错 ≠ 生产态能跑**。三类典型差异：① 开发态里 `import` 路径大小写不敏感（macOS / Windows 文件系统），生产态在 Linux CI 上会 404；② 开发态没做 tree-shaking，误用了未导出的内部 API 也能跑，打包后直接 `undefined`；③ 环境变量没加 `VITE_` 前缀时，开发态偶尔能"巧合"读到，生产态一定读不到。所以**每次提交前务必跑一遍 `build`**。

### 3.3 vite.config.ts 关键配置

**是什么**：`vite.config.ts` 是 Vite 8 的总配置文件（用 TS 写，Vite 会自行加载）。核心字段集中在 `plugins`、`resolve`、`server`、`build`，Vite 8 新增了 `devtools` 与 `resolve.tsconfigPaths`。

**为什么需要**：默认配置开箱即用，但真实项目几乎都要定制——接入 React 插件、配置路径别名、区分开发与生产构建行为、把 `node_modules` 拆成独立 vendor chunk。理解每个字段，才能在出错时知道去哪改。

**怎么用**：一份覆盖本阶段要点的完整配置：

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // 插件是 Vite 的扩展点：React 支持、Tailwind（阶段 5 加进来）、压缩等
  plugins: [react()],

  // 解析相关：Vite 8 新增 resolve.tsconfigPaths，直接复用 tsconfig 的 paths 别名
  resolve: {
    tsconfigPaths: true,
    alias: {
      // 也可以手写别名，等价于 tsconfig 的 paths（二选一即可）
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // 开发服务器
  server: {
    port: 5173,
    forwardConsole: true, // 浏览器 console 转发到终端
    proxy: {
      // 联调阶段 7 的后端，解决本地跨域
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },

  // Vite 8 新增：开启 Devtools 面板
  devtools: true,

  // 生产构建
  build: {
    target: 'esnext',
    sourcemap: true,
    // Rolldown 专属：把 node_modules 拆到 vendor chunk，利于浏览器长缓存
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'vendor', test: /node_modules/ }],
        },
      },
    },
  },

  // Vitest 配置可内联在此（也可用独立 vitest.config.ts）
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: { provider: 'v8', reportsDirectory: './coverage' },
  },
});
```

**坑在哪**：`resolve.alias` 和 `resolve.tsconfigPaths` 都能配路径别名，但**二者来源不同**——`alias` 是 Vite 自己认，`tsconfigPaths` 是让 Vite 去读 tsconfig 的 `paths`。如果你 tsconfig 配了 `paths` 却没开 `tsconfigPaths` 也没写 `alias`，编辑器（靠 tsconfig）能跳转、`vite build` 却报"找不到模块"。统一只用一种方式最省心：本阶段推荐直接开 `resolve.tsconfigPaths: true`，别名写在 tsconfig 里。

### 3.4 环境变量与多模式

**是什么**：Vite 通过 `.env` 系列文件和 `import.meta.env` 暴露环境变量。只有**以 `VITE_` 为前缀**的变量才会被打包进客户端代码，其余仅服务端可见。

**为什么需要**：API 地址、功能开关、埋点 ID 这类值不该写死在源码里——不同环境（开发 / 预发 / 生产）应该不同，且**密钥绝不能进客户端 bundle**。`.env` 机制把"配置"与"代码"分离，运维改个文件即可切换环境。

**怎么用**：`.env` 文件按加载优先级叠加：

```bash
# .env                 —— 所有模式都加载（基础默认值）
# .env.local           —— 本地覆盖，通常加入 .gitignore
# .env.development     —— 仅 development 模式
# .env.production      —— 仅 production 模式
```

```ini
# .env.development
VITE_API_BASE=http://localhost:8080/api
VITE_ENABLE_ANALYTICS=false

# .env.production
VITE_API_BASE=https://api.example.com/api
VITE_ENABLE_ANALYTICS=true
```

```ts
// src/config.ts —— 在代码里读取
export const API_BASE = import.meta.env.VITE_API_BASE;
export const isProd = import.meta.env.PROD; // 内置布尔，标识当前是否生产构建
export const mode = import.meta.env.MODE;    // 'development' | 'production' | 自定义
```

多模式构建（例如加一个 staging）：

```bash
pnpm vite build --mode staging   # 读取 .env.staging
```

**坑在哪**：① **没加 `VITE_` 前缀的变量客户端读不到**——这是最高频的坑，你设了 `API_BASE` 却永远 `undefined`，改成 `VITE_API_BASE` 就好了。② **不要把密钥写进 `.env` 并提交**——任何以 `VITE_` 开头的变量都会进客户端 bundle，等于公开。服务端密钥请走 CI Secret 或后端环境变量，绝不加 `VITE_` 前缀。③ 验证：生产构建后 `grep` 一下 `dist/`，确认未暴露的变量确实不在 bundle 里。

### 3.5 pnpm 依赖管理：为什么比 npm 快

**是什么**：pnpm 是 npm 的替代品（包管理器 / package manager），用**硬链接 + 内容寻址存储**管理 `node_modules`。同一份依赖在磁盘上只存一次，多个项目共享。

**为什么需要**：npm / yarn 的"嵌套 + 扁平"结构会在每个项目里复制大量重复依赖，磁盘吃紧、安装慢，还容易出现"同一库多个版本共存导致行为不一致"。pnpm 的内容寻址让安装**更快、更省磁盘**，且其严格的 `node_modules` 结构（只有声明过的依赖才可见）能暴露出"隐式依赖"这种 npm 下被掩盖的 bug。

**怎么用**：常用命令与关键字段：

```bash
pnpm add react react-dom          # 安装生产依赖
pnpm add -D vite typescript       # 安装开发依赖
pnpm install                      # 严格按 lockfile 安装（CI 用 --frozen-lockfile）
pnpm up --interactive -L          # 交互式升级，按 semver 大版本分组
pnpm why react                    # 查看 react 被谁依赖（依赖体检）
pnpm dedupe                       # 去重，减少重复版本
```

```json
{
  "name": "my-app",
  "type": "module",
  "engines": { "node": ">=22.12.0" },
  "packageManager": "pnpm@10.0.0",
  "pnpm": {
    "overrides": { "lodash": "4.17.21" }
  }
}
```

workspace（多包工程）用 `pnpm-workspace.yaml` 声明：

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

**坑在哪**：① **lockfile 必须提交**，否则 CI 安装结果与本地不一致，出现"队友能跑我跑不了"。② pnpm 默认**严格 node-linker**，没在 `package.json` 里声明却直接 `import` 的依赖会报错（npm 下可能侥幸成功）。这其实是好事，逼你显式声明依赖，但老项目迁移时会被"打脸"。③ `pnpm-lock.yaml` 与 `package.json` 不一致时，`pnpm install` 会报错而非静默更新，CI 里记得加 `--frozen-lockfile`。

### 3.6 tsconfig 关键选项与 TS 7 的 strict 默认

**是什么**：`tsconfig.json` 告诉 TypeScript 如何编译和检查你的代码。TypeScript 7（2026-07-08 GA，代号 Corsa，编译器从 TS 移植到 Go，类型检查 8~12 倍加速）最大的变化之一是 **`strict` 默认开启**。

**为什么需要**：`strict` 是一组"严谨性开关"的总开关（`noImplicitAny`、`strictNullChecks`、`strictFunctionTypes` 等）。旧习惯是写宽松代码再慢慢收紧，TS 7 直接把门槛提到最高——你从第一天就按严格模式写，才能享受类型系统兜底一半 bug 的红利。

**怎么用**：前端项目通常用两份 tsconfig（应用代码 + 构建配置），通过 `references` 关联：

```json
// tsconfig.json —— 应用源码
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"]
}
```

```json
// tsconfig.node.json —— Vite 配置等 Node 侧脚本
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "strict": true
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

**坑在哪**：① TS 7 **移除了** `target: es5`、`moduleResolution: node10`、AMD / UMD / SystemJS——老教程里的这些写法会直接报错，统一用 `moduleResolution: "bundler"`。② `verbatimModuleSyntax: true` 要求 `import type` 与值导入严格区分，混用会报错；这是为打包器 tree-shaking 服务的，值得开。③ TS 7 **暂无稳定编程式 API**，`typescript-eslint` 等依赖它的工具暂不可用（见 3.7）。

### 3.7 ESLint 9 flat config 与 TS 7 应对策略

**是什么**：ESLint 是静态代码检查工具（linter），在"运行之前"就揪出可疑写法。ESLint 9 使用 **flat config**（`eslint.config.js`，一个数组），取代旧的 `.eslintrc` 级联配置。

**为什么需要**：类型系统管"值对不对"，ESLint 管"写法烂不烂"——未使用变量、不一致的引号、危险的 `any`、React Hooks 误用等，类型查不出来。两者互补。

**怎么用**：TS 7 暂无稳定编程式 API，`typescript-eslint` 的类型感知规则暂时用不了。学习阶段**先用非类型感知的规则**（语法级检查完全可用）：

```js
// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended, // 非类型感知，TS7 下可用
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['dist', 'coverage', 'node_modules'],
  },
);
```

Prettier 与 ESLint **分工明确**：ESLint 管质量，Prettier 管格式（换行、引号、分号）。二者打架时，关闭 ESLint 的格式化类规则，并用 `eslint-config-prettier` 关掉冲突项。阶段 5 还会加 `prettier-plugin-tailwindcss` 自动排序类名。

**坑在哪**：① **ESLint 与 Prettier 抢格式控制权**是新手最常踩的——症状是一保存就被两方反复改。解法：Prettier 负责格式化，ESLint 的 `prettier` 兼容配置关掉所有格式规则。② `tsc --noEmit` 与 Vite 构建的"类型检查"是**两套东西**：Vite 构建默认不类型检查（只转译），CI 里 `tsc --noEmit` 和 `vite build` **两条都要跑**。③ 等 TS 7.1（预计 2026-11）补齐编程式 API 后，再升级到 `typescript-eslint` 的类型感知规则。

### 3.8 Vitest 上手：测试与覆盖率

**是什么**：Vitest 是 Vite 生态的测试运行器（test runner），**共享同一份 Vite 配置**（解析、别名、插件都复用），所以启动极快、零额外配置。

**为什么需要**：阶段 2 你手写了一堆工具函数（防抖、节流、深拷贝、并发池），但"能跑"不代表"对"。单元测试在提交前就拦住回归，也是你给未来自己写的"可执行文档"。

**怎么用**：给阶段 2 的 `debounce` 写测试，覆盖正常 / 边界 / `vi.useFakeTimers` 时间控制：

```ts
// src/utils/debounce.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from './debounce';

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('停止触发 wait 毫秒后才执行一次', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    debounced();
    debounced();
    expect(fn).not.toHaveBeenCalled(); // 抖动期间不执行
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1); // 只执行一次
  });

  it('leading 模式在首次立即执行', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100, { leading: true });
    debounced();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

模拟 fetch 失败与调用次数验证：

```ts
// src/api/fetchUser.test.ts
import { describe, it, expect, vi, expectTypeOf } from 'vitest';

it('网络失败时 reject 并在 catch 兜底', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false, status: 500, json: async () => ({}),
  }));
  // 你的 loadUser 应返回 null 而非抛错
  const user = await loadUser(1);
  expect(user).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});
```

运行与覆盖率：

```bash
pnpm vitest run             # 跑一次（CI 用）
pnpm vitest                 # watch 模式（开发用）
pnpm vitest run --coverage  # 生成覆盖率报告
```

**坑在哪**：① Vitest 默认**不类型检查**测试文件——类型错误不会让测试失败，要另跑 `tsc`。② `vi.mock` 是**提升执行**的（hoisted），不能在它之前写依赖变量的代码，需用 `vi.hoisted` 工厂。③ 覆盖率别盲目追 100%，阶段要求工具函数库 ≥ 80% 即可，重点覆盖分支与边界。

### 3.9 产物分析与体积优化

**是什么**：构建产物分析（bundle analysis）是把 `dist/` 里每个 chunk 的来源、体积可视化，找出"体积大头"。代码分割（code splitting）则是把产物拆成多个 chunk，让浏览器按需加载、并行缓存。

**为什么需要**：一个 `lodash` 全量引入就能让首屏多几十 KB；一个巨型单 chunk 会让所有页面都加载同一份代码。体积是前端性能的第一杠杆，必须会看、会切。

**怎么用**：视觉化分析工具（Vite 8 也可用 Devtools 面板）：

```ts
// vite.config.ts（分析用，平时可注释掉）
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    react(),
    visualizer({ filename: './dist/stats.html', gzipSize: true }),
  ],
});
```

动态 `import()` 做路由级 / 组件级分割：

```ts
// 懒加载：只有用到时才请求这个 chunk
const SettingsPage = React.lazy(() => import('./SettingsPage'));

// 或手动切分大依赖
const loadChart = () => import('chart.js');
button.addEventListener('click', async () => {
  const { Chart } = await loadChart(); // 点开图表页才下载 chart.js
});
```

`rolldownOptions.output.codeSplitting` 把 `node_modules` 拆到 vendor chunk（见 3.3）。配合长缓存：

```ts
// vite.config.ts
build: {
  assetsDir: 'assets',
  rollupOptions: { output: { entryFileNames: 'assets/[name].[hash].js' } },
}
```

**坑在哪**：① **tree-shaking 的前提**是 ESM + 无副作用。如果你 `import _ from 'lodash'`（整个包）就摇不掉；改用 `import debounce from 'lodash-es/debounce'`，并在 `package.json` 标 `"sideEffects": false`。② 动态 `import()` 的模块如果静态就被引用，会被自动合并回主 chunk，看 Network 面板确认是否真的懒加载了。③ 双构建（现代 + 兼容产物）了解即可，Vite 8 默认走 `target: esnext`，多数新项目不需要兼容老浏览器。

### 3.10 Git 提交规范与 CI 门禁

**是什么**：提交规范（Conventional Commits）用固定前缀（`feat:` / `fix:` / `chore:` 等）写 commit message；Git 钩子（hook）在提交前后自动跑脚本；CI 门禁在远端把关。

**为什么需要**：统一的 message 让 `git log` 可读、能自动生成 changelog；pre-commit 钩子把 lint / 格式化 / 类型检查挡在本地，避免"垃圾代码进仓库、CI 才报错"的来回。阶段 11 会把它升级成完整 CI 闭环。

**怎么用**：用 Husky 装钩子 + lint-staged 只检查改动文件 + commitlint 校验 message：

```json
// package.json（片段）
{
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "vite build",
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,css}": ["prettier --write"]
  }
}
```

```js
// commitlint.config.js
export default { extends: ['@commitlint/config-conventional'] };
```

```bash
# .husky/pre-commit
pnpm exec lint-staged

# .husky/commit-msg
pnpm exec commitlint --edit "$1"
```

CI 最小闭环（阶段 11 展开）：`install → lint → typecheck → test → build`，任何一步失败就阻断合并。

**坑在哪**：① `prepare` 脚本装 Husky 在 CI 里可能被跳过或失败，GitHub Actions 里用 `--frozen-lockfile` 安装即可，钩子本身本地生效、CI 用独立 step 跑同样的命令。② 钩子**只能挡住有装的人**——队友 `git commit --no-verify` 能绕过，所以 CI 门禁是最后防线，二者缺一不可。③ pre-commit 只跑 `lint-staged` 改动的，但 `typecheck` / `test` 这种全局检查应放在 CI，否则本地钩子会拖慢每次提交。

### 3.11 脚手架模板沉淀

**是什么**：脚手架模板（scaffold）是把本阶段所有配置（Vite / TS / ESLint / Prettier / Vitest / husky）固化成一份可复制的项目骨架，后续每个阶段 `git clone` 或拷贝即用。

**为什么需要**：阶段 5 的 Tailwind、阶段 6 的 React、阶段 8 的 Motion……如果每个都从零配一遍工具链，你会把精力耗在环境上。一次性沉淀好模板，后面只关心业务代码。

**怎么用**：整理成如下结构的模板，并写 `README.md` 说明每个配置项的取舍：

```
my-app/
├── index.html                 # Vite 的入口是 HTML，不是 JS
├── vite.config.ts
├── tsconfig.json / tsconfig.node.json
├── eslint.config.js           # ESLint 9 flat config
├── .prettierrc
├── commitlint.config.js
├── .husky/pre-commit
├── .husky/commit-msg
├── vitest.config.ts           # 或合并进 vite.config.ts
├── src/
│   ├── main.tsx
│   ├── vite-env.d.ts
│   └── utils/
├── public/                    # 原样拷贝，不参与编译
└── .env.example               # 环境变量样例（真实 .env 加入 .gitignore）
```

```bash
# 新项目直接基于模板起步
cp -r scaffold my-stage-05 && cd my-stage-05
pnpm install
pnpm dev
```

**坑在哪**：模板一旦被多个阶段共享，**不要在各阶段随意改模板里的全局配置**——改一处影响全局。约定"模板只增不改"，需要阶段特化时在阶段仓库里覆盖。另外 `.env` 必须进 `.gitignore`，只提交 `.env.example` 作为填空模板。

---

## 四、与 Java 经验的对照

| Java 世界的经验 | 前端的对应关系 | 注意差异 |
| --- | --- | --- |
| Maven / Gradle | pnpm + Vite（依赖管理 + 构建生命周期） | pnpm 用硬链接 + 内容寻址，磁盘占用远小于 Maven 的本地仓库复制；`pnpm install` 类比 `mvn dependency:resolve` |
| Maven 中央仓库 | npm registry（registry.npmjs.org） | 无"中央 vs 私服"强制区分，私有包走 npm 组织或 Verdaccio；发布门槛低，好坏包都多 |
| `pom.xml` | `package.json` + `vite.config.ts` | `package.json` 管依赖与脚本，`vite.config.ts` 管构建行为；没有强类型 schema，易写错字段 |
| `mvn test` / JUnit | Vitest | Vitest 与 Vite **共享配置**，watch 极快；但默认不类型检查，需另跑 `tsc` |
| Checkstyle / SpotBugs | ESLint + TypeScript 类型检查 | ESLint 9 用 flat config（数组），不再是级联 `.eslintrc`；TS 7 下类型感知规则暂不可用 |
| 编译产物 jar / war | `dist/` 静态资源（HTML / CSS / JS） | 前端产物是**静态文件**，靠 CDN / 静态服务器托管，无 JVM 运行时 |
| 热部署 JRebel | HMR（模块级热更新，不刷新页面） | HMR 只换变更的模块，状态可保留；但规则复杂，偶尔需要手动刷新 |
| 多 module 工程 | pnpm workspace / monorepo | `pnpm-workspace.yaml` 声明包范围；跨包引用用 workspace 协议，无需发版 |
| CI（Jenkins / GitLab CI） | GitHub Actions 等 | 门禁思路一致：`install → lint → typecheck → test → build` |
| `git commit` 约定 | Conventional Commits + commitlint | 前缀语义化（`feat:` / `fix:`），可自动生成 changelog |
| JRebel / devtools | Vite Devtools（`devtools: true`） | Vite 8 新增，可视化模块图与预构建；`server.forwardConsole` 把浏览器日志转终端 |

---

## 五、实践练习

### 练习 1（必做）：从零搭建脚手架（4 小时）

**目标**：不靠 `pnpm create vite` 模板，从空目录手动创建每个文件，直到 `pnpm dev` / `build` / `preview` 全部跑通。

**步骤**：

1. 建空目录，手写 `package.json`（含 `"type": "module"`、`scripts`、`engines`）。
2. 手写 `vite.config.ts`（含 `react()` 插件、`resolve.tsconfigPaths`、vendor 分包、`devtools: true`）。
3. 手写 `tsconfig.json` + `tsconfig.node.json`（开启 `strict`）。
4. 手写 `eslint.config.js`、`index.html`、`src/main.tsx`、`src/vite-env.d.ts`。
5. `pnpm install && pnpm dev`，再 `pnpm build && pnpm preview` 验证。

**验收点**：三个命令全部跑通；能口头解释 `vite.config.ts` 每一行作用；整理成模板并写 `README.md` 说明配置取舍。

### 练习 2（必做）：质量三件套（3 小时）

**目标**：ESLint + Prettier + Vitest + Husky 全部生效。

**步骤**：

- ESLint 9 flat config：接入 TS、React Hooks 规则、import 排序（非类型感知规则）。
- Prettier + `prettier-plugin-tailwindcss`（预留给阶段 5）。
- Vitest：给阶段 2 的工具函数库写 **20 个单测，覆盖率 ≥ 80%**。
- Husky + lint-staged：提交前自动 lint + 格式化 + 类型检查。

**验收点**：故意写一个 `any` 和未使用变量，提交时被钩子拦下；`pnpm vitest run --coverage` 覆盖率达标。

### 练习 3（必做）：构建产物实验（3 小时）

**目标**：直观理解体积与分割。

**步骤**：

- 引入一个大依赖（如 `lodash-es` 或图表库），对比全量引入 vs 按需引入的产物体积（用 `rollup-plugin-visualizer` 看）。
- 用动态 `import()` 把某个模块拆成独立 chunk，验证浏览器 Network 面板里确实懒加载了。
- 配置 `rolldownOptions.output.codeSplitting` 把 `node_modules` 拆到 vendor chunk。
- 记录三组 `build` 耗时数据，[可选] 对比 Vite 7 或 `rolldown-vite`。

**验收点**：能指出体积大头来源；vendor chunk 独立且带哈希；懒加载 chunk 在 Network 里按需出现。

### 练习 4（进阶）：环境变量与多模式（2 小时）

**目标**：隔离不同环境的配置。

**步骤**：配置 `development` / `staging` / `production` 三套环境变量，写一个小页面显示当前模式与 API 地址；验证生产构建里**不会**打包进未暴露的变量。

**验收点**：`pnpm build --mode staging` 用 `.env.staging`；`grep` 确认无 `VITE_` 前缀的密钥不在 `dist/` 中。

### 练习 5（进阶）：Vitest 进阶（2 小时）

**目标**：掌握测试替身与计时控制。

**步骤**：为阶段 2 的事件总线写测试——`vi.useFakeTimers` 测防抖节流、`vi.mock` 模拟 fetch 失败、`vi.spyOn` 验证调用次数、快照测 DOM 结构。

**验收点**：6 个以上用例覆盖正常 / 边界 / 异常；`vi.mock` 用法正确（注意 hoisting）。

### 练习 6（挑战）：pnpm workspace 多包（3 小时）

**目标**：体验 monorepo。

**步骤**：搭一个 `packages/ui` + `packages/utils` + `apps/web` 的最小 monorepo，实现跨包引用（workspace 协议）与统一构建。

**验收点**：`apps/web` 能 `import` 到 `packages/ui` 与 `packages/utils` 的导出；根目录一次 `pnpm install` 装齐所有包。

---

## 六、常见坑与自查清单

### 高频坑

- **Node 版本不满足 20.19+ / 22.12+** → 升级 Node，用 `volta` / `fnm` / `nvm` 管理，避免 CI 与本机不一致。
- **旧教程的 `esbuild` / `rollupOptions` 配置"看着能用但行为变了"** → Vite 8 兼容层自动转换，优先用新选项（`rolldownOptions` / `resolve.tsconfigPaths`）。
- **环境变量没加 `VITE_` 前缀** → 客户端 `import.meta.env` 读不到，永远 `undefined`。
- **tsconfig 的 `paths` 配了但 Vite 不认** → 开 `resolve.tsconfigPaths: true`，或显式配 `resolve.alias`。
- **ESLint 与 Prettier 打架** → 明确分工，ESLint 关掉格式化类规则，Prettier 负责格式。
- **`tsc --noEmit` 与 Vite 构建的类型检查是两套** → CI 里两条都要跑，Vite 构建默认不查类型。
- **把密钥写进 `.env` 并提交** → 客户端产物等于公开，密钥走 CI Secret，绝不加 `VITE_` 前缀。
- **lockfile 不提交 / CI 不冻结** → 出现"队友能跑我跑不了"，CI 加 `--frozen-lockfile`。
- **`pnpm dev` 能跑就以为万事大吉** → 开发与生产态行为不同，提交前必跑 `pnpm build`。

### 自查清单

- [ ] 能从空目录手写出可运行的 Vite 8 + TS 7 项目（不靠 `create vite` 模板）
- [ ] 能解释 Rolldown / Oxc / Vite 三者的分工（打包器 / 转换压缩 / 开发服务器与编排）
- [ ] 能说清开发态"不打包、浏览器吃 ESM"、生产态"全量打包"的原因
- [ ] 会配置路径别名、环境变量、dev proxy、`devtools`
- [ ] ESLint + Prettier + Vitest + Husky 全部生效，提交能拦下坏代码
- [ ] 会用产物分析工具定位体积大头，并做过至少一次成功的分包优化
- [ ] 理解 `pnpm` 相比 `npm` 的核心差异（硬链接 + 内容寻址 + 严格 node-linker）
- [ ] 说明 TS 7 `strict` 默认开启、且无稳定编程式 API 对 lint 的影响
- [ ] 脚手架模板结构清晰，`README.md` 写明了每个配置的取舍

---

## 七、参考资料

- Vite 8 官方发布公告（2026-03-12）与迁移指南：`https://vite.dev/blog` / `https://vite.dev/guide/migration`
- Vite 官方文档：Config / Features / Build / Plugin API（`https://vite.dev`）
- Rolldown 文档（1.0 稳定，2026-05）：`https://rolldown.rs`
- Vitest 官方文档：`https://vitest.dev`
- ESLint 9 flat config 迁移指南：`https://eslint.org/docs/latest/use/configure/configuration-files`
- pnpm 官方文档（workspace / overrides / why）：`https://pnpm.io`
- TypeScript 7 变更说明（Corsa / strict 默认 / 移除 es5 等）：`https://devblogs.microsoft.com/typescript`
- 验证时间：2026-09；版本号与 `track.json` 的 `toolchain` 一致（Vite 8.0、TypeScript 7.0、Node 22.12+）。
