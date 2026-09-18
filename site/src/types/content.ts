/**
 * 内容模型的唯一契约。
 *
 * 这份类型同时被 `scripts/build-content.ts`（构建期生产）与 `src/`（运行期消费）引用，
 * 任何字段变更都必须同步两边，避免「生成了但渲染不出来」的静默失败。
 */

/** 轨道状态：已发布 / 编写中 / 规划中 */
export type TrackStatus = 'active' | 'wip' | 'planned';

/** 轨道主题色，用于卡片、侧边栏与标签的着色 */
export type Accent = 'blue' | 'amber' | 'cyan' | 'green' | 'teal';

/** 目录项（TOC） */
export interface Heading {
  /** 锚点 id，由标题文本生成，稳定可引用 */
  id: string;
  /** 纯文本标题 */
  text: string;
  /** 标题层级：2 表示 h2 */
  depth: number;
}

/** 章节（一轨下的一个分组，例如「教程」「实战项目」） */
export interface SectionMeta {
  id: string;
  title: string;
  order: number;
  /** 该章节下的页面，已按 order 排序 */
  pages: PageMeta[];
  /** 实战项目名称（普通章节没有） */
  projectName?: string;
  /** 是否可独立 clone 运行 */
  standalone?: boolean;
  /** 项目根目录（相对 tracks/<id>/），用于「在仓库中查看」 */
  projectRoot?: string;
}

/** 页面元数据（不含正文，用于导航、搜索、上下篇） */
export interface PageMeta {
  /** 全局唯一 id：`${trackId}/${sectionId}/${slug}` */
  id: string;
  trackId: string;
  sectionId: string;
  /** 段内 slug，发布后冻结 */
  slug: string;
  /** 站内路由，例如 `/rust/tutorial/02-ownership` */
  route: string;
  title: string;
  /** 源 Markdown 相对仓库根的路径，用于「在 GitHub 编辑此页」 */
  sourceFile: string;
  tags: string[];
  /** 在所属章节内的序号，从 0 开始 */
  order: number;
  /** 长文拆页时存在 */
  part?: { index: number; total: number; label: string };
  /** 上一篇 / 下一篇的 id */
  prevId: string | null;
  nextId: string | null;
  /** 目录 */
  headings: Heading[];
  /** 去标记后的纯文本摘要，用于搜索与列表展示 */
  excerpt: string;
  wordCount: number;
  readingMinutes: number;
  /** git 最后提交时间（ISO 字符串），取不到时为 null */
  updatedAt: string | null;
}

/** 轨道元数据 */
export interface TrackMeta {
  id: string;
  title: string;
  subtitle: string;
  order: number;
  status: TrackStatus;
  accent: Accent;
  tags: string[];
  toolchain: string;
  verifiedAt: string;
  /** 规划中轨道的内容大纲 */
  outline: string[];
  sections: SectionMeta[];
  /** SourceRef 允许解析的源码根目录白名单（相对 tracks/<id>/） */
  codeRoots: string[];
}

/** 内容索引：站点启动后拉取的第一个文件 */
export interface ContentIndex {
  generatedAt: string;
  repoUrl: string;
  tracks: TrackMeta[];
  /** id -> 页面元数据 */
  pages: Record<string, PageMeta>;
  /** 标签聚合 */
  tags: { name: string; pageIds: string[] }[];
  stats: {
    tracks: number;
    pages: number;
    words: number;
    codeBlocks: number;
  };
}

/** 搜索索引条目（体积敏感，只保留必要字段） */
export interface SearchDoc {
  id: string;
  route: string;
  title: string;
  trackId: string;
  trackTitle: string;
  sectionTitle: string;
  headings: string[];
  /** 正文纯文本，已折叠空白 */
  text: string;
}

/* ------------------------------------------------------------------ */
/* 正文块模型                                                          */
/* ------------------------------------------------------------------ */

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'del'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: Inline[]; external: boolean }
  | { type: 'image'; src: string; alt: string }
  | { type: 'break' }
  /** 无法安全结构化的原始 HTML，渲染时按纯文本展示 */
  | { type: 'raw'; value: string };

export interface ListItem {
  checked: boolean | null;
  children: Inline[];
  /** 嵌套子列表 */
  nested: Block[] | null;
}

/** 多语言对照代码块的单个语言面板 */
export interface LangTabItem {
  /** 语言标识（java / ts / rust / go / python…） */
  lang: string;
  /** 标签上显示的名字 */
  label: string;
  /** 原始代码，用于复制 */
  code: string;
  /** 构建期用 Shiki 预渲染的高亮 HTML */
  html: string;
  lines: number;
}

export type Block =
  | { type: 'heading'; depth: number; id: string; inline: Inline[] }
  | { type: 'paragraph'; inline: Inline[] }
  | { type: 'code'; lang: string; code: string; html: string; lines: number }
  | { type: 'list'; ordered: boolean; items: ListItem[] }
  | { type: 'table'; align: (string | null)[]; header: Inline[][]; rows: Inline[][][] }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'divider' }
  | { type: 'image'; src: string; alt: string; title: string }
  /** 自定义组件：内联引用真实源码 */
  | {
      type: 'sourceRef';
      repo: string;
      file: string;
      lines: string | null;
      symbol: string | null;
      caption: string | null;
      code: string | null;
      /** 构建期用 Shiki 预渲染的高亮 HTML，避免把 Shiki 打进浏览器包 */
      html: string | null;
      lang: string;
      /** 解析失败原因，前端据此渲染提示而不是留白 */
      error: string | null;
    }
  /** 自定义组件：Java ↔ 目标语言对照表 */
  | { type: 'callout'; kind: 'info' | 'warn' | 'success' | 'danger'; title: string; blocks: Block[] }
  /**
   * 自定义组件：多语言语法对照。
   *
   * 同一段逻辑的多种语言实现放进一个可切换标签的代码块，
   * 避免在正文里堆叠五段长代码把页面撑爆。
   */
  | { type: 'langTabs'; title: string | null; items: LangTabItem[] };

/** 单个页面的完整数据（懒加载） */
export interface PageDocument {
  meta: PageMeta;
  blocks: Block[];
  /** 所属轨道信息，避免渲染时再查索引 */
  track: { id: string; title: string; accent: Accent; status: TrackStatus };
  section: { id: string; title: string };
}
