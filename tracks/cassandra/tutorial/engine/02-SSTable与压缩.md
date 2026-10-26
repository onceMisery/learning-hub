# SSTable 与压缩：磁盘上的不可变账本

再看一个值班现场的误会。运维接手 Cassandra 集群的第一周，盯着 `nodetool compactionstats` 发毛：压缩任务列表永远有活，pending 长期不为零；磁盘占用一度冲到数据量的两倍；更要命的是，上周删掉的一批数据，`du` 里看 SSTable 的个头根本没变小。他把这三件事打包成工单报上去：「压缩风暴、磁盘泄漏、删除失效」，怀疑集群出了大问题。

三件事都是正常的。根源在 Cassandra 存储引擎的根本工作方式：**磁盘上的账本（SSTable）一旦写完就不再改动，一切修改都发生在新账本里**。更新是追加新版本，删除是追加墓碑，所以「同一行数据在盘上有多份痕迹」「合并期间新旧账本同时占盘」「删除要等很久才真正释放空间」是这套设计的固有形态，而不是故障。收拾这一切的后台工序叫 compaction（压缩/并账）——注意它不是 LZ4 那种「压缩文件体积」的压缩，而是把多本不可变账本**合并收敛**的并账。看懂它，上面三个「故障」会翻转成三个特性：写入永远不等旧账、合并期间读写照常、删除永远给故障恢复留足时间。

全章接着第 2 章的现场走。node2 的 users 表又来了两次写、一次删：

```text
贯穿全章的账本状态（node2，接着第 2 章 SSTable-00001 之后）：
t1  INSERT id=47 name='阿福'  age=31   ts=1001  → 已随第 2 章的 flush 落进 SSTable-00001
t2  UPDATE id=47 name='阿福2'          ts=1005  → 同上（SSTable-00001）
t3  UPDATE id=47 age=32                ts=3002  → 新 Memtable 满 → flush 成 SSTable-00002
t4  DELETE FROM users WHERE id=47;     ts=4008  → 墓碑 → flush 成 SSTable-00003

此刻 id=47 在磁盘上有 4 份痕迹，散在 3 本账里：
SSTable-00001：ts=1001 与 ts=1005 两个旧版本（混着 id=48 等别的行）
SSTable-00002：ts=3002 第三版
SSTable-00003：ts=4008 的删除墓碑
读取要问 3 本账才能拼出「这行已删除」的结论；压缩的终点是把 4 份痕迹收敛成 0 份。
```

---

## 一、SSTable：写完即封账的不可变账本

SSTable（Sorted String Table）是 Memtable flush 的产物：内存账攒满，`switchMemtable` 封账换新账（第 2 章讲过的交接点），后台线程把封住的旧账**按键有序地整本写成一个磁盘文件组**。写的过程只有追加，没有回头改——所以 flush 期间崩了，最多留下一本写了一半的废账，扔掉重 flush 即可，绝不会污染旧数据。

「不可变」是这套引擎的第一纪律。文件写完之后，磁盘上没有任何代码路径会去改它的一个字节：更新不会，删除也不会。类比一下：**每本 SSTable 是一版印刷装订好的书，印完绝不再改版；所有勘误都靠印新书**。读者手里的最新事实 = 把所有版本的书按出版顺序倒着翻，谁的内容时间戳新谁算数。这个纪律换来的东西在第 1 章已经出现过：读的人不需要加锁（账本永远只读）、缓存可以放心缓存（内容永不失效）、flush 可以随便并发（各写各的新文件）。

封账与写盘之间还有一个交接细节值得钉住：**新账本的下界就是旧账本的上界**。封账那一刻，新写入全部改走新 Memtable，被封的旧账从此只读；flush 线程把它原样誊成 SSTable。若中途崩溃，已封未 flush 的账本由 CommitLog 回放重建（第 2 章），誊到一半的半成品文件直接作废——旧账还在内存里重新誊一遍就是，磁盘上没有任何「写了一半的正确数据」需要修补。

