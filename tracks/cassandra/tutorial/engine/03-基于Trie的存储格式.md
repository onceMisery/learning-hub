# 基于 Trie 的存储格式：TrieMemtable 与 BTI

再看一个做技术选型的现场。一位工程师在给写密集业务评估 Cassandra 5.0 的升级收益，release notes 里冒出两个新词：TrieMemtable、BTI（bti 格式）。他一头雾水：内存账本不就是那本跳表吗？SSTable 不就是那套 Data.db + Index.db 吗？换了名字的东西，到底换了什么、跟自己有什么关系？更让他不安的是监控里那笔「看不见的内存」：账本架越大，堆里给 Index 摘要留的空间就越可观。

这一章回答这两个新词。结论先行：**Cassandra 把「按字节序排布的前缀树（Trie）」同时塞进了账本的两端**——内存端，TrieMemtable 用一棵按字节步进的前缀树替代跳表，写路径少一层竞争、内存更省；盘上端，BTI 格式把主索引本身做成一棵落在磁盘上的 trie，打开一本 SSTable 不再需要把索引摘要搬进堆。两端的原理是同一棵树，学会一次用两处。

全章用 5 个分区键走完全程。它们来自 demo keyspace 里另一张时序表 events（监控数据，正好和 RocksDB 轨道的 device_47 遥相呼应）：

```text
贯穿全章的 5 个分区键（events 表，分区键是文本）：
device_12    device_47    device_5    device_51    device_6

按字节排序后的座次（'1'<'4'<'5'<'6'，短的在前）：
device_12 < device_47 < device_5 < device_51 < device_6

它们共享长前缀 "device_" ——这正是 trie 最省力的场景；
本章反复问一个问题：从这棵树里找 device_47，要走几步、读几页。
```

---

## 一、为什么要有 Trie：默认跳表账本的瓶颈在哪

先说清现状：默认的内存账本仍然是跳表。`MemtableParams` 里写死了默认工厂是 `SkipListMemtableFactory`（`schema/MemtableParams.java:98-100`），第 2 章的口径不变。跳表账本工作得很好，但它的结构决定了两个天然瓶颈：整本账是一张全局有序的 `ConcurrentSkipListMap`，每个分区是一棵独立的 BTree，写热点分区时多个线程挤同一个分区的锁上；账本本体和大量元数据散落在堆里，账本越大 GC 的扫动成本越高。

`conf/cassandra.yaml:826-834` 的官方注释把 TrieMemtable 的卖点列得很直白：**显著降低 GC 负载（更多元数据挪到堆外）、同样内存装更多数据、能扛住更高的写吞吐**；同时诚实地标注了代价——它是「分片 + 单写者」的实现，写入热点极度集中（比如绝大多数写都打在少数几个分区）时反而可能更差。TrieMemtable 的类文档一句话定位：改进内存占用、GC 效率与查找性能，论文出处都给好了（`db/memtable/TrieMemtable.java:81-90`）。

什么负载该动这个开关，官方注释给了正反两面清单：适合的是**键分布均匀、写入并发高、内存吃紧**的表——典型如监控、消息、会话这类时序数据；要三思的是写入高度倾斜的负载，以及老式二级索引（SAI 的内存索引结构自己管理，不依赖 memtable 形态，但 2i 的写模式历史上有偏）。选错了不会坏数据，只是白换——账本形态永远只是性能旋钮，不是正确性开关。

它的并发模型是「分而治之」：账本按 token 环切成若干分片，每片各自一棵 trie，**一片同一时刻只归一个写线程**、读却可以并发进行（`db/memtable/TrieMemtable.java:108-112` 的字段注释），分片数默认取 CPU 核数（`:87` 的配置说明）。写入时按分区键落进对应分片（`put` 里 `shards[boundaries.getShardForKey(key)]`，`:193-198`）；`limitsConcurrentWritesTo` 把这层约束说破——每个分片在自己的写锁下一次只进一笔更新（`:180-184`）。类比：跳表账本像**一个柜台一本总账**，谁都来记一笔、排队抢笔；TrieMemtable 是**按片分田**，每块田一次只有一个人耕，互不打扰，读的人随便看。

