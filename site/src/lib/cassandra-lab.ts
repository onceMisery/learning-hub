/**
 * 分布式数据库 · Cassandra 互动原理实验室 · 章节数据（单一事实源）。
 *
 * 每章对应 tracks/cassandra/tutorial/ 下的一篇文章与一个自包含 HTML 图解
 * （site/public/cassandra-lab/<file>）。章节顺序与文章顺序一一对应，
 * 十五篇文章每篇都有一个可以点进去的实验室章节。
 */

import type { LabChapter } from '@/lib/lab';

export const CASSANDRA_LAB = {
  trackId: 'cassandra',
  title: 'Cassandra 互动原理实验室',
  subtitle:
    '十五章动态图解：从一行数据的进来与出去、提交日志与内存表、SSTable 与 Trie 格式，到 Gossip 传八卦、令牌环分数据、一致性协商、CQL 解析、读写流水线、SAI 索引、向量搜索、反熵修复与快照备份。每页都能自动运转，也能按步骤定格。',
  route: '/cassandra/lab',
  baseDir: 'cassandra-lab',
  chapters: [
    {
      id: '01-architecture',
      file: '01-architecture.html',
      title: '一行数据的一生',
      principle: '对等架构没有 master：谁接请求谁当协调者，按令牌环把行摊给副本',
      articleRoute: '/cassandra/overview/01-architecture',
      articleTitle: '架构概述：一行数据的进来与出去',
    },
    {
      id: '01-commitlog-memtable',
      file: '01-commitlog-memtable.html',
      title: '先记账再落内存',
      principle: '提交日志全体共享一段一段滚动；memtable 满了换新本，书签决定回放从哪开始',
      articleRoute: '/cassandra/engine/01-commitlog-memtable',
      articleTitle: '提交日志与内存表：先记账，再落内存',
    },
    {
      id: '02-sstable-compaction',
      file: '02-sstable-compaction.html',
      title: '不可变账本并账',
      principle: 'flush 出来的 SSTable 永不改写；压缩合并旧版本，墓碑要等 gc_grace 过线才敢丢',
      articleRoute: '/cassandra/engine/02-sstable-compaction',
      articleTitle: 'SSTable 与压缩：磁盘上的不可变账本',
    },
    {
      id: '03-trie-formats',
      file: '03-trie-formats.html',
      title: 'Trie 里的账页',
      principle: '共享前缀的 trie 让 memtable 省内存；盘上 BTI 用 PartitionIndex 逐字节导航分区',
      articleRoute: '/cassandra/engine/03-trie-formats',
      articleTitle: '基于 Trie 的存储格式：TrieMemtable 与 BTI',
    },
    {
      id: '04-gossip-failure-detection',
      file: '04-gossip-failure-detection.html',
      title: '八卦网与心跳',
      principle: 'Syn/Ack/Ack2 三轮对账把状态传遍全网；phi 值把「谁挂了」从猜测变成概率',
      articleRoute: '/cassandra/distributed/01-gossip-failure-detection',
      articleTitle: 'Gossip 与故障检测：八卦网怎么知道谁挂了',
    },
    {
      id: '05-partitioner-token-ring',
      file: '05-partitioner-token-ring.html',
      title: '令牌环分数据',
      principle: 'murmur3 把分区键变成环上一个点，顺时针走 RF 步就是这行数据的家',
      articleRoute: '/cassandra/distributed/02-partitioner-token-ring',
      articleTitle: '分区器与令牌环：一行数据摊给谁',
    },
    {
      id: '06-consistency-replication',
      file: '06-consistency-replication.html',
      title: '几个确认算数',
      principle: '一致性级别就是握手数：W+R>RF 才能读到新写；hint 替挂掉的副本垫付',
      articleRoute: '/cassandra/distributed/03-consistency-replication',
      articleTitle: '一致性与副本：三个副本几个确认',
    },
    {
      id: '07-cql3-parsing',
      file: '07-cql3-parsing.html',
      title: '一句 CQL 的旅程',
      principle: '词法语法两步走 AST，再按表结构绑类型校验，最后变成 Mutation 下发',
      articleRoute: '/cassandra/query/01-cql3-parsing',
      articleTitle: 'CQL3 解析与执行：从 CQL 到 Mutation',
    },
    {
      id: '08-native-protocol',
      file: '08-native-protocol.html',
      title: '线上字节形态',
      principle: '九字节帧头 + 压缩体：一条连接一个流，成百上千请求同管道不打架',
      articleRoute: '/cassandra/query/02-native-protocol',
      articleTitle: '原生协议传输：CQL 消息的线路形态',
    },
    {
      id: '09-read-write-paths',
      file: '09-read-write-paths.html',
      title: '协调者两条流水线',
      principle: '写等够票就走、读要拼时间戳；CL 读到的永远不比写确认的旧',
      articleRoute: '/cassandra/query/03-read-write-paths',
      articleTitle: '读写路径：Coordinator 的两条流水线',
    },
    {
      id: '10-sai',
      file: '10-sai.html',
      title: '索引跟着 SSTable 走',
      principle: '每个 SSTable 带一小份倒排索引，查询按位图交集定位行号，不用扫全表',
      articleRoute: '/cassandra/index/01-sai',
      articleTitle: '存储附着索引（SAI）：索引跟着 SSTable 走',
    },
    {
      id: '11-vector-ann',
      file: '11-vector-ann.html',
      title: '近邻搜索黑盒',
      principle: '向量分片建图索引，Top-K 用距离排序近似召回，精度换速度',
      articleRoute: '/cassandra/index/02-vector-ann',
      articleTitle: '向量搜索与 ANN：JVector 的近邻搜索',
    },
    {
      id: '12-repair-anti-entropy',
      file: '12-repair-anti-entropy.html',
      title: '副本悄悄不一致',
      principle: 'Merkle 树哈希对账定位差段只传差异；hint 垫付与读修复是日常补丁',
      articleRoute: '/cassandra/operations/01-repair-anti-entropy',
      articleTitle: '修复与反熵：Merkle 树、Hint 与读修复',
    },
    {
      id: '13-topology-lifecycle',
      file: '13-topology-lifecycle.html',
      title: '节点入列与离场',
      principle: 'bootstrap 先搬数据再上线，decommission 搬走才退场；流式传输不挡读写',
      articleRoute: '/cassandra/operations/02-topology-lifecycle',
      articleTitle: '拓扑变更与节点生命周期：入列与离场',
    },
    {
      id: '14-snapshot-backup',
      file: '14-snapshot-backup.html',
      title: '硬链接时光机',
      principle: '快照只是目录里几个硬链接：不复制数据就冻结此刻；恢复走 sstableloader',
      articleRoute: '/cassandra/operations/03-snapshot-backup',
      articleTitle: '快照与备份：硬链接的时光机',
    },
  ] satisfies LabChapter[],
} as const;