```text
举例：崩溃发生在 flush 中途，账本世界是什么样
t3  Memtable-A 封账，flush 线程开始写 SSTable-00002（nb-2-*）
t4  写到 60%，node2 掉电
重启后：
├── nb-2-* 的半成品文件被启动检查直接清理，当作没存在过
├── Memtable-A 的内容还在 CommitLog 段里（书签没夹上）→ 回放重建
└── SSTable-00001 完好无损——它从头到尾没被碰过一个字节
不可变纪律让「崩溃恢复」退化为「把没誊完的账重新誊一遍」，
不存在任何需要修复的中间状态。
```

账本的身份信息全写在文件名里。`Descriptor`（`io/sstable/Descriptor.java:56`）的注释把命名拆成三件事：keyspace、表名和一个递增的 id（generation，id 越大数据越新）。所以第 2 章那本 SSTable-00001 的真身是一组文件，共享同一个 id 前缀：

```text
举例：t3、t4 两次 flush 之后，node2 的 users 表目录
/var/lib/cassandra/data/demo/users-<hash>/
├── nb-1-big-Data.db       ← 数据本体（「nb」是 big 格式的版本号，见第二节）
├── nb-1-big-Index.db      ← 分区键 → 数据位置的主索引
├── nb-1-big-Summary.db    ← 索引的抽样摘要（进堆内存，见第二节）
├── nb-1-big-Filter.db     ← 布隆过滤器：先答「这本账里有没有 id=47」
├── nb-1-big-Statistics.db ← 统计信息：最小/最大时间戳、列统计、压缩元数据
├── nb-1-big-TOC.txt       ← 目录清单：这本账一共有哪几个组件文件
└── nb-2-big-Data.db ...   ← t3 flush 出的第二本，id=2 > id=1，更新
```

同一行数据的多个版本跨账共存，是「谁的版本新」由时间戳裁决（第 1 章读拼接的老规矩）在磁盘上的延续。**座次即新旧**：id 大的账比 id 小的账新，账内时间戳大的 cell 比 cell 旧——读和压缩都按这套座次工作。

```text
举例：两本账两个事实，谁算数
SSTable-00001：id=47 → name='阿福'  (ts=1001)
SSTable-00002：id=47 → age=32       (ts=3002)
问 name？两本里只有 00001 有 name 这个 cell → 答案是「阿福」
问 age？  00001 里 age=31 (ts=1001)、00002 里 age=32 (ts=3002) → 按 cell 时间戳取 32
「更新」从来不是覆盖一行，而是新账里多一个时间戳更新的 cell；
哪本账有哪个 cell、时间戳多少，决定了读时怎么拼、压缩时谁留谁走。
```

---

## 二、一本 SSTable 的一套文件：组件清单与开门过程

「一本 SSTable」其实是**一组文件**。源码开宗明义：SSTable 由多个组件文件组成（`io/sstable/Component.java:33-37`），每个组件在顶层定义了名字（`io/sstable/format/SSTableFormat.java:158-170`）。把每个文件当成书的部件，配一句人话：

| 组件文件 | 定义处 | 它是什么 | 类比 |
| --- | --- | --- | --- |
| Data.db | `io/sstable/format/SSTableFormat.java:158` | 数据本体，按分区键有序排列 | 书的正文 |
| Index.db | `io/sstable/format/big/BigFormat.java:179` | 分区键 → Data.db 位置的主索引 | 章节页码表 |
| Summary.db | `io/sstable/format/big/BigFormat.java:181` | Index 的抽样摘要，常驻堆内 | 夹在页码表里的粗读书签 |
| Filter.db | `io/sstable/format/SSTableFormat.java:164` | 布隆过滤器，序列化的行键集合 | 门口保安手里的访客名单 |
| Statistics.db | `io/sstable/format/SSTableFormat.java:162` | 统计：min/max 时间戳、TTL、压缩信息 | 书的版权页与勘误表 |
| CompressionInfo.db | `io/sstable/format/SSTableFormat.java:160` | 压缩块偏移表（数据开了压缩时） | 拆包说明书 |
| TOC.txt | `io/sstable/format/SSTableFormat.java:170` | 组件清单本身 | 书袋上的目录卡 |