把两种瓶颈各具象一次，选型时就有判断依据了。跳表账本的成本藏在「热点分区」：一个被狂写的分区，所有并发写都要在它的那把锁上排队（分区级竞争），越热越堵；trie 账本的成本藏在「倾斜分片」：按 token 分片后，若绝大多数写恰好落在同一片，那片退化成单线程，其余分片干瞪眼。**分区级竞争换成了分片级竞争**——负载摊得开就赚（常见情况），砸在一个点上就亏（yaml 注释里那个「写集中极少数分区」的警告）。

```text
举例：同一批写入，两种账本各自记在哪
8 个写线程并发写 5 个分区（device_12/47/5/51/6）：
跳表：8 个线程全部挤进同一本总账；
      写同一分区的线程还要在这个分区的 BTree 锁上排队。
trie：先按 token 找分片——5 个分区大概率散在多个分片里；
      每个分片一次一个写者（TrieMemtable.java:182），
      8 个线程在分片间并行，同片内的写排队但跨片互不阻塞。
极端反例：8 个线程全写 device_47 → 无论哪种账本都串行——
账本结构救不了「一个分区被写爆」，那是数据建模的问题。
```

```text
举例：怎么把一张表切到 TrieMemtable（cassandra.yaml:841-848 + 表属性）
memtable:
  configurations:
    skiplist:
      class_name: SkipListMemtable
    trie:
      class_name: TrieMemtable
    default:
      inherits: skiplist        ← 默认仍是跳表（MemtableParams.java:99）

-- 只给 events 表换账本，别的表不动：
ALTER TABLE demo.events WITH memtable = 'trie';
没设 memtable 属性的表继续用 default（即 skiplist）——
这是「按表选账本」的口子，不是全局开关，灰度切换正好用它。
```

---

## 二、内存 Trie：按字节步进的前缀树

TrieMemtable 的核心数据结构是 `InMemoryTrie`（`db/tries/InMemoryTrie.java:48`），类注释给出两个关键事实：它为「单写线程 + 并发读」而生（`:46` 附近注释），以及它用 32 位指针，**整棵树有 2GB 的硬上限**（`:46`）——所以账本不会无限长，快到阈值就要封账换新树（`ALLOCATED_SIZE_THRESHOLD`，`:52-58`，默认给 2GB 留 10% 余量）。这也是为什么 TrieMemtable 是分片的：分片既分摊写竞争，也把每棵树的体量压在上限以内。

Trie 的玩法一句话：**键不再整体比较，而是拆成字节序列逐字节走**。按键的「字节序表示」（byte-ordered representation，TrieMemtable 用 OSS50 版的转换，`:103`）从根出发，每个字节选一条边，走完即达。节点只有五种：叶（带内容无孩子）、单边链、稀疏（2~6 个孩子）、分裂（更多孩子）、前缀（附带内容的增强节点）——定义在 `db/tries/InMemoryReadTrie.java:39-45`，数据全部躺在 32 字节一块的连续缓冲里（`:47-53`），对缓存和堆外分配都友好。

用贯穿案例把树画出来，前缀共享的好处一眼可见：

```text
举例：5 个分区键在 trie 里的样子（每步走一个字节）
根 ──d──e──v──i──c──e──_──┐
                          ├─1─2 → [device_12 的分区]
                          ├─4─7 → [device_47 的分区]
                          ├─5 ──┬─(完)→ [device_5 的分区]
                          │     └─1   → [device_51 的分区]
                          └─6   → [device_6 的分区]
公共前缀 "device_" 全部 5 个键只存一遍；
插入 device_52 时从根走到 device_5，再添一个字节 2 ——
已有的节点一个都不用动。
查 device_47：走 d-e-v-i-c-e-_-4-7 共 9 步，每步查一个字节；
查一个不存在的 device_99：走到 device_9 就断头，9 步内出局。
```

查找与插入的代价也照此算清。查一个键的步数 = 键的字节长度（内存树没有「层」的概念，一步一个字节）；插入一个新键的代价 = 从根走到分岔点再补叶子，沿途已有节点全部复用——5 个 device_* 键里，最长的独占路径只有两三个字节，其余全是共享。这正是类注释说「改进内存占用」的机制来源：**前缀共享把重复的键头折叠成一条路径**，键越规整（时序监控这类键名高度相似的负载）折得越狠。

