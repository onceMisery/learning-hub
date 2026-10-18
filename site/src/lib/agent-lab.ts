/**
 * Agent 互动原理实验室 · 章节数据（单一事实源）。
 *
 * 每章对应 tracks/agent/tutorial/ 下的一篇文章与一个自包含 HTML 图解
 * （site/public/agent-lab/<file>）。HTML 由「动态原理可视化」流程产出：
 * 白底六阶段结构、公式驱动 SVG 动画（自动 + 分步双模式）、部件点选高亮、自测题。
 *
 * iframe 的 src 用 import.meta.env.BASE_URL 拼接，同时适配两种部署：
 * Vercel 根域名（base 为 /）与 GitHub Pages 子路径（base 为 /learning-hub/）。
 */

export interface LabChapter {
  /** URL 片段，如 /agent/lab/01-intent-triage */
  id: string;
  /** public/agent-lab/ 下的文件名 */
  file: string;
  /** 章节标题 */
  title: string;
  /** 一句话原理 */
  principle: string;
  /** 对应文章路由（站内 SPA 路由，直接 <Link> 可达） */
  articleRoute: string;
  articleTitle: string;
}

export const AGENT_LAB = {
  trackId: 'agent',
  title: '互动原理实验室',
  subtitle:
    '七章动态图解：把 Agent 运行的每个关键原理，做成能看、能点、能测的一页课。每章遵循同一条认知链——表象 → 结构 → 流程 → 融合 → 环境 → 自测。',
  /** 实验室根路由（ AgentLabPage 渲染） */
  route: '/agent/lab',
  chapters: [
    {
      id: '01-intent-triage',
      file: '01-intent-triage.html',
      title: '意图分诊台',
      principle: '三层级联 + 置信度闸门 + 控制契约：Agent 的第一道控制决策',
      articleRoute: '/agent/tutorial/01-intent-recognition',
      articleTitle: '意图识别：Agent 的第一道分诊台',
    },
    {
      id: '02-tao-loop',
      file: '02-tao-loop.html',
      title: 'TAO 循环',
      principle: '以大模型为变迁引擎的状态机，外加预算与熔断治理',
      articleRoute: '/agent/tutorial/02-execution-core',
      articleTitle: '执行核心：把「边想边做」装进可恢复的循环',
    },
    {
      id: '03-context-function',
      file: '03-context-function.html',
      title: '上下文管理 f 函数',
      principle: 'Window = f(Context)：五段流水线 + P0-P3 分诊 + Lost in the Middle',
      articleRoute: '/agent/tutorial/03-context-management',
      articleTitle: '上下文管理：把「模型看见什么」做成一个函数',
    },
    {
      id: '04-routing-recall',
      file: '04-routing-recall.html',
      title: '分路召回',
      principle: '确定域走规则路、概率域走向量路：让该在场的必须到场',
      articleRoute: '/agent/tutorial/04-retrieval-rag',
      articleTitle: '检索与 RAG：概率系统里的最小充分检索',
    },
    {
      id: '05-eval-loop',
      file: '05-eval-loop.html',
      title: '评估闭环',
      principle: '双平面打分 + Judge + 回归门禁：把「好不好」变成可验证的工程问题',
      articleRoute: '/agent/tutorial/05-evaluation-feedback',
      articleTitle: '评估与反馈：把「好不好」变成可验证的工程问题',
    },
    {
      id: '06-handoff-customs',
      file: '06-handoff-customs.html',
      title: '过境海关',
      principle: '下行走白名单任务包、上行过五道关：协作的边界语言',
      articleRoute: '/agent/tutorial/06-collaboration-governance',
      articleTitle: '协作与治理：把边界写清楚，才敢把事交出去',
    },
    {
      id: '07-axis-framework',
      file: '07-axis-framework.html',
      title: '双轴坐标系',
      principle: '七脉认知功能 × 六式执行拓扑：给 Agent 系统一个唯一地址',
      articleRoute: '/agent/tutorial/07-project-deep-dive',
      articleTitle: '项目深挖与工程表达：把系统讲出深度，把源码读出判断',
    },
  ] satisfies LabChapter[],
} as const;

/** 章节 HTML 的站内地址（自动适配 Vercel base=/ 与 GitHub Pages base=/learning-hub/） */
export function labChapterUrl(file: string): string {
  // import.meta.env 由 Vite 在构建期替换；tsx 直跑（冒烟脚本）时它为 undefined，
  // 用 ?? 兜底成 '/'，两种环境都能给出正确地址。
  const base = import.meta.env?.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}agent-lab/${file}`;
}