big 格式把这些名字收在自己的 `Components` 清单里（`io/sstable/format/big/BigFormat.java:206-214`），`TOC.txt` 是打开的钥匙：启动或 streaming 时先读它，才知道这本账带齐了哪几个文件。每个组件各配一个类比的话：Data.db 是正文，Index.db 是页码表，Summary 是页码表的缩印卡（官方注释说它就是 Index 条目的抽样、供内存里先快速定位一次，`io/sstable/format/big/BigFormat.java:76-84`），Filter.db 是门口的访客名单——「id=47？名单上没有，这本书不用翻」。

「打开一本 SSTable」在源码里是一条两级流水线。入口是 `SSTableReader.open(...)`（`io/sstable/format/SSTableReader.java:365`），它把活交给格式对应的 loadingBuilder 去真正装载（`:412-420`）；big 格式的 `BigSSTableReaderLoadingBuilder` 依次读 Summary、必要时重建布隆过滤器（`io/sstable/format/big/BigSSTableReaderLoadingBuilder.java:98-129`），最后产出一个常驻内存的 `BigTableReader`（`io/sstable/format/big/BigTableReader.java:89`）。从此每次点查都走这套流程：先问 Filter（大概率直接出局），再用 Summary 定个大概位置，再去 Index.db 精确查找，最后落进 Data.db——第 4 章会看到 BTI 格式怎么把这条链换成逐字节导航。

```text
举例：SELECT id=47 时，这本账的四个部件如何接力
①  Filter.db：id=47 的布隆判定 → 「可能存在」才继续（「不存在」直接省掉后面全部）
②  Summary.db（在堆里）：按 1/128 抽样的页码卡（min_index_interval=128，
    schema/TableParams.java:450）→ 定位到 Index.db 的一小段
③  Index.db（页缓存）：在这一小段里精确找到 id=47 的 Data.db 位置
④  Data.db：按位置读出分区，行内按 clustering 排列，直接切出要的行
散落在多本账里的点查，大多数会在第①步出局——
键不在这本账里时，布隆替你省掉②③④的全部 I/O。
```

---

## 三、压缩：后台的并账流水线

压缩（Compaction）的本质一句话：**把几本不可变账本归并重写成一本新账，被覆盖的旧版本与到期可丢的墓碑就地消失**。它是 LSM 引擎「写时乱、读时拼」的还债工序：写路径只管追加，把账搞乱；压缩负责把账理清，让同一份数据的痕迹越少越好。

调度它的是全节点一个真单例 `CompactionManager`——类注释自称「管理进行中压缩的私有执行器的单例」（`db/compaction/CompactionManager.java:147-154`），后台入口是 `submitBackground`（`:248`）：每张表把自己的账本情况报给策略，由策略决定要不要搬、搬哪几本。而「按什么规矩并」由 `CompactionStrategyManager` 分发：它把账本按修复状态与数据目录分组，再委托给每张表配置的具体策略（`db/compaction/CompactionStrategyManager.java:93-111`），查单本账归属用 `getCompactionStrategyFor`（`:350`）。也就是说：**CompactionManager 是工头，策略是图纸**——第四节的全部分歧都在图纸上。

触发压缩的口子不止一个。flush 完成是常态触发：新账上岗、策略被通知、顺手评估要不要并；`nodetool compact` 是手动触发（对应 `submitMaximal`，`db/compaction/CompactionManager.java:1169-1176`），把整本表强并到底；还有一类「墓碑压缩」专门盯那些墓碑占比过高的账本，哪怕大小不凑批也单独重写一遍。三者的合并核心是同一个：都是走「扫描器归并 → 新文件 → 原子替换」那一套，差别只在谁挑输入。