对比跳表：跳表里 5 个键是 5 条独立的完整记录，查找靠多层索引二分逼近，比较的是「整个键」；trie 里前缀只存一份，查找的比较粒度是「一个字节」且步数上限就是键长。写入路径因此也变了：**插一个分区 = 沿途补几个节点**，而不同分区落在不同分片的树上，写与写互不相碰。

还剩一个机制细节值得点破：trie 里「按键有序」和「按字节序有序」是同一件事。Cassandra 在 4.0 之后给每种类型都配了「字节序表示」转换（整数按符号翻转、UUID 重排等），保证「无符号字节比大小」的结果和「类型比较器比大小」一致——这正是 `BYTE_COMPARABLE_VERSION = OSS50`（`db/memtable/TrieMemtable.java:103`）钉住的转换版本。于是 trie 天然就是有序结构：从根一路向左是所有更小的键，范围扫描、`floor`/`ceiling` 都能在树上直接走出来，不需要额外的排序层。内存树是这样，下一节的盘上索引也是这样——**字节序是贯穿两端的通用语**。

叶子上挂的是什么、树满了怎么办，两个收尾问题。叶子的载荷是分区的完整家当（`BTreePartitionData`：列数据、统计、删除信息），单分区请求直接在分片的树上走到底取货，范围扫描则走合并后的总树视图（`:114-121` 两个字段注释的分野）。树「满」不靠 fsync 感知：`InMemoryTrie` 快到 2GB 阈值时主动上报，TrieMemtable 请求 `switchMemtableIfCurrent` 封账——第 2 章「Memtable 满了封账」的判满方式在 trie 账本上换成了**树体量**这一把新尺子，flush 之后的流程（书签、回收）原封不动。

```text
举例：单分区读在 trie 账本上怎么走（SELECT * FROM events WHERE device='device_47'）
① 按分区键算 token → 定位分片（put 与读同一条分片规则）
② 在分片的 trie 里按字节步进：d-e-v-i-c-e-_-4-7 → 到达叶子
③ 叶子载荷即分区数据（BTreePartitionData）→ 按列过滤返回
读与写并发：写者在树上补节点，读者走的路径要么在写前、要么在写后，
不存在「读到一半的节点」——单写者纪律就是为此定做的。
```

---

## 三、BTI：把同一棵树印到盘上当主索引

内存里会走 trie 之后，盘上这半就顺理成章了。BTI（**Big Trie-Indexed**）是 5.0 引入的新 SSTable 格式（CEP-25，`io/sstable/format/bti/BtiFormat.java:58-61` 的类注释与 `io/sstable/format/bti/BtiFormat.java:290-295` 的版本注释：da 对应 5.0），名字本身就交代了血统：**它和 big 格式共用同一套数据文件，只把主索引换成了 trie**。`io/sstable/format/bti/PartitionIndex.java:57-69` 的类注释给出定义：盘上的 trie，把「分区键的唯一前缀」映射到两种去处之一——行索引位置，或小分区直接指到数据文件位置；载荷里还捎带键哈希的低位，用于不开文件就排除错配。两个去处用符号位区分（正数 = 行索引位置，按位取反 = 直达数据）。

内存树怎么变成盘上树？flush 时 `PartitionIndexBuilder` 拿着**排好序的键流**增量建树：每写完一个键再写下一个，用「和前一个键、后一个键的最短区分前缀」决定真正落盘的字节（`io/sstable/format/bti/PartitionIndexBuilder.java:34-36` 的类注释即此定位），树自底向上、按页写进 Partitions.db。写入方与读取方一一对应：`BtiTableWriter`（`io/sstable/format/bti/BtiTableWriter.java:61-65`）产出、`BtiTableReader`（`io/sstable/format/bti/BtiTableReader.java:70-75`）消费。第 3 章那句「打开一本账」在 bti 里的对应物因此极轻——不装摘要、不建堆内索引结构，只是把文件挂上页缓存。

