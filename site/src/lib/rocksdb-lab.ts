/**
 * 存储引擎 · RocksDB 互动原理实验室 · 章节数据（单一事实源）。
 *
 * 每章对应 tracks/rocksdb/tutorial/ 下的一篇文章与一个自包含 HTML 图解
 * （site/public/rocksdb-lab/<file>）。章节顺序与文章顺序一一对应，
 * 十二篇文章每篇都有一个可以点进去的实验室章节。
 */

import type { LabChapter } from '@/lib/lab';

export const ROCKSDB_LAB = {
  trackId: 'rocksdb',
  title: 'RocksDB 互动原理实验室',
  subtitle:
    '十二章动态图解：从一条 KV 的进来与出去、Memtable 与 WAL、读取合并，到压实三本账、SST 布局与块排版、Blob 安家、缓存分层与内存总账。每页都能自动运转，也能按步骤定格。',
  route: '/rocksdb/lab',
  baseDir: 'rocksdb-lab',
  chapters: [
    {
      id: '01-architecture',
      file: '01-architecture.html',
      title: '一条 KV 的一生',
      principle: '追加不覆盖：写入只进内存，盘上永远是不可变文件，收敛交给压实',
      articleRoute: '/rocksdb/overview/01-architecture',
      articleTitle: '架构概述：一条 KV 的进来与出去',
    },
    {
      id: '01-lsm-memtable',
      file: '01-lsm-memtable.html',
      title: '内存账本',
      principle: '跳表保序、Arena 批发内存；mutable 写满转 immutable，排队等 flush',
      articleRoute: '/rocksdb/engine/01-lsm-memtable',
      articleTitle: 'LSM Tree 与 Memtable：先把改动攒在内存里',
    },
    {
      id: '02-write-path-wal',
      file: '02-write-path-wal.html',
      title: '先记账再落账',
      principle: '组提交把并发小写合成一次 fsync；WAL 是崩溃后补回内存账的唯一凭据',
      articleRoute: '/rocksdb/engine/02-write-path-wal',
      articleTitle: '写入路径与 WAL：一次 Put 要过几道关',
    },
    {
      id: '03-read-path-iterator',
      file: '03-read-path-iterator.html',
      title: '从新到旧',
      principle: 'seq 全局单调 + 层间新旧不变式，先问的一定对；迭代器是小顶堆加 seq 过滤',
      articleRoute: '/rocksdb/engine/03-read-path-iterator',
      articleTitle: '读取路径与迭代器：从新到旧，一层一层问',
    },
    {
      id: '01-compaction-strategy',
      file: '01-compaction-strategy.html',
      title: '三本放大账',
      principle: '写放大、读放大、空间放大互相拉扯；选策略就是选把哪本账记大',
      articleRoute: '/rocksdb/compaction/01-compaction-strategy',
      articleTitle: '压实策略：Level、Universal、FIFO 三本账',
    },
    {
      id: '02-compaction-job-picker',
      file: '02-compaction-job-picker.html',
      title: '谁该搬怎么搬',
      principle: 'Picker 挑切口，Job 重写数据，VersionEdit 原子换账；trivial move 只换层不重写',
      articleRoute: '/rocksdb/compaction/02-compaction-job-picker',
      articleTitle: '压实任务与选择器：谁该搬、谁来搬、怎么搬',
    },
    {
      id: '01-sst-format',
      file: '01-sst-format.html',
      title: '磁盘有序账本',
      principle: '数据块在前、目录在后；footer 53 字节是整个文件唯一可靠的入口',
      articleRoute: '/rocksdb/storage/01-sst-format',
      articleTitle: 'SST 表格式：磁盘上的有序账本',
    },
    {
      id: '02-block-based-table',
      file: '02-block-based-table.html',
      title: '块里的排版',
      principle: '共享前缀加 restart point 让块内可二分；filter 与 index 都是先看小抄再翻页',
      articleRoute: '/rocksdb/storage/02-block-based-table',
      articleTitle: '基于块的表内部机制：把 SST 拆成一块一块',
    },
    {
      id: '03-blob-files',
      file: '03-blob-files.html',
      title: '大值单独安家',
      principle: 'SST 里只留 BlobIndex 指针；GC 按有效引用统计决定是否重写回收',
      articleRoute: '/rocksdb/storage/03-blob-files',
      articleTitle: 'Blob 文件存储：大值单独安家',
    },
    {
      id: '01-block-cache',
      file: '01-block-cache.html',
      title: '读过的块留下',
      principle: 'SST 不可变所以缓存键永不失效；分片 LRU 按优先级驱逐',
      articleRoute: '/rocksdb/cache/01-block-cache',
      articleTitle: '块缓存架构：读过的块留在内存里',
    },
    {
      id: '02-secondary-tiered-cache',
      file: '02-secondary-tiered-cache.html',
      title: '装不下去二级',
      principle: '驱逐时降级、命中时升舱；用压缩和 NVMe 换有效容量',
      articleRoute: '/rocksdb/cache/02-secondary-tiered-cache',
      articleTitle: '二级缓存与分层缓存：内存装不下的去哪',
    },
    {
      id: '03-memory-management',
      file: '03-memory-management.html',
      title: '内存都有账',
      principle: 'memtable、缓存、blob 三本账统一记账；超预算要么停写要么驱逐自己',
      articleRoute: '/rocksdb/cache/03-memory-management',
      articleTitle: '内存管理：每一块内存都要有人记账',
    },
  ] satisfies LabChapter[],
} as const;