真正动手合并的是 `CompactionIterator`：类文档说它把多本账的扫描器归并成一个「压缩后」的迭代器，顺手清掉可清除的墓碑（`db/compaction/CompactionIterator.java:132-148`）。归并时的裁决规则和读路径完全同源：同一个 cell，时间戳新的压过时间戳旧的；墓碑压过比它老的任何版本。产出物是新的 SSTable 文件，随后一次原子替换完成换账——旧账退役、新账上岗，中间不存在的那个字节也不改旧账。

```text
举例：t4 之后，三本账里的 id=47 等来第一次压缩
输入：SSTable-00001 [47@1001, 47@1005, 48@2001, ...]
      SSTable-00002 [47@3002, ...]
      SSTable-00003 [47×@4008(墓碑), ...]
归并逐键进行，id=47 的四个痕迹现场裁决：
  ts=4008 墓碑  → 比 1001/1005/3002 都新，四个里它当权
  ts=1001/1005/3002 → 被墓碑压住，且不再有更老的账本需要它们遮挡 → 丢弃
  墓碑本身     → localDeletionTime 还在 gc_grace 窗口内（第五节）→ 必须保留
输出：SSTable-00004 [47×@4008, ...]   ← 只剩墓碑和别的没被删的行
00001/00002/00003 整本退役，磁盘空间在引用归零后回收。
```

整个过程中，这条流水线和读写互不阻塞：**压缩读的是只读旧账、写的是全新文件**，读请求继续从旧账里拿数据，直到原子替换那一瞬间才切换到新账；写请求从头到尾只碰 Memtable，连压缩的存在都不用知道。唯一的代价是磁盘 I/O 和临时翻倍的空间占用——值班工程师看到的「磁盘两倍」，就是新旧账并存的那扇窗。

```text
举例：压缩进行到一半时，一次点查看到的世界
t5  压缩任务开工：输入 00001/00002/00003，输出写到一半的 00004
t6  客户端 SELECT id=47（CL=QUORUM）
    node2 的读路径此刻面对的账本集合里，00001~00003 仍在列（还没退役），
    00004 尚未上岗 → 照常从 00003 里读到墓碑，回答「已删除」
t7  归并完成，原子替换：00001~00003 退役，00004 上岗
t8  同样的 SELECT：账本集合换成 {00004,...} → 还是「已删除」
两次读各看各的账本快照，答案一致——压缩对读路径唯一的可见性
就是那个瞬间的集合切换，中间状态永远不暴露。
```

---

## 四、四本账：四种压缩策略

出厂默认的压缩策略是 STCS：`CompactionParams` 里的 `DEFAULT` 直接用 `SizeTieredCompactionStrategy` 拼装（`schema/CompactionParams.java:99-102`），`conf/cassandra.yaml:1267-1271` 的注释示例同样写着这个类名和 4/32 两个阈值。四本账各有各的记账哲学：