文件清单也随之变化。big 格式的 Index.db + Summary.db 双索引，在 bti 里换成了 Partitions.db（分区索引，`io/sstable/format/bti/BtiFormat.java:75`）+ Rows.db（行索引，`:76`）；**Summary.db 整个消失了**——打开时需要生成的组件只剩布隆过滤器（`:111` 的 `GENERATED_ON_LOAD_COMPONENTS` 只有 FILTER）。分区内依然有行级索引，但它也是 trie：`RowIndexReader` 把行按块（默认 16KB）索引，查找时在 trie 里找「最接近且不越过目标键」的块起点（`io/sstable/format/bti/RowIndexReader.java:38-50`）；块粒度本身是格式的默认值——big 是 64KB，bti 是 16KB（`io/sstable/format/bti/BtiFormatPartitionWriter.java:41` 对比 `io/sstable/format/big/BigFormatPartitionWriter.java:49`，`conf/cassandra.yaml:1245` 的注释写明两档）。

行索引这块有个小设计值得单独看一眼：块与块之间存的不是「块内第一行的键」，而是一个**分隔符**——比上一块最后一行大、又不超过下一块第一行的最短前缀（`io/sstable/format/bti/BtiFormat.md` 的 Row index 一节给了例子：两块分别覆盖 something~somewhere 与 sorry~tease，分隔符只存 "son"）。这样行 trie 的每条路径都短到几个字节，代价是偶尔会定位到一个「实际不含目标行」的块，多顺序扫一小段——用一点虚警换索引的紧凑，和第 3 章布隆过滤器「宁可白跑一趟、不可漏掉真账」是同一种折中。

盘上 trie 还有两项为磁盘精打细算的设计。其一，**唯一前缀压缩**：索引里的键只存「能与前后键区分开的最短前缀」，官方文档给的量级是节点数降到约 2n（n 为键数，`io/sstable/format/bti/BtiFormat.md` 的 Trimming the fat 一节）；对哈希分布的分区键，查找复杂度是 O(log n) 次跳转。其二，**按页打包**：节点自底向上装进 4096 字节的页，保证「站在一个节点上，读完它的所有数据不用换页」（BtiFormat.md 的 Taking hardware into account 一节；`io/sstable/format/bti/BtiFormat.md:913-924` 的文件布局：一页页节点块 + 文件尾三个 long 定位根节点）。查找一个分区就是：从根逐字节导航，跳转大多落在已缓存的非叶页里，最后取一次叶页。

两套格式的账本「长相」对一遍，很多差异不用背就记住了：

```text
举例：同一本账，big 与 bti 的组件文件清单（对照第 3 章第二节）
big（nb-*）                    bti（da-*）
├── Data.db        正文        ├── Data.db        正文（同一套数据格式）
├── Index.db       主索引      ├── Partitions.db  分区 trie（PartitionIndex）
├── Summary.db     堆内书签    ├── Rows.db        行 trie（RowIndexReader）
├── Filter.db      布隆        ├── Filter.db      布隆（打开时可能重建）
├── Statistics.db  统计        ├── Statistics.db  统计
└── TOC.txt        目录        └── TOC.txt        目录
差别全在索引两行：big 的 Index+Summary 双层抽样式索引，
换成了 bti 的 Partitions+Rows 双 trie；Summary 一栏在 bti 里不存在。
Data.db 的内容两种格式相同——所以 bti 叫 Big "Trie-Indexed"。
```

```text
举例：在 BTI 的 Partitions.db 里找 device_47（贯穿案例）
① 读文件尾 3 个 long：最小/最大键位置、键数、根节点位置
   （PartitionIndex.load 只做这件事，PartitionIndex.java:199-215）
② 从根出发逐字节走：d→e→v→i→c→e→_→4→7（哈希分布的键走 O(log n) 步）
③ 叶子读 payload：一个带符号位的位置 + 键哈希低位比对
④ 位置指到 Rows.db 的行索引页（或小分区直达 Data.db），
   首字节就是完整的 device_47，比对确认 → 开始读行
非叶页常驻页缓存，命中的随机读只有「叶页 + 数据页」两次。
```

---

## 四、版本谱系与默认值：big 还是 bti

先泼一盆冷静的冷水：**7.0 master 的出厂默认格式仍然是 big**。配置字段 `selected_format` 的默认值是 `BigFormat.NAME`（`config/Config.java:458`），`conf/cassandra.yaml:1222-1230` 的注释同样写明「默认格式是 big……5.0 起也支持性能更好的 bti」。想用 BTI 要显式改 yaml 的 `sstable.selected_format: bti`——它影响的是**新建的 SSTable**，已有账本不会被自动重写，切换后靠压缩/升级逐步换血。

