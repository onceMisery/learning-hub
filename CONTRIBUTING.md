# 贡献指南

感谢你愿意花时间改进这个仓库。为了让你第一次提交就顺利通过，请花五分钟读完这份文档。

## 一、可以贡献什么

| 类型 | 说明 | 门槛 |
|---|---|---|
| 纠错 | 错别字、失效链接、错误的版本号 | 最低，直接提 PR |
| 补充对照 | 在 `src/data/compare.ts` 里补 Go / Python 列 | 低 |
| 完善文档 | 给某篇教程补充「Java 怎么对应」的说明 | 中 |
| 新增轨道 | 新建 `tracks/<id>/` | 高，建议先开 Issue 讨论 |

## 二、本地环境

```bash
cd site
pnpm install
pnpm dev          # 自动先生成内容，再启动开发服务器
pnpm check        # 内容体检：断链 + 配置校验
pnpm typecheck    # TypeScript 检查
pnpm build        # 生产构建（含 check + content + typecheck）
```

Node 版本要求 **>= 22.12**。

## 三、改动内容（tracks/ 下的文档）

1. **直接改 `tracks/` 里的 Markdown**，不要改 `site/public/content/`——那是生成物，已 gitignore。
2. 如果**新增或删除**了一篇文档，同步修改对应 `tracks/<id>/track.json` 的 `pages` 数组，
   补上 `file`、`slug`、`title`、`tags`。
3. `slug` 一经发布即冻结。确需改名时，必须在 `site/public/_redirects` 登记旧地址到新地址的跳转。
4. 提交前跑一次 `pnpm check`，确认没有断链。

### Markdown 约定

- 围栏语言请写标准 id：`rust` / `java` / `typescript` / `bash` / `toml` / `json`。
  管道会自动归一化别名（`js` → `javascript`、`sh` → `bash`），但写标准值更好。
- 文件统一 UTF-8 无 BOM、LF 换行（仓库根目录有 `.editorconfig`）。
- 不要在文档里写本机绝对路径（如 `D:\code\...`），一律用相对仓库根的路径。<!-- lh-allow-abs-path -->
  `pnpm paths` 会拦截；文档里确实要举反例时，在该行或它的上一行加 `lh-allow-abs-path` 注释放行。
- 需要对照 Java 时用表格，这是本站内容的核心形态。

### 可用的自定义组件

```md
<!-- 内联引用仓库里的真实源码（路径须在 track.json 的 codeRoots 白名单内） -->
<SourceRef file="projects/minidb/src/stage5_wal.rs" lines="42-78" caption="WAL 追加写入" />
<SourceRef file="projects/minidb/src/engine.rs" symbol="pub fn get" />

<!-- 提示块：kind 可选 info / warn / success / danger -->
<Callout kind="warn" title="坑">
这里是内容，支持 Markdown。
</Callout>
```

`<SourceRef>` 解析失败（文件移动、不在白名单）时不会中断构建，
但会在页面上显示黄色提示，并在 `pnpm content` 时输出警告。

## 四、改动站点（site/ 下的代码）

- 类型定义在 `site/src/types/content.ts`，**构建脚本与前端共用**。
  改字段必须同时改生成侧与渲染侧。
- 组件用 React 19 + TypeScript，样式优先用 `src/styles/index.css` 里的设计令牌与语义类
  （`.lh-card` / `.lh-btn` / `.lh-chip` / `.lh-prose`），布局用 Tailwind 工具类。
- 动效只动 `transform` 和 `opacity`；时长三档 100 / 180 / 260ms；
  高频操作（搜索、正文切换）不加动画；全局已启用 `MotionConfig reducedMotion="user"`。
- 不要引入重型依赖。搜索是自己实现的（CJK 二元切分），代码高亮在构建期完成，
  这些都是为了把浏览器包控制在 ~140 KB gzip。

## 五、提交规范

提交信息用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
docs(rust): 补充生命周期省略规则
fix(site): 修复移动端抽屉无法关闭
feat(compare): 新增并发模型对照表
chore(deps): 升级 shiki 到 4.4.3
```

常用 type：`docs` / `feat` / `fix` / `refactor` / `chore` / `ci`。

## 六、PR 检查清单

- [ ] `pnpm build` 通过（含 check + typecheck）
- [ ] `pnpm check` 没有新的断链
- [ ] 没有引入本机绝对路径或个人敏感信息
- [ ] 新增文档已同步更新 `track.json`
- [ ] 截图等资源放在对应轨道的 `assets` 白名单目录内

## 七、行为准则

请保持友善与就事论事。技术分歧欢迎争论，人身攻击不接受。
有问题可以开 [Discussion](../../discussions)。
