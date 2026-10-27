# Gossip 与故障检测：八卦网怎么知道谁挂了

先看一个让值班工程师发毛的现场。凌晨两点，node4 的 JVM 因为堆外内存碎片卡死了，进程还活着，就是不响应任何请求。三分钟后他打开 `nodetool status`：五个节点里四个 UN，node4 一个 DN。他没有收到任何告警——告警系统盯着的是各节点自己上报的心跳，而 node4 还没来得及意识到自己该报警。他盯着一行字想：**集群里没有主库，那「node4 挂了」这句话是谁说出口的？其他四个节点凭什么信？**

说出来你可能不信：这句话是每个节点**自己独立说出口**的，而且没人需要向谁报备。Cassandra 集群里没有一个「监事会」记录谁生谁死——ZooKeeper、etcd 这些协调服务一概没有。每个节点靠一套 gossip（八卦）协议跟随机同伴交换「我听说的成员名单」，再用一套统计学故障检测器对每个同伴的「心跳到达间隔」打分，分数过线就自己把对方标记成 DOWN。没有请示、没有选举、没有全局快照，但几秒钟内所有节点会得出同一个结论。看懂这套「各自打听、各自判断、结论趋同」的机制，「没有主库谁管容灾」这个疑虑就翻转成一个特性：**判定故障这件事本身，也是对等的**。

全章跟一次宕机走。它发生在我们沿用至今的 5 节点集群上：

```text
贯穿全章的集群与一次宕机（沿用全轨道口径）：
5 个节点 node1 ~ node5，keyspace demo，RF=3
id=47 这行的副本 = {node2, node4, node5}（第 6 章讲它怎么算出来的）

14:00:00  node4 卡死：进程还在，但不再回应任何消息（含 gossip 心跳）
14:00:00  其余四个节点对 node4 的心跳间隔样本库：均值 ≈ 1 秒（gossip 每秒一拍）
14:00:18  node1/node2/node3/node5 各自算出 node4 的 phi 越过阈值 8
          —— 四个节点是「各自」算的，谁都不知道别人算到了多少
14:00:19  四个节点几乎同时把 node4 标成 DOWN，向各自的订阅者广播
之后      id=47 的读写靠剩下的副本 {node2, node5} 继续，QUORUM(2) 仍凑得齐
之后      node4 恢复 → 靠 gossip 重新报「我回来了」→ 缺席期间的写入靠修复补齐（第 13 章）
```

phi 这个数先记住结论：心跳均值 1 秒时，大约 18 秒没消息就把对方标记 DOWN，而「18」不是拍脑袋的超时，是一个统计分——对方心跳越不规律，同样的沉默越不敢断言它挂了。为什么是统计分、怎么算，第五节展开。

---

## 一、没有老板的集群，消息怎么走：gossip 的定位

Cassandra 里每个节点都是 coordinator（第 1 章说过：谁来接单谁协调），这说的是**请求**。这一章说的是另一件事：节点之间**交换状态**。状态包括谁在环上、谁的负载多少、谁准备好了对外服务——这些信息不在任何一个「权威节点」手里，而是在每个节点手里都存一份、靠 gossip 慢慢对齐。gossip 是这套集群里**唯一的状态传播通道**（7.0 master 上例外更少：连 token 名单、schema 这些老版本还靠 gossip 传的东西也已划给了 ClusterMetadata，见第三节）。

实现就在一个单例里：`gms/Gossiper.java:141` 的 `Gossiper` 类，`gms/Gossiper.java:162` 的 `public static final Gossiper instance`——每个 JVM 里就这一份，全集群每个节点各跑一份，代码完全相同。类比：办公室里没有布告栏，每个员工每隔一分钟走到一个**随机**同事面前，互相把「我手里的通讯录」报一遍版本号，谁的新就抄谁的。没人主持会议，但几轮之后所有人的通讯录趋同。