版本字母表也值得对一遍，免得读文件名发懵。big 的版本从 ma（3.0）一路排到 pa（6.0），注释写在 `BigVersion` 里（`io/sstable/format/big/BigFormat.java:440-452`）；在默认的存储兼容模式 NONE 下新写出的账本就是 pa（`:436-437` 的 current_version 逻辑）。bti 的字母表独立：da（5.0 初版）到 ea（6.0，加压缩字典元数据，`io/sstable/format/bti/BtiFormat.java:290-295`）。所以第一节例子里的 `nb-1-big-Data.db` 与本章的 `da-…-Partitions.db`，前缀字母就是「格式内版本」。

```text
举例：版本字母速查（写文件名时对号入座）
big：ma/mb/me（3.0 系）→ na/nb（4.0 系）→ oa（5.0）→ pa（6.0）
     默认兼容模式 NONE 下新写 = pa（BigFormat.java:436-437）
bti：da（5.0 初版）→ ea（6.0 加压缩字典元数据）
     （BtiFormat.java:290-295）
兼容性规则两边一致：能读「最早支持版本」以后的所有账本，
但 streaming 只在「同首字母」（同一大版本）之间进行。
```

切换格式是运维动作而不是重启魔法。改 `sstable.selected_format: bti` 后，**已有的 pa-big 账本原样躺在盘上继续读**——读取路径认格式认版本，新旧混存毫无问题；此后所有新 flush 与新压缩的产出才是 bti。想让存量账本尽快换血，走 `nodetool upgradesstables`（`service/StorageService.java:2787` 起）：它把旧格式账本逐本重写成当前格式，代价等于一轮全量压缩，适合低峰期分批做。反过来也要提醒：**bti 切回 big 同理**，且 mixed-version 集群 streaming 时两边的格式兼容性要一起看。

```text
举例：一次格式切换的验收清单（node2 的 events 表）
1. 改 yaml：sstable.selected_format: bti → 重启
2. 新 flush 的账本文件名前缀变成 da-…-Partitions.db（不再是 nb-…-Index.db）
3. 存量 pa-big 账本原样在架，读路径两种格式混问——List SSTables 里两代并存
4. 低峰期 nodetool upgradesstables demo events：旧账逐本重写成 bti
5. 观察两笔账：堆内存（Summary 摘要那笔应见底）与点查延迟（冷读页缓存命中）
注意第 3 步：读路径对格式无感，读写服务不因切换而中断——
「账本换代不停业」靠的还是第 3 章那条不可变纪律。
```

最后一个问题用推演算一笔账（量级估算，非实测）：同一批 **1000 万个分区键**，两种格式的主索引各长什么样？

```text
举例：1000 万分区键的主索引对比（按源码注释量级推演，非实测数字）
big 格式：
  Index.db 每个键一条完整条目（键序列化 + 位置 + 元数据，约几十字节/条）
  → 约数百 MB；点查走 Index.db 二分（BigTableReader.java:313）
  打开账本时把 Summary（1/128 抽样，min_index_interval=128，
  schema/TableParams.java:450）装进堆内存 → 千万键级摘要可观，
  且受 index_summary_capacity 预算约束（conf/cassandra.yaml:1000）
bti 格式：
  Partitions.db 只存唯一前缀 + 变长指针，节点约 2n 个、每节点几字节
  → 量级缩到数十 MB；打开账本只读 3 个 long，索引本体不进堆，
  走页缓存按需取页（PartitionIndex.java:199-215）
读 I/O：big = 摘要定位 + Index.db 数页二分；bti = O(log n) 步跳转
（非叶页大概率已在页缓存）+ 一次叶页。冷账本上两者各有一本账，
热账本上 bti 的省堆是结构性优势——这正是官方注释推荐 BTI 的理由。
```

再把「查找 I/O 的次数」摆到同一张桌上（同样按文档定性 + 推演）。点查 device_47，big 的账本链是：布隆（内存）→ Summary（堆内，定位 Index.db 的一段）→ Index.db 数页二分 → Data.db；bti 的链是：布隆 → 根页起 O(log n) 步字节导航（哈希键千万级约二三十步，全部发生在少数几个页内）→ 叶页 payload → 确认键、跳数据。两者的**随机 I/O 次数**在命中场景下大致同档（官方文档特意声明「不劣于旧实现」），真正拉开的是**内存足迹**与**冷读的确定性**：bti 的非叶页规模小而稳定，页缓存装得下；big 的 Index.db 二分在摘要被压缩取样后可能多读几页。选型时别被「查找更快」带偏——BTI 的第一红利是把「打开账本」的堆账单砍掉了。

