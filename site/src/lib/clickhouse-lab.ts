/**
 * 分析引擎 · ClickHouse 互动原理实验室 · 章节数据（单一事实源）。
 *
 * 每章对应 tracks/clickhouse/tutorial/ 下的一篇文章与一个自包含 HTML 图解
 * （site/public/clickhouse-lab/<file>）。章节顺序与文章顺序一一对应。
 */

import type { LabChapter } from '@/lib/lab';

export const CLICKHOUSE_LAB = {
  trackId: 'clickhouse',
  title: 'ClickHouse 互动原理实验室',
  subtitle:
    '十三章动态图解：从一条 SQL 的解析、计划与流水线，到 MergeTree part、副本共识、分布式两阶段聚合、外部存储、列式压缩、索引投影与 Keeper。每页都能自动运转，也能按步骤定格。',
  route: '/clickhouse/lab',
  baseDir: 'clickhouse-lab',
  chapters: [
    {
      id: '01-architecture',
      file: '01-architecture.html',
      title: '一条 SQL 的一生',
      principle: '先裁剪、再列读、再向量化：分区 → granule → 列，三层叠加才快',
      articleRoute: '/clickhouse/overview/01-architecture',
      articleTitle: '架构概述：一条分析 SQL 的进来与出去',
    },
    {
      id: '01-parser-ast',
      file: '02-parser-ast.html',
      title: '先把句子拆成树',
      principle: 'Lexer 切 token，递归下降 Parser 拼 AST；解析不管名字和类型',
      articleRoute: '/clickhouse/query/01-parser-ast',
      articleTitle: 'SQL 解析器与 AST：先把句子拆成树',
    },
    {
      id: '02-analyzer-optimizer',
      file: '02-analyzer-optimizer.html',
      title: '修成能执行的形状',
      principle: '绑定名字、推断类型、跑 Pass；下推/裁剪把工作挪早挪少',
      articleRoute: '/clickhouse/query/02-analyzer-optimizer',
      articleTitle: '查询分析器与优化器：把树修成能执行的形状',
    },
    {
      id: '03-plan-processors',
      file: '03-plan-processors.html',
      title: '从步骤树到流水线',
      principle: 'Plan 是步骤，Pipeline 是 Processor 图；Chunk 在 Port 间流动，背压天然',
      articleRoute: '/clickhouse/query/03-plan-processors',
      articleTitle: '查询计划与处理器执行：从步骤树到流水线',
    },
    {
      id: '01-mergetree-family',
      file: '04-mergetree-family.html',
      title: '不可变 part',
      principle: '写入只追加，更新/删除是 mutation；Replacing 只是最终一致',
      articleRoute: '/clickhouse/storage/01-mergetree-family',
      articleTitle: 'MergeTree 引擎家族：不可变 part 与后台合并',
    },
    {
      id: '02-replication-consensus',
      file: '05-replication-consensus.html',
      title: '副本怎么对齐',
      principle: '多主复制：共享 Keeper 操作日志，副本各自拉 part；quorum 可选',
      articleRoute: '/clickhouse/storage/02-replication-consensus',
      articleTitle: 'ReplicatedMergeTree 与共识机制：副本之间怎么对齐',
    },
    {
      id: '03-distributed-table',
      file: '06-distributed-table.html',
      title: '一条 SQL 打全集群',
      principle: 'Distributed 只路由不存储；分片部分聚合，发起节点再合并',
      articleRoute: '/clickhouse/storage/03-distributed-table',
      articleTitle: '分布式表引擎：一条查询如何打到整个集群',
    },
    {
      id: '04-external-storage',
      file: '07-external-storage.html',
      title: '不搬数据也能查',
      principle: '外部表解决能不能查，不解决查得快；网络/元数据/无索引是成本',
      articleRoute: '/clickhouse/storage/04-external-storage',
      articleTitle: '外部存储集成：不搬数据也能查',
    },
    {
      id: '01-columnar-storage',
      file: '08-columnar-storage.html',
      title: '只读三列',
      principle: '列文件只开需要的；索引决定读不读，mark 决定从哪读，压缩块决定解压多少',
      articleRoute: '/clickhouse/data/01-columnar-storage',
      articleTitle: '列式存储与压缩：只读三列，凭什么这么快',
    },
    {
      id: '02-data-types',
      file: '09-data-types.html',
      title: '内存里的列',
      principle: 'String 是 offsets+chars；Nullable 多 null map；LowCardinality 是字典+下标',
      articleRoute: '/clickhouse/data/02-data-types',
      articleTitle: '数据类型与列：内存里的列长什么样',
    },
    {
      id: '03-index-projection',
      file: '10-index-projection.html',
      title: '先看小抄再翻账',
      principle: '主键管前缀，skip index 管非前缀，projection 管另一种布局',
      articleRoute: '/clickhouse/data/03-index-projection',
      articleTitle: 'MergeTree 索引与投影：先看小抄，再翻账本',
    },
    {
      id: '01-keeper',
      file: '11-keeper.html',
      title: '集群的公共记事本',
      principle: 'Raft 日志先复制、状态机后执行；多数派丢失就停写',
      articleRoute: '/clickhouse/distributed/01-keeper',
      articleTitle: 'ClickHouse Keeper：集群的公共记事本',
    },
    {
      id: '02-cluster-replication',
      file: '12-cluster-fault-tolerance.html',
      title: '坏一台之后',
      principle: '副本挂切副本，分片挂默认失败，Keeper 少数派停写，分区不脑裂',
      articleRoute: '/clickhouse/distributed/02-cluster-replication',
      articleTitle: '集群拓扑、复制与容错：坏一台之后发生什么',
    },
  ] satisfies LabChapter[],
} as const;