每分钟一次的「走到随机同事面前」，在源码里是每 1000 毫秒一拍的定时任务：`gms/Gossiper.java:157` 的 `intervalInMillis = 1000`。每拍做三件事（`GossipTask.run`，`gms/Gossiper.java:263-283`）：

1. **给自己跳一下心跳**：`epstate.updateHeartBeat()`（`gms/Gossiper.java:278`）——「我还活着」不用广播，体现在心跳计数器 +1 上；
2. **把全环摘要发给一个随机同伴**：`makeGossipDigest`（`gms/Gossiper.java:283`）收集全环每人的三元组摘要，`doGossipToLiveMember`（`gms/Gossiper.java:873`）随机挑**一个**活节点发出去——注意是一个，不是全部；
3. **做一轮状态检查**：`doStatusCheck`（`gms/Gossiper.java:320`）——第五节的故障判定就在这里触发。

摘要本身小得可怜：每个成员一条 `(endpoint, generation, version)` 三元组（`gms/GossipDigest.java:38-40`），比「这个节点叫什么、它的名片第几版」还省——**不带内容，只带版本号**。带版本号不带内容，是为了让对面的节点自己判断「咱俩谁手里的更新」，该传的内容走第二轮再说。

```text
举例：node2 一拍（1 秒）发出的 SYN 里有什么
{ node1: gen=1750000000, ver=4121
  node2: gen=1750000000, ver=9307   ← 自己，心跳每拍 +1，version 最高
  node3: gen=1750000001, ver=774
  node4: gen=1749999918, ver=8900
  node5: gen=1750000000, ver=5120 }

五个节点 ≈ 每条摘要 20 字节，总共 100 字节；
万节点集群一张摘要 ≈ 10,000 × 20B = 200KB，也只发给 1 个随机节点。
单节点出口随集群规模线性增长（默认每秒一拍，万节点约 200KB/s），
但不会向所有节点广播——这是 gossip 能装下万节点的本钱，也是再大一个数量级要换方案的原因之一。
```

顺带一提两个补丁式设计：除了随机活节点，每拍还按概率把消息发给一个**不可达**节点（万一它复活了能第一时间知道，`gms/Gossiper.java:888-895`）、按概率补发一个 **seed**（防止集群裂成两半各聊各的，`gms/Gossiper.java:906`）。seeds 的身份第 1 章说过：只是新节点入职时的联系人，不是主库。

---

## 二、一轮八卦的三次握手：SYN → ACK → ACK2

一轮完整的八卦是三条消息、两个来回，名字自带剧本：GossipDigestSyn（摘要清单）→ GossipDigestAck（确认 + 差异）→ GossipDigestAck2（再确认 + 差异）。三个动词在消息协议里各占一个编号（`net/Verb.java:235-237`），各配一个处理器，处理逻辑全在 `gms/` 下三个对应的 `*VerbHandler`。

第一步，A 把 SYN 摘要清单发给随机选中的 B。清单里只有版本号没有内容（`gms/GossipDigestSyn.java:36-43`——连同集群名、分区器名一起带上，防止 A 和 B 根本不在同一个集群里还聊得火热）。B 收到后做一次**对账**：`GossipDigestSynVerbHandler`（`gms/GossipDigestSynVerbHandler.java:37`）调 `examineGossiper`（`gms/Gossiper.java:1702`）逐条比对——

```text
举例：B 拿着 A 的摘要对账，比出两份差集
A 报「node5 ver=5120」→ B 手里 node5 ver=7740
    → B 比 A 新：把 node5 的完整状态装进给 A 的回礼
A 报「node4 gen=1749999918, ver=8900」→ B 手里 node4 ver=9100
    → A 比 B 新：把 node4 的完整状态也装进回礼（B 别搞丢）
比对结果：回给 A 的 ACK 同时带两样——
  ① 各条目的差异摘要（告诉 A 我还需要什么）
  ② B 手里比 A 新的完整状态（gms/GossipDigestAck.java:41-42 正好两个字段）
```