---

## 五、和 RocksDB 摆在一起看：索引与账本的组织

| 维度 | RocksDB | Cassandra |
| --- | --- | --- |
| 内存账本 | 固定一款：跳表（memtable） | 可选：SkipListMemtable（默认）/ TrieMemtable（按表切换，`schema/MemtableParams.java:99`） |
| 盘上主索引 | BlockBasedTable：分区索引 + 二分（partitioned index 可选） | big：Index.db 抽样摘要 + 二分；bti：全 trie 逐字节导航 |
| 索引在堆里的代价 | 索引与布隆常驻块缓存/内存，可调 partitioned index 收敛 | big 的 Summary 按预算进堆（index_summary_capacity）；bti 根本没有 Summary，索引只走页缓存 |
| 前缀压缩 | 前缀布隆过滤器省布隆空间；索引键不压缩 | 索引只存区分前后键的最短前缀，节点约 2n（BtiFormat.md） |
| 分区内行定位 | 索引块内二分 | 行级 trie（Rows.db），块粒度 big 64KB / bti 16KB |
| 打开一本文件的代价 | 读 footer + 装索引元数据，随文件数线性占内存 | big 装 Summary；bti 只读 3 个 long，冷启动堆占用近零 |

两边的取舍可以并成一句话：**RocksDB 把「打开文件的内存代价」摊给一个常驻的块缓存预算，Cassandra 在 big 上把它摊给 Summary 堆预算、在 bti 上直接选择不付**。账本端则镜像了同一个思想的两半：RocksDB 的 memtable 是写死的跳表，省的是选择成本；Cassandra 把跳表和 trie 摆成两个选项，让热点倾斜、GC 压力这类负载特征来投票。还有一层隐含的对照：RocksDB 的 partitioned index 是「把大索引切成小块、按需装载」的改良主义，BTI 则是「把索引换成另一种数据结构」的推倒重来——前者在既有格式里修补，后者连同版本字母表一起换代。

把「打开 2 万本 SSTable 的冷启动」具体化，差别就不再是形容词。big 每本账要装一份 Summary 摘要（1/128 抽样、受 `index_summary_capacity` 总预算约束，装不下时压缩摘要、点查多问几页），2 万本账的摘要占用是一笔持续在册的堆内存，重启后还要重新装载；bti 每本账打开只读 3 个 long，索引页按需进页缓存——**不查就几乎不占**，代价摊到了每一次真实查询的页缓存命中上。RocksDB 介于两者之间：索引与布隆放在可配置的块缓存里，partitioned index 再把「整本索引常驻」细化为「上层索引常驻、下层按需」——三套系统在同一个问题上各画了一条不同的预算线。

账本端的对照还可以再细一层。RocksDB 的跳表把「每条写入一次全键比较 + 多层指针」的固定成本写在结构里；Cassandra 的 TrieMemtable 把同一笔成本拆成「逐字节步进 + 分片单写」——比较粒度更细、并发模型更激进，也因此多了「倾斜负载退化」这条后顾之忧。两边没有谁全面胜出：RocksDB 用单一设计兜住所有负载，Cassandra 用可选设计让负载自己认领——这一章的两个新词，本质上都是把「一个默认」升级成「一道选择题」的开端。

---

## 这一章留下的线索

- **账本两端共用同一棵树**：内存端 TrieMemtable 按字节步进、前缀共享、分片单写；盘上端 BTI 把主索引做成落盘 trie——学一次用两处；
- **默认仍是旧的**：内存账本默认 SkipListMemtable（`schema/MemtableParams.java:99`），盘上格式默认 big（`config/Config.java:458`）；TrieMemtable 靠 yaml 定义 + 表属性 `memtable` 按表启用，bti 靠 `sstable.selected_format` 切换且只影响新账本；
- **BTI 省的是「打开的堆」**：没有 Summary.db，打开一本账只读文件尾 3 个 long；索引本体躺在页缓存里按需取页，非叶页常驻；
- ** Trie 的本钱是前缀**：5 个 device_* 键共享的 "device_" 只存一遍，节点约 2n；代价是键分布倾斜时（前缀高度重合）树反而变深——分片数默认 CPU 核数，单分片一次一个写者；
- **版本字母会读**：big 的 ma→pa、bti 的 da→ea，文件名前缀就是格式内版本；NONE 兼容模式下新写 big 账本是 pa。