| 策略 | 类与关键默认值 | 并账逻辑 | 读放大 | 写放大 | 适用 |
| --- | --- | --- | --- | --- | --- |
| STCS（默认） | `db/compaction/SizeTieredCompactionStrategy.java:51`；min/max_threshold=4/32（`schema/CompactionParams.java:82-83`）；相似=大小同处 0.5~1.5 倍带（`db/compaction/SizeTieredCompactionStrategyOptions.java:26-28`，min_sstable_size 50MB） | 相似大小的 SSTable 凑满 4 本合一批，越合越大 | 高（同键散在多本大小各异的账里） | 低（每次合并涉及的账少） | 写多读少 |
| LCS | `db/compaction/LeveledCompactionStrategy.java:63`；sstable_size_in_mb=160（`:73`）、fanout_size=10（`:72`） | 分层：L0 接 flush，L1 起层内键范围互不重叠，每层约为上层的 10 倍（`doc/modules/cassandra/pages/managing/operating/compaction/lcs.adoc:12`） | 低（L1+ 每层至多问 1 本，`doc/modules/cassandra/pages/managing/operating/compaction/lcs.adoc:14`） | 高（层间反复重写） | 读多写少 |
| TWCS | `db/compaction/TimeWindowCompactionStrategyOptions.java:37-41`（窗口默认 1 天） | 按写入时间戳切时间窗，窗内做 STCS 式合并；TTL 到期的整本账直接过期删除 | 中（同键通常落在同一窗） | 低 | 时序、TTL 数据 |
| UCS（5.0+） | `db/compaction/UnifiedCompactionStrategy.java:60-70`（CEP-26）；target_sstable_size=1GiB、min_sstable_size=100MiB（`config/CassandraRelevantProperties.java:746-752`） | 统一参数 N/L/T 把上面三种形状表达为同一套缩放参数，按数据量自动选层 | 可调 | 可调 | 官方现在首推 |

四本账不是并列的四个菜单项那么简单，它们是同一件事（凑批合并）在不同维度上的切法：STCS 按**大小**切，LCS 按**层级**切，TWCS 按**时间**切，UCS 干脆把大小/层级/时间收进一个缩放参数里按数据量自动选。TWCS 的窗口机制值得单独看一眼：它按数据的时间戳把账本归进窗（默认按天），窗内照 STCS 的规矩凑批合并，而**整本账里所有数据都过了 TTL 的，整本直接登记为可丢弃**（过期检查默认每 600 秒跑一次，`db/compaction/TimeWindowCompactionStrategyOptions.java:40`）——TTL 到期的数据从此不再走「逐行归并」的贵路，这是时序负载选它的核心理由。UCS 则反其道而行：不再让用户在四本账里押宝，而是给一个缩放参数（N/L/T 前缀，`db/compaction/UnifiedCompactionStrategy.java:77` 的参数正则），数据量小的时候像 STCS、大起来自动长出层级，官方文档现在的推荐口径是「所有负载先考虑 UCS」（`doc/modules/cassandra/pages/managing/operating/compaction/lcs.adoc:6` 的 ucs-recommend 引述）。

把 id=47 的 4 份痕迹分别放进 STCS 和 LCS 里各演一遍，差别立刻可见：

```text
举例：id=47 的收敛路径，STCS 与 LCS 各算一遍
STCS（min_threshold=4）：
  00001(约1.2MB)、00002(约0.9MB)、00003(约0.8MB) 互处 0.5~1.5 倍带内，
  但只有 3 本 < 4 → 不动。第 4 次 flush 凑满才合并。
  合并前点查 id=47：Filter 放行的话，最坏要问 3 本账、逐本比时间戳。
LCS（sstable_size_in_mb=160）：
  三次 flush 都落在 L0（层内可重叠）→ L0→L1 归并 → L1 层内不重叠。
  合并后点查 id=47：memtable → L0 若有 → L1 每层至多 1 本 → 最多问 2~3 本且恒定。
  L0 攒超过 32 本时触发保护性的 STCS（db/compaction/LeveledManifest.java:63）。
两条路的终点一样：id=47 的三个旧版本被丢弃，墓碑按第五节的规矩决定去留；
差别在路径——STCS 用读放大换写放大，LCS 反过来。
```

选账的口诀一句话：**先问负载的读写比，再问数据有没有时间结构**。写多读少、没有 TTL 的，STCS 省写放大；读多写少的，LCS 把读放大摁到每层一本；按时间写入、按 TTL 过期的，TWCS 让整本过期账直接消失；拿不定主意的，跟官方推荐走 UCS，让数据量自己选形状。拍板之后还有两个旋钮最常动：LCS 的 `sstable_size_in_mb`（单元越小读越准、合并越频繁）和 STCS 的 `min_threshold`（凑批门槛，动了就同时动读放大和空间波动）。