第二步，A 收到 ACK，做三件事（`gms/GossipDigestAckVerbHandler.java:43-88`）：先把 B 送来的新状态**喂给故障检测器**（`gms/GossipDigestAckVerbHandler.java:74`——「有消息到」本身就是一次心跳采样，第五节用它算 phi）；再**并账**到本地（`:75`）；最后把自己手里**比对方新**的状态查出来装进 ACK2 回敬（`:83-88`）。第三步，B 收到 ACK2，同样并账（`gms/GossipDigestAck2VerbHandler.java:49`）。一个来回之后，A 和 B 对交换过的每个成员都持有了两人合并后的最新版本。

类比：你跟同事对进度。你说「我手里 5 份文件，版本号分别是 3、7、1、9、2」；他回「我这里有第 2、4 份的新版给你，另外你要的第 5 份我这有 v5」；你再把他缺的补给他。三次交互，两边手里都是两人知识的并集——而且**只传差异**，环境稳定时每轮传输的内容趋近于零。

这个「只传差异」还顺手解决了消息乱序问题：网络不保证 gossip 消息按序到达，晚到的旧状态若直接覆盖就坏了。并账的裁判是版本号——**version 单调递增，小的让大的**，细节在下一节。

---

## 三、名片上的两行字：generation 与 version

 gossip 里每个节点对外是一张名片，叫 EndpointState（`gms/EndpointState.java:49-53`）。名片分两栏（`gms/EndpointState.java:62-72` 的内部 View 正好两个字段）：

- **心跳栏 HeartBeatState**：两个 int——generation 与 version（`gms/HeartBeatState.java:36-37`）。generation 是「启动代次」，节点每次进程启动时取当时的系统时钟秒数（`gms/Gossiper.java:1411` 的注释原话：normally defined as system clock millis）；version 是「名片版本号」，gossip 每拍自增一次（`gms/HeartBeatState.java:75-78` 的 `updateHeartBeat`）。
- **状态栏 applicationState**：一张「状态键 → 带版本号的值」的表。键是枚举 ApplicationState（`gms/ApplicationState.java:28`），最常用的几个：LOAD（负载）、RPC_READY（对外服务就绪）、STATUS_WITH_PORT（节点自报的生灭状态，`gms/ApplicationState.java:33、48、52`）。7.0 master 上有个值得知道的变化：老版本靠 gossip 传的 TOKENS、SCHEMA、DC、RACK 已划归 ClusterMetadata 管，枚举里都标了 `@Deprecated(since = "CEP-21")`（`gms/ApplicationState.java:34-47`）——gossip 瘦身了，但心跳、负载、就绪状态仍是它的主业。

两个数字各管一件事。**version 管「哪张名片更新」**：每个状态值带自己的版本号，从 VersionGenerator 取单调递增的号；并账时只接受版本号更大的值（`gms/Gossiper.java:1473` 的 `applyStateLocally` 里，generation 打平后进入版本比对分支，`applyNewStates` 只收 `local.version < remote.version` 的状态）。乱序、重复、迟到的旧消息，都会被这句比较挡在门外——**后到的旧值覆盖不了先到的新值**。

**generation 管「这是不是重启过的节点」**。它解决一个 version 无能为力的问题：进程一重启，version 从 0 重新数起，如果只看 version，旧世界的 v9000 会永远压过新世界的 v1。generation 相当于名片上的「出生日期」——新节点的 generation 更大，对面节点看到 generation 变了，知道「这不是同一个进程了」，直接整张名片替换，同时把这个节点在故障检测器里的间隔样本清空重学（`gms/Gossiper.java:1185-1194`）——老样本是上一个进程的节奏，不能算在新进程头上。对账的先后次序也是先 generation 后 version：generation 不一样直接整卡替换，generation 相同才逐项比 version（`gms/Gossiper.java:726` 的 `compareEndpointStartup` 是排序口径）。