下一章离开单机存储引擎，去看 Cassandra 的另一半骨架：节点之间不打招呼怎么互相认识、谁挂了谁第一个知道——[Gossip 与故障检测：八卦网怎么知道谁挂了](../distributed/01-Gossip与故障检测.md)。

---

## 附：这一章的源码入口

> 除特别注明外，本节引用的源码文件与行号都来自 apache/cassandra 主分支（7.0-SNAPSHOT，2026-08）。

- `schema/MemtableParams.java:98-100`：默认 memtable 工厂仍是 SkipListMemtableFactory
- `conf/cassandra.yaml:826-834、841-848`：TrieMemtable 的卖点/代价注释与 memtable.configurations 定义（skiplist/trie/default）
- `db/memtable/TrieMemtable.java:81-91、100、103、108-121、180-198`：类定位与论文、键长递归阈值、字节序版本、分片字段、单写锁注释与 put 落片
- `db/tries/InMemoryTrie.java:46-58`：单写多读模型、2GB 硬上限与封账阈值
- `db/tries/InMemoryReadTrie.java:36-53`：五种节点类型与 32 字节块布局
- `io/sstable/format/bti/BtiFormat.java:58-76、101-111、290-295`：CEP-25 定位、Partitions.db/Rows.db 组件、无 Summary、版本 da/ea
- `io/sstable/format/bti/PartitionIndex.java:57-71、199-215`：唯一前缀映射、符号位 payload、打开只读 footer；`io/sstable/format/bti/BtiFormat.md:913-924`：Partitions.db 的按页布局与文件尾三个 long
- `io/sstable/format/bti/RowIndexReader.java:38-50`：分区内行级 trie 的定位与线程模型
- `io/sstable/format/bti/BtiFormatPartitionWriter.java:41` 与 `io/sstable/format/big/BigFormatPartitionWriter.java:49`：行索引块粒度 16KB 与 64KB；`conf/cassandra.yaml:1245`：两档粒度的官方注释
- `io/sstable/format/big/BigFormat.java:76-84、436-452`：Summary 职责与 big 版本谱系 ma→pa；`config/Config.java:458` 与 `conf/cassandra.yaml:1222-1230`：默认 selected_format=big
- `io/sstable/format/big/BigTableReader.java:313`：big 索引二分查找；`schema/TableParams.java:450`：min_index_interval=128；`conf/cassandra.yaml:1000`：index_summary_capacity 仅对 big 类格式生效
- `io/sstable/format/bti/BtiTableWriter.java:61-65`、`io/sstable/format/bti/BtiTableReader.java:70-75`、`io/sstable/format/bti/PartitionIndexBuilder.java:34-36`：BTI 写/读/建三方入口（本章仅作导览，未逐行展开）

---

## 思考题

1. 把 demo.events 切到 TrieMemtable 后，压测发现写吞吐反而下降。负载报告显示 80% 的写集中在 device_47 一个分区上——这戳中了 TrieMemtable 的哪个设计前提？（提示：分片单写者，`db/memtable/TrieMemtable.java:180-184`。）
2. device_12 / device_47 / device_5 / device_51 / device_6 五个键共享前缀 "device_"，节点很省。若换成 500 万个形如 `device_<随机 UUID>` 的键，前缀共享还剩多少？这解释了 BTI 文档为什么强调「哈希分布的键查找是 O(log n) 步跳转」。
3. big 格式打开一本 SSTable 要装 Summary 进堆，bti 只要读 3 个 long。一个有 2 万本 SSTable 的节点，两种格式冷启动的堆占用差在哪？这跟 `index_summary_capacity`（yaml:1000）有什么关系？
4. 默认 selected_format 仍是 big（Config.java:458）。如果直接把节点 yaml 改成 bti 再重启，**已有**的 pa-big 账本会被重写吗？新 flush 的账本是什么格式、文件名前缀会变成什么？（提示：切换只影响新建，旧账靠压缩换血。）