---

## 五、墓碑：删除什么时候才真正完成

「删除」在 Cassandra 里是一笔带时间戳的普通写入。墓碑的载体是 `DeletionTime`（`db/DeletionTime.java:37-39`）：两个字段，`markedForDeleteAt` 记「几点删的」（用来压住更老的版本），`localDeletionTime` 记「删除发生在本机几点」（用来判断什么时候可以扔，`:58-59`）；没有删除时用常量 `LIVE`（`:48`）。注意第二个字段是**本机时钟**——gc_grace 的整个故事都围着它转。

墓碑要消失，必须同时满足两个条件。第一，**过了 gc_grace_seconds**：压缩开始时算一个 `gcBefore = now - gcGraceSeconds`（`db/ColumnFamilyStore.java:2059-2071`），gc_grace 出厂默认 864000 秒即 10 天（`schema/TableParams.java:446`）。第二，**压它的账本们已经带上所有可能有更老数据的账本**：`CompactionController.getPurgeEvaluator` 的注释写得很直白——墓碑可清除的前提是「不含本分区的其他账本里，没有比删除时间更老的数据还压着」（`db/compaction/CompactionController.java:249-256`），不满足就一个墓碑都不清（`:261`）；涉及修复数据的压缩还有更严格的门槛（`db/compaction/CompactionIterator.java:472`）。单本账里 TTL 全过期的，另有整本丢弃的快路（`db/compaction/CompactionController.java:179-203`）。

为什么要等 10 天？因为副本可能暂时失联。第 1 章的 node5 曾 GC 停顿没收到 UPDATE——删数据时同样可能发生：如果墓碑在失联副本恢复前就被各节点清掉，副本恢复后 hint 补送或修复会把**旧数据当成活的**重新复制出去，这就是官方文档说的「僵尸数据复活」（`doc/modules/cassandra/pages/managing/operating/compaction/tombstones.adoc:27-35`）。gc_grace 的意义就是给失联副本留足归队时间（`doc/modules/cassandra/pages/managing/operating/compaction/tombstones.adoc:38-41`）。一个表里墓碑太多也会被点名：单次查询扫过 1000 个墓碑就告警（`config/Config.java:636` 的 `tombstone_warn_threshold = 1000`）。

```text
举例：id=47 的删除时间线（gc_grace_seconds = 864000 = 10 天）
t4  10-25 14:00  DELETE id=47 (ts=4008)，localDeletionTime=10-25 14:00
     此后每次压缩：gcBefore = 压缩时刻 - 10 天 > 10-25 14:00 ？否
     → 墓碑原样搬进新账，旧版本被它压住丢弃
t+  11-04 14:01  十天整刚过：gcBefore > 10-25 14:00 成立
     且归并的输入已覆盖 id=47 全部更老数据
     → 墓碑与旧版本一起消失，id=47 在盘上收敛成 0 份
这十天里若 node5 归队，hint/修复把墓碑补给它，删除才在三份副本上落齐。
```

墓碑窗口期的另一笔账记在**读路径**上：窗口内墓碑不但占盘，还要被每次相关读取重新扫一遍。一次查询扫过的墓碑超过阈值就打告警日志，提醒你这张表的删除模式已经伤到读了——常见于「按天删旧分区」的负载，解法通常是换 TWCS 或调大分区的粗细，而不是硬扛。换句话说：**gc_grace 是磁盘上的等待线，tombstone_warn_threshold 是读路径上的报警线**，两条线量的是同一个墓碑的两面。

---

## 六、和 RocksDB 摆在一起看：四种并账策略