```text
举例：node4 重启前后的两张名片
重启前：generation=1749999918, version=8900, LOAD=1.2
重启后：generation=1750003800, version=0,    LOAD=0.0
节点 1 收到重启后的名片：
  generation 1750003800 > 1749999918 → 新的一代，整卡替换，重学间隔样本
  version 0 比 8900 小也不怕——不比了，generation 已经分出高下。
假如只靠 version 判断：v0 < v8900 → 拒收 → 重启节点永远进不了环。
```

---

## 四、一秒传一人，多久传遍全网：log N 的算术

每拍把全环摘要发给 1 个随机节点，这个「1」看着寒酸，传播速度却接近流行病。原因：收到消息的节点**也**开始传。每一轮里，知道消息的节点数按接近翻倍的方式增长——这就是 gossip 在流行病学里的名字：epidemic spread（流行病传播）。

```text
举例：一条新状态在 5 节点集群里的传播（示意：每轮随机，数字取典型值）
第 0 轮：node1 知道 → 1 个
第 1 轮：node1 告诉 node3 → 2 个
第 2 轮：node3 告诉 node5 → 3 个（也可能 node1 告诉 node4，4 个）
第 3 轮：几乎必然全部知道 → 5 个
规律：每秒每人传一人，N 个节点约 log2(N) ~ 2·log2(N) 轮传遍。
5 节点：2~4 轮 ≈ 2~4 秒。
万节点：log2(10000) ≈ 13，取 2 倍余量 ≈ 26 轮 ≈ 半分钟内全网知情。
对比全广播：万节点每秒互发 ≈ 10^8 条消息/秒；gossip 只有 10^4 条/秒。
```

注意这套算术的三个前提，也是 gossip 的三个交换条件。第一，**概率保证不是时限保证**：log2(N) 轮是高概率事件不是承诺，某一轮运气差就会慢一点——这是「最终一致」的题中之义。第二，**传播有下限**：一个状态至少要 1 秒（一拍）才能走出去一步，紧急的生灭事件不能指望 gossip 秒传。第三，**每节点的出口流量恒定**：不管集群多大，每个节点每秒固定发一两条摘要——gossip 用「信息到达有延迟」换「流量不随规模爆炸」，这笔账在分布式系统里通常非常划算。

放在本章的宕机场景里：node4 的 DOWN 判定是每个节点**各自**在 14:00:18 前后做出的，不需要「某某节点宣布、全网同步」。四个节点做出结论的时间有先有后（各自手里的间隔样本不同、phi 到线的时刻不同），但因为大家观测的是同一个对象（node4 的心跳），结论天然趋同——这就够了，不需要精确同步。

---

## 五、Phi Accrual 故障检测：不是「没来就是挂」，是「多久没来才敢说是挂」

最朴素的故障检测是固定超时：「3 秒没心跳 = 挂」。它在真实机房里两头挨打——对心跳规律的节点，3 秒太宽容，白白拖 3 秒才切流量；对心跳本来就不规律的节点（GC 停顿、网络抖动），3 秒又太敏感，动不动误判。Cassandra 用的是 Hayashibara 的 **Phi Accrual** 故障检测器（`gms/FailureDetector.java:70-74` 的类注释直接点名论文）：不做「挂/没挂」的二值判定，而是持续输出一个**怀疑度分数 phi**——「根据这个节点过去的心跳规律，沉默到现在，这件事有多反常」。

