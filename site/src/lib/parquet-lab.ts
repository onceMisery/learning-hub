/**
 * 数据湖 · Parquet 互动原理实验室 · 章节数据（单一事实源）。
 *
 * 每章对应 tracks/parquet/tutorial/ 下的一篇文章与一个自包含 HTML 图解
 * （site/public/parquet-lab/<file>）。
 */

import type { LabChapter } from '@/lib/lab';

export const PARQUET_LAB = {
  trackId: 'parquet',
  title: 'Parquet 互动原理实验室',
  subtitle:
    '八章动态图解：从文件布局、footer 元数据树、Dremel 层级，到字典与 ALP、页索引与布隆过滤、模块加密、Variant 拆分与损坏边界。每页都能自动运转，也能按步骤定格。',
  route: '/parquet/lab',
  baseDir: 'parquet-lab',
  chapters: [
    {
      id: '01-file-layout',
      file: '01-file-layout.html',
      title: '文件布局',
      principle: '写是正向的，读是反向的；footer 是反向找路的起点',
      articleRoute: '/parquet/tutorial/01-file-layout',
      articleTitle: '文件布局与结构：一个查询只读三页，凭什么',
    },
    {
      id: '02-thrift-metadata',
      file: '02-thrift-metadata.html',
      title: '总目录',
      principle: '字段 id + 偏移：footer 是一棵按编号读的树',
      articleRoute: '/parquet/tutorial/02-thrift-metadata',
      articleTitle: 'Thrift 元数据定义：目录里到底写了什么',
    },
    {
      id: '03-data-model',
      file: '03-data-model.html',
      title: '数据模型与 Dremel',
      principle: 'def 说停在哪层，rep 说从哪层重复；NULL 只活在 level 里',
      articleRoute: '/parquet/tutorial/03-data-model',
      articleTitle: '数据模型：物理类型、逻辑注解与 Dremel 层级',
    },
    {
      id: '04-encoding-compression',
      file: '04-encoding-compression.html',
      title: '同类值排一起',
      principle: '编码改形状，压缩收体积；页头永远不压',
      articleRoute: '/parquet/tutorial/04-encoding-compression',
      articleTitle: '编码与压缩：同类值排在一起，才压得动',
    },
    {
      id: '05-optimization',
      file: '05-optimization.html',
      title: '先看小抄',
      principle: '统计说范围，布隆说等值，页索引说哪页；都只回答“一定不命中”',
      articleRoute: '/parquet/tutorial/05-optimization',
      articleTitle: '优化特性：先看小抄，再决定翻哪页',
    },
    {
      id: '06-security-extensibility',
      file: '06-encryption.html',
      title: '抽屉上锁',
      principle: '模块各自加密，AAD 各自定位；不匹配就不返回明文',
      articleRoute: '/parquet/tutorial/06-security-extensibility',
      articleTitle: '安全性与可扩展性：给每个抽屉单独上锁',
    },
    {
      id: '07-variant',
      file: '07-variant.html',
      title: '字典与热字段',
      principle: '字段名进字典，热字段进列；缺失和 null 必须分开',
      articleRoute: '/parquet/tutorial/07-variant',
      articleTitle: '半结构化数据：给 JSON 配一本字典和几张常用列',
    },
    {
      id: '08-recovery-config',
      file: '08-recovery-config.html',
      title: '恢复与配置',
      principle: '坏在哪层，损失停在哪层；RSS 不降，先分类再谈泄露',
      articleRoute: '/parquet/tutorial/08-recovery-config',
      articleTitle: '错误恢复与配置：坏在哪一层，损失到哪一层',
    },
  ] satisfies LabChapter[],
} as const;