| 维度 | RocksDB | Cassandra |
| --- | --- | --- |
| 策略谱系 | Leveled（L0→L6）、Universal、FIFO | STCS≈Universal、LCS≈Leveled、TWCS（时间窗，RocksDB 无对应物）、UCS 统一两者 |
| Leveled 细节 | 7 层（L0~L6），L0 文件可重叠、每层 ×10 | L0~L8 共 9 层（`db/compaction/LeveledGenerations.java:56-57`），L0 同样特殊（32 本保护，`doc/modules/cassandra/pages/managing/operating/compaction/lcs.adoc:23`） |
| 「trivial move」 | 同层边界判断，整文件直接换层不重写 | `SingleSSTableLCSTask`：只改层级元数据不搬数据（`db/compaction/SingleSSTableLCSTask.java:30-35`） |
| 删除收敛 | 墓碑随压实下沉，最底层无遮挡即可丢 | 多一道闸：gc_grace 过期 + 无失联副本风险，否则墓碑无限期保留 |
| 换账方式 | 压实完成原子切换 Version | 同样原子替换，但账本按 repair 状态分组并行并账 |
| 合并期间读写 | 读走旧 Version 不受影响 | 读走旧 SSTable 集合不受影响，写只碰 Memtable |

两边的心法完全同源：**文件不可变 + 后台归并收敛**，连「整本文件不重写直接换层」的省力招数都各有一个。真正的分岔在删除上：RocksDB 的墓碑只要沉到底层、确认没有更老版本遮挡就能丢，从删除到物理消失通常只是一轮压实的距离；Cassandra 的墓碑多背一个分布式约束——**它必须等所有失联的副本归队**，gc_grace 那 10 天是给 hint 与修复留的窗口。所以「删了数据磁盘为什么不缩」在两边都要解释，但 Cassandra 的答案多一个「还得等 gc_grace」：这是用磁盘空间和一张时间表，换「已删除的数据永远不再复活」。

第二处分岔在「并账的分组维度」：RocksDB 一个库一棵 LSM 树，压实只关心层和大小；Cassandra 的账本先按**修复状态**（repaired/unrepaired）分成互不掺和的两组、再按数据目录分组，每组各配一份策略实例（`db/compaction/CompactionStrategyManager.java:93-108`）。这是修复语义压进存储引擎的形状——修复没做完的账本不跟已修复的一起合并，否则一次 repair 期间的重写会把修复成果搅乱。RocksDB 没有副本与修复，自然也没有这层分账。

---

## 这一章留下的线索

- **SSTable 写完即封账**：flush 的产物、一组组件文件（Data/Index/Summary/Filter/Statistics/TOC），文件名里的递增 id 就是账本的新旧座次；
- **压缩 = 后台并账**：CompactionManager 当工头、CompactionStrategyManager 分发图纸、CompactionIterator 归并去旧——读写全程不阻塞，只在换账瞬间原子切换；
- **四本账**：STCS 按大小凑批（4/32）、LCS 按层（160MB/层内不重叠/每层问 1 本）、TWCS 按时间窗、UCS 用 N/L/T 统一前三种——选策略就是在选读放大与写放大的分配比例；
- **墓碑有寿命表**：gc_grace_seconds=864000 内压缩只能搬运不能清除，过了期且无更老数据遮挡才真正消失——删除的「物理完成」比「逻辑完成」晚十天；
- **出厂默认形状**：STCS + min/max 4/32 是所有新表的起点（`conf/cassandra.yaml:1267-1271`），改策略前先想清楚负载是读多还是写多。

下一章把「账本本身」再往深处推一层：5.0 引入的 Trie 内存账本与 BTI 盘上格式，怎么用逐字节导航取代二分查找——[基于 Trie 的存储格式：TrieMemtable 与 BTI](../engine/03-基于Trie的存储格式.md)。

---

## 附：这一章的源码入口

> 除特别注明外，本节引用的源码文件与行号都来自 apache/cassandra 主分支（7.0-SNAPSHOT，2026-08）。