它的运转分三步。第一步，**采样**：每收到一个节点的一次心跳（每次 gossip 往来都会触发 report，`gms/Gossiper.java:1161`），记下「距离上次心跳过了多久」，存进该节点的到达间隔样本库 `arrivalSamples`（`gms/FailureDetector.java:107`），最多留 1000 个样本（`gms/FailureDetector.java:79` 的 SAMPLE_SIZE）。第二步，**打分**：每拍 interpret（`gms/Gossiper.java:991`）对每个节点算 phi——源码里的公式在 `gms/FailureDetector.java:591-597`，一行话：`phi = 经过时间 / 心跳间隔均值`（CASSANDRA-2597 起的简化实现：用均值代替完整的指数分布拟合，量级不变）。第三步，**判决**：`gms/FailureDetector.java:402` 的 `PHI_FACTOR * phi > getPhiConvictThreshold()`——PHI_FACTOR = 1/ln10 ≈ 0.434（`gms/FailureDetector.java:105`），阈值默认 8（`config/Config.java:250`，`conf/cassandra.yaml:1541`）。过线就调 `convict`（`gms/Gossiper.java:569`），把对方标记 DOWN。

把公式翻译成算术，阈值 8 等价于「沉默时长超过间隔均值的 8/0.434 ≈ 18.4 倍」：

```text
举例：两种节点，同一个阈值（phi 已乘 PHI_FACTOR，与阈值 8 同口径）
节点甲：心跳每秒一拍，间隔均值 mean = 1.0s
  沉默 1s   → phi = 0.434 × (1/1.0)  ≈ 0.43   稳如泰山
  沉默 10s  → phi = 0.434 × (10/1.0) ≈ 4.3    起疑，还不敢动手
  沉默 18.4s → phi ≈ 8.0                      触线！标记 DOWN
  沉默 30s  → phi = 0.434 × (30/1.0) ≈ 13.0   早就标记了
节点乙：负载重，心跳时快时慢，mean = 5.0s
  沉默 30s  → phi = 0.434 × (30/5.0) ≈ 2.6    还不判——它的常态就这么飘
  沉默 92s  → phi ≈ 8.0                       这才敢断言它挂了
同一个阈值 8，两种节点给出两种「多久才算挂」：
统计分自动适应对方的节奏，这是固定超时做不到的。
```

几个工程细节让这套机制在真实机房站得住。其一，**冷启动保护**：样本不足时用初始值兜底——默认 2000ms（`gms/FailureDetector.java:116-124`，取 gossip 间隔 1000ms 的两倍），宁可先保守。其二，**单条异常样本免疫**：超过上限（默认同初始值 2000ms，`gms/FailureDetector.java:552-561`）的到达间隔不进样本库（`gms/FailureDetector.java:566`）——一次全集群 GC 停顿不该永久污染对某个节点的印象。其三，**自我保护**：本机自己刚经历过长暂停时暂停判定（`gms/FailureDetector.java:384`）——别因为自己卡了一下就把全世界标记 DOWN。其四，**复活要验证**：标记回来的流程 `markAlive`（`gms/Gossiper.java:1213`）不直接生效，先给对方发一条 ECHO 要求回应，确认它「能干活」而不只是「能 gossip」，通过才广播 onAlive（`gms/Gossiper.java:1269`）。

最后是「标记 DOWN 之后发生什么」。Gossiper 的订阅者名单里有 StorageService 这类关注者，接口是 `IEndpointStateChangeSubscriber`（`gms/IEndpointStateChangeSubscriber.java:30`，`onJoin:39`、`onAlive:45`、`onDead:47`）。markDead 时逐个通知（`gms/Gossiper.java:1277、1288`）。StorageService 收到 onDead 做两件事：掐断到对方的出站连接（防止继续往一个病号上排队积压），再把「它没了」通知给副本策略层——之后读写请求计算副本名单时会跳过它（`service/StorageService.java:2408-2414`；onAlive 对称地在 `:2402-2406` 里 notifyUp）。读写的可用性不受影响：RF=3、QUORUM=2，node4 挂了 id=47 还有 node2、node5 两个副本在场。

---

## 六、优雅离场：主动说再见，不等 phi

