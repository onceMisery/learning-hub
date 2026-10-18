/**
 * 分布式事务 · Seata 互动原理实验室 · 章节数据（单一事实源）。
 *
 * 每章对应 tracks/seata/tutorial/ 下的一篇文章与一个自包含 HTML 图解
 * （site/public/seata-lab/<file>）。HTML 由「动态原理可视化」流程产出：
 * 白底六阶段结构、相位驱动 SVG 动画（自动 + 分步双模式）、部件点选高亮、自测题。
 */

import type { LabChapter } from '@/lib/lab';

export const SEATA_LAB = {
  trackId: 'seata',
  title: 'Seata 互动原理实验室',
  subtitle:
    '六章动态图解：一条 XID 的旅程、AT 的镜像与锁、二阶段的两条时间线、TC 的状态机与账本、三种补偿模式，以及 XID 的三条边界。',
  route: '/seata/lab',
  baseDir: 'seata-lab',
  chapters: [
    {
      id: '01-xid-journey',
      file: '01-xid-journey.html',
      title: '一条 XID 的旅程',
      principle: 'TM 发起 → TC 建会话 → RM 注册分支 → 两阶段收尾：一条全局事务的完整链路',
      articleRoute: '/seata/tutorial/01-global-transaction',
      articleTitle: '全局事务：一条 XID 从 begin 走到 commit',
    },
    {
      id: '02-at-phase-one',
      file: '02-at-phase-one.html',
      title: '镜像与锁',
      principle: 'SQL → 前后镜像 → 锁键注册 → undo_log → 本地提交：AT 一阶段的严格顺序',
      articleRoute: '/seata/tutorial/02-at-phase-one',
      articleTitle: 'AT 一阶段：一条 UPDATE 怎么变成 undo log 和一把全局锁',
    },
    {
      id: '03-at-phase-two',
      file: '03-at-phase-two.html',
      title: '提交与回滚',
      principle: '提交先返回、后清理；回滚先改数据、后返回：两条不对称的二阶段时间线',
      articleRoute: '/seata/tutorial/03-at-phase-two',
      articleTitle: 'AT 二阶段：提交为什么先返回，回滚怎么把数据倒放',
    },
    {
      id: '04-tc-ledger',
      file: '04-tc-ledger.html',
      title: 'TC 的账本',
      principle: '会话状态机、超时重试、四种存储与 raft 选主后的会话恢复',
      articleRoute: '/seata/tutorial/04-tc-ledger',
      articleTitle: 'TC 的账本：状态机、超时重试与一台服务器倒下之后',
    },
    {
      id: '05-tcc-saga-xa',
      file: '05-tcc-saga-xa.html',
      title: '三种补偿',
      principle: 'TCC 交给方法、Saga 交给补偿链、XA 交给数据库：锁、可见性与回滚执行者',
      articleRoute: '/seata/tutorial/05-tcc-saga-xa',
      articleTitle: 'TCC、Saga、XA：三种把回滚交给别人的方式',
    },
    {
      id: '06-xid-boundaries',
      file: '06-xid-boundaries.html',
      title: 'XID 的三条边界',
      principle: '线程、代理、模式：XID 有但分支没有的三个断点，以及一张诊断矩阵',
      articleRoute: '/seata/tutorial/06-xid-boundary',
      articleTitle: 'XID 的边界：传播、代理与那些看起来在事务里的调用',
    },
  ] satisfies LabChapter[],
} as const;