- `io/sstable/Component.java:33-37`：SSTable 由多个组件文件组成的总述
- `io/sstable/format/SSTableFormat.java:158-170`：Data/CompressionInfo/Statistics/Filter/TOC 等顶层组件名
- `io/sstable/format/big/BigFormat.java:76-84、164、174-214`：big 格式组件清单（Index.db/Summary.db）、Summary 职责注释
- `io/sstable/Descriptor.java:56`：账本身份（keyspace、表、递增 id）
- `io/sstable/format/SSTableReader.java:365、412-420`：open 两级入口；`io/sstable/format/big/BigSSTableReaderLoadingBuilder.java:98-129`：装载 Summary 与 Filter
- `io/sstable/format/big/BigTableReader.java:89`：打开后的常驻读句柄
- `db/compaction/CompactionManager.java:147-158、248`：压缩单例与后台提交入口
- `db/compaction/CompactionStrategyManager.java:93-111、350`：按修复状态/目录分组并委托策略
- `db/compaction/CompactionIterator.java:132-148、472`：归并迭代器与修复数据的清墓门槛
- `db/compaction/CompactionController.java:179-203、249-261`：整本过期丢弃与 getPurgeEvaluator 清墓条件
- `schema/CompactionParams.java:82-83、99-102`：默认策略 STCS 与阈值 4/32；`conf/cassandra.yaml:1267-1271`：yaml 侧默认示例
- `db/compaction/SizeTieredCompactionStrategy.java:51、97`：STCS 与凑批；`db/compaction/SizeTieredCompactionStrategyOptions.java:26-28`：50MB/0.5/1.5
- `db/compaction/LeveledCompactionStrategy.java:63、72-73、186-189`：LCS、160MB、fanout 10 与 trivial move；`db/compaction/LeveledManifest.java:63` 与 `db/compaction/LeveledGenerations.java:56-57`：L0 保护与 9 层
- `db/compaction/SingleSSTableLCSTask.java:30-35`：只换层不搬数据的特殊任务
- `db/compaction/TimeWindowCompactionStrategyOptions.java:37-41`：TWCS 默认窗口
- `db/compaction/UnifiedCompactionStrategy.java:60-70` 与 `config/CassandraRelevantProperties.java:746-752`：UCS（CEP-26）与 1GiB/100MiB 默认
- `db/DeletionTime.java:37-48、58-59`：墓碑载体与 LIVE 常量
- `db/ColumnFamilyStore.java:2059-2071`：gcBefore = now - gc_grace；`schema/TableParams.java:446`：gc_grace 864000
- `config/Config.java:636`：tombstone_warn_threshold=1000
- `doc/modules/cassandra/pages/managing/operating/compaction/lcs.adoc:12-23`、`doc/modules/cassandra/pages/managing/operating/compaction/tombstones.adoc:27-41`：官方文档对 LCS 层级与 gc_grace 的定性（文档不带行号引用规范外，仅作辅助）

---

## 思考题

1. 第 2 章说「flush 是整本顺序写」，本章说「压缩期间磁盘占用一度翻倍」。如果把 `sstable_size_in_mb` 从 160 调到 1600（LCS），翻倍窗口会变大还是变小？（提示：一次 L0→L1 归并要同时养着输入和输出两份。）
2. id=47 的删除发生在 10-25 14:00。若你把 `gc_grace_seconds` 改成 0 再触发压缩，墓碑立刻消失——在这个集群里 node5 刚好失联 3 小时，会发生什么？这解释了 gc_grace 保护的是谁。
3. 一张时序表按天写入、TTL 3 天。用 STCS、TWCS 各推演一遍：过期数据分别靠什么离开磁盘？哪个更省 I/O？（提示：TWCS 有「整本账全过期则直接丢弃」的快路。）
4. STCS 下同一个分区键的版本可能散在 8 本大小各异的账里，LCS 下每层至多 1 本。各算一次点查的「问账次数」上界，再想想：读多的监控表该选谁？（提示：L1+ 层内不重叠意味着每层一次布隆过滤就能出局。）