phi 那套「沉默够久才算挂」的逻辑，是为**意外**准备的。但集群里还有大量**计划内**的离场：运维执行 decommission 缩容（第 14 章）、滚动重启升级版本。这些场景里节点是清醒的，它知道自己要走——如果也走「沉默 18 秒等 phi 过线」这条路，就白白让集群对一批其实健康的节点多疑了一阵，期间读写还要绕着它计算副本。

所以 gossip 里备了一条「当面告辞」的消息：GossipShutdown（`gms/GossipShutdown.java:30`），在线程里排在三个摘要动词后面（`net/Verb.java:238`，编号 29）。要走的节点停掉对外的请求服务后，给活着的同伴们发这条消息；收到的一方**立刻**把发送者标记成 shutdown，不经过任何 phi 计算——Gossiper 类注释里写得很直白：Upon hearing a GossipShutdownMessage, this module will instantly mark the remote node as down（`gms/Gossiper.java:135`）。落地动作是 `markAsShutdown`（`gms/Gossiper.java:594`）：把对方的 STATUS 状态改成 shutdown（`:607-609`），再通知订阅者（`:616`）。

```text
举例：node4 的两种离场，集群的反应速度
意外卡死（本章主线）：14:00:00 停跳 → 14:00:18 四个节点各自 phi 过线才标 DOWN
                      —— 慢，但不需要 node4 配合，适合真正的故障
计划内 decommission：运维敲下命令 → node4 主动发 GossipShutdown
                      → 各节点收到即标 shutdown，零等待
                      —— 快，但前提是节点自己还能说话
工程上的分工：意外交给统计，计划内交给协议；
两条路最终落到同一份本地账本上（谁不在了），读写路径看到的结论一致。
```

注意「标 shutdown」不等于「数据搬完了」。decommission 的完整流程是先把自己的数据流式搬给接手节点、搬完才告辞（第 14 章展开）；GossipShutdown 只是故事的最后一幕：**搬完了，我走了，别等我 phi 过线**。

这一章出现的关键默认值摆一次，后面读日志、调参时会反复回来对账：

| 参数 | 默认值 | 定义在哪 | 它决定了什么 |
| --- | --- | --- | --- |
| gossip 间隔 | 1000ms | `gms/Gossiper.java:157` | 一拍八卦的节奏，也是 phi 的采样粒度 |
| phi_convict_threshold | 8.0 | `config/Config.java:250`、`conf/cassandra.yaml:1541` | 怀疑分过线即判 DOWN；均值 1s 时约 18.4s 沉默 |
| 样本库大小 | 1000 条 | `gms/FailureDetector.java:79` | 多少次心跳历史参与「摸清对方节奏」 |
| phi 初始均值 | 2000ms | `gms/FailureDetector.java:116-124` | 冷启动兜底，取 gossip 间隔的 2 倍 |
| 异常样本上限 | 2000ms | `gms/FailureDetector.java:552-566` | 超长的到达间隔不进样本库，防单次停顿污染印象 |
| 单拍 fanout | 1 个随机节点 | `gms/Gossiper.java:848-869` | 每节点每秒固定一两条摘要，流量不随规模涨 |

---

## 七、和 RocksDB 摆在一起看：谁告诉你谁还活着

RocksDB 是个进程内的库，没有「同伴」这个概念——本章的一切在它的世界里都不存在。把两边摆在一起，差异的根源是一个问题：**「你还活着吗」这句话，问的是谁？**

| 维度 | RocksDB | Cassandra |
| --- | --- | --- |
| 「存活」指什么 | 进程自己：活着 = 进程在、句柄有效 | 网络成员：活着 = 心跳还到得了 |
| 谁判定生死 | 不判定。进程死了，库随进程一起消失 | 每个节点各自判（phi），无需任何权威 |
| 状态传播 | 不存在——库不认识隔壁进程 | gossip：O(N log N) 流量、log N 轮趋同 |
| 判挂的依据 | 进程崩溃 / 调用方收到异常 | 统计分 phi 过阈值（默认 8），自动适应节奏 |
| 判挂的代价 | 无（进程没了就是没了） | DOWN 后读写跳过该副本，RF 覆盖 |
| 中心化替代方案 | 用不上 | ZooKeeper/etcd：判定快、语义强，但多一个独立组件要运维、要过多数派；gossip 零依赖、随规模摊流量，代价是秒级收敛 |

