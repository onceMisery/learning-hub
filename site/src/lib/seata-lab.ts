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
    '十三章动态图解：从一条 XID 的旅程、角色接力、AT/TCC/Saga/XA、SQL 流水线，到 TC 状态机、锁生命周期与事务传播边界。',
  route: '/seata/lab',
  baseDir: 'seata-lab',
  chapters: [
    {
      id: '01-xid-journey',
      file: '01-xid-journey.html',
      title: '一条 XID 的旅程',
      principle: 'TM 发起 → TC 建会话 → RM 注册分支 → 两阶段收尾：一条全局事务的完整链路',
      articleRoute: '/seata/architecture/01-architecture',
      articleTitle: '从一条 XID 看 Seata 的分层',
    },
    {
      id: '02-at-phase-one',
      file: '02-at-phase-one.html',
      title: '镜像与锁',
      principle: 'SQL → 前后镜像 → 锁键注册 → undo_log → 本地提交：AT 一阶段的严格顺序',
      articleRoute: '/seata/modes/01-at',
      articleTitle: 'AT 模式：自动补偿',
    },
    {
      id: '03-at-phase-two',
      file: '03-at-phase-two.html',
      title: '提交与回滚',
      principle: '提交先返回、后清理；回滚先改数据、后返回：两条不对称的二阶段时间线',
      articleRoute: '/seata/modes/01-at',
      articleTitle: 'AT 模式：自动补偿',
    },
    {
      id: '04-tc-ledger',
      file: '04-tc-ledger.html',
      title: 'TC 的账本',
      principle: '会话状态机、超时重试、四种存储与 raft 选主后的会话恢复',
      articleRoute: '/seata/server/03-raft-ha',
      articleTitle: 'Raft 集群与高可用：一台 TC 倒下之后',
    },
    {
      id: '05-tcc-saga-xa',
      file: '05-tcc-saga-xa.html',
      title: '三种补偿',
      principle: 'TCC 交给方法、Saga 交给补偿链、XA 交给数据库：锁、可见性与回滚执行者',
      articleRoute: '/seata/modes/02-tcc',
      articleTitle: 'TCC 模式：尝试-确认-取消',
    },
    {
      id: '06-xid-boundaries',
      file: '06-xid-boundaries.html',
      title: 'XID 的三条边界',
      principle: '线程、代理、模式：XID 有但分支没有的三个断点，以及一张诊断矩阵',
      articleRoute: '/seata/propagation/01-transaction-propagation',
      articleTitle: '事务传播：XID 怎么过线程、RPC 和模式边界',
    },
    {
      id: '07-roles-relay',
      file: '07-roles-relay.html',
      title: '三个角色如何接力',
      principle: 'TM 发决议，TC 记会话和锁，RM 动数据：三条泳道按相位对齐',
      articleRoute: '/seata/roles/01-tc',
      articleTitle: '事务协调者 TC：状态机、会话和那把锁',
    },
    {
      id: '08-tcc-fence',
      file: '08-tcc-fence.html',
      title: 'TCC 的三种坑',
      principle: '空回滚、幂等、悬挂，以及 fence 的 TRIED / COMMITTED / ROLLBACKED / SUSPENDED',
      articleRoute: '/seata/modes/02-tcc',
      articleTitle: 'TCC 模式：尝试-确认-取消',
    },
    {
      id: '09-saga-compensation',
      file: '09-saga-compensation.html',
      title: 'Saga 的状态机',
      principle: '正向本地事务链，失败后从状态栈逆序补偿；TC 的 commit 可能只是 forward',
      articleRoute: '/seata/modes/03-saga',
      articleTitle: 'Saga 模式：长事务',
    },
    {
      id: '10-sql-pipeline',
      file: '10-sql-pipeline.html',
      title: '一条 SQL 的流水线',
      principle: 'SQL → 解析 → 识别 → 镜像 → undo_log；解析异常与 PlainExecutor 是两条不同的边界',
      articleRoute: '/seata/sql/01-sql-parsing',
      articleTitle: 'SQL 解析与重写',
    },
    {
      id: '11-integration-chain',
      file: '11-integration-chain.html',
      title: '从 Spring Boot 到 TC',
      principle: '自动配置、数据源代理、配置加载、TC 地址发现：接入 Seata 的三条链',
      articleRoute: '/seata/integration/01-spring-boot',
      articleTitle: 'Spring Boot 集成',
    },
    {
      id: '12-session-lock',
      file: '12-session-lock.html',
      title: '会话与锁的生命周期',
      principle: '会话锁保护同一 XID，全局行锁保护同一行；提交提前放锁，回滚失败默认保留',
      articleRoute: '/seata/server/01-session-lock',
      articleTitle: '会话与锁管理',
    },
    {
      id: '13-xa-visibility',
      file: '13-xa-visibility.html',
      title: 'XA 的两阶段与可见性',
      principle: 'XA START 持锁，PREPARE 后仍不可见，XA COMMIT 后才可见；没有 TC 全局锁',
      articleRoute: '/seata/modes/04-xa',
      articleTitle: 'XA 模式：两阶段提交',
    },
  ] satisfies LabChapter[],
} as const;
