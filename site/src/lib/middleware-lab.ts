/**
 * 中间件 · Pulsar 互动原理实验室 · 章节数据（单一事实源）。
 *
 * 每章对应 tracks/middleware/tutorial/ 下的一篇文章与一个自包含 HTML 图解
 * （site/public/middleware-lab/<file>）。HTML 由「动态原理可视化」流程产出：
 * 白底六阶段结构、公式驱动 SVG 动画（自动 + 分步双模式）、部件点选高亮、自测题。
 */

import type { LabChapter } from '@/lib/lab';

export const MIDDLEWARE_LAB = {
  trackId: 'middleware',
  title: 'Pulsar 互动原理实验室',
  subtitle:
    '七章动态图解：从一条消息的旅程，到三本账、订阅开关、函数循环、连接器、四道边界，最后是数据的一生。每页都能自动运转，也能按步骤定格。',
  route: '/middleware/lab',
  baseDir: 'middleware-lab',
  chapters: [
    {
      id: '01-message-journey',
      file: '01-message-journey.html',
      title: '一条消息的旅程',
      principle: 'Lookup → 生产 → 账本 → quorum → 分发 → ack：四层架构的一条完整链路',
      articleRoute: '/middleware/tutorial/01-architecture',
      articleTitle: '整体架构：一条消息最后落在谁手里',
    },
    {
      id: '02-three-ledgers',
      file: '02-three-ledgers.html',
      title: '三本账',
      principle: '数据账在 Bookie，索引账在元数据，进度账在游标；三者更新频率完全不同',
      articleRoute: '/middleware/tutorial/02-broker-ledger',
      articleTitle: 'Broker 与账本：数据、索引、进度这三本账',
    },
    {
      id: '03-subscription-switch',
      file: '03-subscription-switch.html',
      title: '订阅开关',
      principle: 'Exclusive / Failover / Shared / Key_Shared：顺序、扩展、故障切换的三角',
      articleRoute: '/middleware/tutorial/03-messaging-subscriptions',
      articleTitle: '消息模型：生产、消费与四种订阅的取舍',
    },
    {
      id: '04-function-loop',
      file: '04-function-loop.html',
      title: '函数循环',
      principle: 'Worker 管放哪，实例管怎么跑；ack 时机决定至少一次还是最多一次',
      articleRoute: '/middleware/tutorial/04-functions-io',
      articleTitle: 'Functions 与 IO：把计算搬进消息系统',
    },
    {
      id: '05-four-borders',
      file: '05-four-borders.html',
      title: '四道边界',
      principle: '事务可见性、分层存储、bundle 归属、背压：一条消息穿过四种工程边界',
      articleRoute: '/middleware/tutorial/05-transactions-tiered',
      articleTitle: '事务、卸载与负载均衡：把意外收进工程边界',
    },
    {
      id: '06-io-connector',
      file: '06-io-connector.html',
      title: '连接器',
      principle: 'Source 拉进来、Sink 推出去：契约只有 read 和 write，运行时还是那个函数实例',
      articleRoute: '/middleware/tutorial/04-functions-io',
      articleTitle: 'Functions 与 IO：把计算搬进消息系统',
    },
    {
      id: '07-data-lifecycle',
      file: '07-data-lifecycle.html',
      title: '数据的一生',
      principle: 'ack 只记账、保留定边界、后台才真删：压缩改读视图，卸载改读路径',
      articleRoute: '/middleware/tutorial/02-broker-ledger',
      articleTitle: 'Broker 与账本：数据、索引、进度这三本账',
    },
  ] satisfies LabChapter[],
} as const;