RocksDB 的存活由进程自己保证：它是库，进程死它就死，没有任何「它还活着但系统认为它挂了」的中间态。所以它的设计里没有故障检测、没有成员管理、没有状态传播——这些问题的入口在进程边界处就消失了。Cassandra 的每个节点是一个独立进程，进程之间隔着一个会出故障的网络，于是「谁活着」从一个不存在的问题变成一个必须回答的问题。

两种回答的路数也值得对照。中心化协调服务（ZooKeeper、etcd）把「成员名单」变成一个强一致的事实源：判定快、语义清晰、还能顺便做选主。代价是多一个独立组件——要部署、要监控、它自己挂了还要有它自己的容灾（通常 3 或 5 节点多数派）。Cassandra 选 gossip 是因为它的目标是「机房里任何一台机器坏了都不影响整体」：没有协调服务可挂，没有单点可切，故障检测的职责摊到每个节点头上，流量随规模线性可预期。换来的是秒级的最终一致收敛——而 Cassandra 的读写路径本来就不依赖「全网实时知道谁挂了」（QUORUM 数确认就够了，第 7 章），这个延迟买得起。

一句话收束：**RocksDB 的世界里只有「我的进程」一个成员，活着是前提不是结论；Cassandra 的世界里成员是一份最终一致的八卦，活着是每个节点独立统计出的结论。**

---

## 这一章留下的线索

- **去中心化的状态传播**：没有协调服务，`Gossiper` 单例（`gms/Gossiper.java:141、162`）每 1000ms 一拍（`:157`），把全环摘要发给一个随机同伴；摘要只有 `(endpoint, generation, version)` 三元组，不带内容。
- **三轮消息，只传差异**：SYN（摘要）→ ACK（差异 + 回礼）→ ACK2（回礼的回礼），一个来回后两人持有知识的并集；version 单调递增挡住乱序覆盖（`applyStateLocally`，`gms/Gossiper.java:1473`）。
- **名片两行字**：generation（启动代次，重启换代）+ version（状态版本）；EndpointState = 心跳栏 + ApplicationState 状态表；7.0 上 TOKENS/SCHEMA 等已划给 ClusterMetadata（CEP-21）。
- **phi 是统计分不是超时**：phi ≈ 0.434 × 沉默时长/间隔均值，过阈值 8 即 DOWN（`gms/FailureDetector.java:591-597、402`、`config/Config.java:250`）——均值 1s 时约 18.4s 判挂；心跳越飘越宽容。
- **标记 DOWN 是本地决定、全网趋同**：convict → markDead → 订阅者 onDead（掐连接、副本名单跳过）；节点的生死账本每个节点人手一份、最终一致。
- **意外与计划内分两条路**：意外离场等 phi 过线；计划内离场发 GossipShutdown 即刻标记（`gms/Gossiper.java:594-617`），数据搬运在告辞之前完成。

下一章回到数据的路线：这些互相知根知底的节点，怎么把一行数据分摊到环上——[分区器与令牌环：一行数据摊给谁](../distributed/02-分区器与令牌环.md)。

---

## 附：这一章的源码入口

> 除特别注明外，本节引用的源码文件与行号都来自 apache/cassandra 主分支（7.0-SNAPSHOT，2026-08）。

