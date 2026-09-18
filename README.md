# learning-hub — From Java to X

> 面向 Java 工程师的第二语言学习轨道。
> 每条轨道 = 系统教程 + 可运行实战项目 + 与 Java 的对照。

[![CI](https://github.com/onceMisery/learning-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/onceMisery/learning-hub/actions/workflows/ci.yml)
[![Code](https://github.com/onceMisery/learning-hub/actions/workflows/verify-code.yml/badge.svg)](https://github.com/onceMisery/learning-hub/actions/workflows/verify-code.yml)
[![License: MIT](https://img.shields.io/badge/code-MIT-green.svg)](LICENSE)
[![License: CC BY 4.0](https://img.shields.io/badge/docs-CC%20BY%204.0-blue.svg)](LICENSE-CONTENT)

## 这是什么

如果你已经有几年的 Java 经验，想再学一门语言，你会发现大多数教程都在浪费你的时间：
它们花 30% 的篇幅讲「什么是变量」，却从不解释「为什么这门语言要这么设计」。

这个仓库的做法是：**站在 Java 的既有心智上做增量**。每条轨道都回答两个问题——

1. 这个概念在 Java 里是什么，在这门语言里变成了什么，为什么变了？
2. 写真实项目时，工程结构、错误处理、并发模型该怎么组织？

所以这里没有「Hello World 入门」，只有带可运行项目的完整学习路径，
以及一份别处很难找到的东西：**同一个概念在 Java / Rust / TypeScript / Go / Python 里的对照表**。

## 现有轨道

| 轨道 | 状态 | 内容 | 涉及技术 |
|---|---|---|---|
| [Rust](tracks/rust/) | 已发布 | 12 篇教程 + 2 附录 + minidb 九阶段实战 | Rust 1.98 · tokio · axum |
| [前端](tracks/frontend/) | 已发布 | 11 阶段路线图 + Lumen Kanban 实战 | TypeScript 7 · React 19 · Vite 8 · Tailwind 4 · Motion 13 · Dexie 4 · Electron 43 |
| [Go](tracks/golang/) | 规划中 | — | — |
| [Python](tracks/python/) | 规划中 | — | — |

想催更某条轨道，去 [Issues](../../issues) 提一个「新轨道提议」，或者直接点对应轨道页里的催更按钮。

## 快速开始

### 读文档

在线站点（推荐，两个地址内容相同，任选其一）：

| 平台 | 地址 |
|---|---|
| Vercel | <https://learning-hub-taupe-delta.vercel.app/> |
| GitHub Pages | <https://oncemisery.github.io/learning-hub/> |

两者吃同一份构建产物，只是 base 路径不同：Vercel 部署在根域名 `/`，
GitHub Pages 部署在子路径 `/learning-hub/`。部署细节见 [docs/部署说明.md](docs/部署说明.md)。

本地跑：

```bash
cd site
pnpm install
pnpm dev          # http://127.0.0.1:5173
```

`pnpm dev` 会先执行 `pnpm content` 生成内容，再启动 Vite。

### 跑实战项目

```bash
# Rust：KV 存储引擎 minidb
cd tracks/rust/projects/minidb
cargo test

# 前端：桌面看板 Lumen Kanban
cd tracks/frontend/projects/lumen-kanban
pnpm install
pnpm dev
```

## 仓库结构

```
learning-hub/
├── tracks/                 # 学习内容，一轨一目录
│   ├── _template/          # 新轨道脚手架
│   ├── frontend/
│   │   ├── track.json      # ★ 轨道清单：标题、顺序、状态、页面、源码白名单
│   │   ├── tutorial/       # 路线图文档
│   │   └── projects/       # 可运行实战项目
│   ├── rust/
│   ├── golang/
│   └── python/
├── site/                   # 站点（React 19 + Vite 8 + Tailwind 4 + Motion 13）
│   ├── scripts/            # ★ 构建期内容管道
│   └── src/
├── docs/                   # 仓库自身的元文档
└── .github/                # CI 与 Issue 模板
```

**关键约定**：`tracks/<id>/track.json` 是唯一的编排入口。站点在构建期扫描它，
自动生成路由、导航、搜索索引和源码白名单——**新增一条轨道不需要改任何站点代码**。

## 内容管道怎么工作

```
tracks/*/track.json
   │
   ├─ 发现    扫描目录，目录名即轨道 id（下划线开头视为模板）
   ├─ 校验    schema、slug 唯一性、源文件存在性
   ├─ 生成    Markdown → 结构化块；Shiki 构建期高亮
   ├─ 拆页    超长文档按 splitBy 正则切成多页
   ├─ 重写    站内链接 → 路由，图片 → public 资源
   └─ 索引    content/index.json + pages/*.json + search.json
```

生成物在 `site/public/content/`，已 gitignore，**不要手改**。

```bash
cd site
pnpm content     # 重新生成内容
pnpm check       # 内容体检（断链、配置、slug）
```

## 站点能力

- 双轨导航与全文搜索（自研 CJK 二元切分，中文可用）
- 代码高亮（Shiki 构建期双主题，浏览器零成本）、一键复制、长代码折叠
- `<SourceRef>`：文档内联引用仓库里的真实源码，可指定行区间或符号名
- 对照中心 `/compare`：按概念并列多种语言写法
- 学习进度与最近访问（localStorage，不上传）
- 亮 / 暗主题、响应式（桌面三栏 → 移动抽屉）、尊重 `prefers-reduced-motion`

## 许可证

**双层许可**，请按需遵守：

| 内容 | 许可证 | 文件 |
|---|---|---|
| 代码（`tracks/*/projects/**`、`site/**`） | MIT | [LICENSE](LICENSE) |
| 文档（`tracks/**/*.md`、`docs/**`） | CC BY 4.0 | [LICENSE-CONTENT](LICENSE-CONTENT) |

转载文档请署名并给出仓库链接。

## 贡献

欢迎纠错、补内容、提新轨道。请先读 [CONTRIBUTING.md](CONTRIBUTING.md) 与
[docs/新增一条轨道.md](docs/新增一条轨道.md)。

## 致谢

所有教程的视角来自一个共同的起点：一个写了多年 Java 的人，在学新语言时踩过的坑。
如果这些内容帮到了你，给仓库点个 star 就是最好的反馈。