- `gms/Gossiper.java:141、157、162`：Gossiper 类、每拍 1000ms、单例
- `gms/Gossiper.java:263-283、320`：GossipTask 每拍三件事——updateHeartBeat、makeGossipDigest、doStatusCheck
- `gms/Gossiper.java:848-869、873、888-895、906`：sendGossip 随机选一个目标；探 unreachable 与补 seed 的概率逻辑
- `gms/GossipDigest.java:34、38-40`：digest 三元组 (endpoint, generation, maxVersion)
- `gms/GossipDigestSyn.java:36-43`、`gms/GossipDigestAck.java:41-42`、`gms/GossipDigestAck2.java:40`：三条消息的载荷
- `net/Verb.java:235-237`：GOSSIP_DIGEST_SYN/ACK/ACK2 三个动词与对应 handler
- `gms/GossipDigestSynVerbHandler.java:37、123、126`：对账 examineGossiper 并回 Ack
- `gms/GossipDigestAckVerbHandler.java:74-75、83-88`：先喂故障检测器再并账，回 Ack2
- `gms/GossipDigestAck2VerbHandler.java:49`：并账
- `gms/Gossiper.java:1702`：examineGossiper 的差异比对；`gms/Gossiper.java:1161`：notifyFailureDetector
- `gms/EndpointState.java:49-72、78`：EndpointState = HeartBeatState + applicationState 表
- `gms/HeartBeatState.java:36-37、75-78`：generation/version 与 updateHeartBeat
- `gms/ApplicationState.java:28、33-52`：状态键枚举与 CEP-21 后的瘦身
- `gms/Gossiper.java:726、1185-1194、1411`：compareEndpointStartup、generation 变化清样本、generation=时钟的注释
- `gms/Gossiper.java:1473-1553`：applyStateLocally 的 generation → version 两级比对
- `gms/FailureDetector.java:70-79、105、107`：论文出处、SAMPLE_SIZE、PHI_FACTOR、样本库
- `gms/FailureDetector.java:116-124、384、552-566`：初始值 2000ms、本地暂停保护、异常间隔上限与丢弃
- `gms/FailureDetector.java:591-597`：phi = t/mean（CASSANDRA-2597 简化式）；`:402、408`：判决与 convict
- `config/Config.java:250`、`conf/cassandra.yaml:1541`：phi_convict_threshold 默认 8
- `gms/Gossiper.java:569-590、587、991、1213、1269、1277、1288`：convict、markDead、doStatusCheck 调 interpret、markAlive 先 ECHO、onAlive/onDead 通知
- `gms/IEndpointStateChangeSubscriber.java:30、39、45、47`：onJoin/onAlive/onDead 接口
- `service/StorageService.java:2377、2402-2414、2416`：onJoin/onAlive/onDead/onRestart 的落地动作
- `gms/GossipShutdown.java:30`、`net/Verb.java:238`、`gms/Gossiper.java:135、594-617`：优雅离场——GossipShutdown 消息、动词编号与 markAsShutdown 的即时标记

---

## 思考题

1. gossip 每拍只把摘要发给 1 个随机节点。如果把 1 改成 3（fanout=3），万节点集群的收敛速度和每节点出口流量分别怎么变？为什么 Cassandra 宁可慢一点也不调大它？（提示：想想「每秒固定一两条」在 10 万节点时意味着什么。）
2. node4 重启后 generation 变大，各节点会清掉它的 phi 样本重学。如果不清，会发生什么？反过来，如果 version 也允许「跨代继承」，又坏在哪？（提示：`gms/Gossiper.java:1185-1194` 与重启后 version 从 0 重来。）
3. 一个节点的心跳间隔均值 1s、标准差很大（频繁 GC）。它实际停了 25 秒，phi 还没到 8，集群没标记它 DOWN。这是 gossip 的 bug 还是特性？对 id=47 的读写分别有什么影响？（提示：QUORUM 需要的是「回应请求」还是「被判活着」？）
4. 假设把 Cassandra 的 gossip 换成 ZooKeeper：写路径、故障切换语义各会多出什么依赖？回顾第 1 章的「对等」原则，说说为什么这个替换违背了它的设计初衷。（提示：想想 ZK 自身的 3/5 节点多数派是谁在养。）
