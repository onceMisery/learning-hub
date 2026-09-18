import fs from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR } from './lib/config';
import { loadTracks, planPages, validateTracks, type PlanIssue } from './lib/plan';

/**
 * 内容体检：只做静态校验，不生成产物。
 *
 * 用于 CI 的 PR 门禁——配置写错、源文件丢失、slug 重复都能在合入前拦下。
 * 断链检查结果来自上一次 build-content 写下的 report.json。
 */
function main(): void {
  const issues: PlanIssue[] = [];
  const tracks = loadTracks(issues);
  validateTracks(tracks, issues);
  const planned = planPages(tracks, issues);

  let hasError = false;
  for (const issue of issues) {
    if (issue.level === 'error') hasError = true;
    console.log(`${issue.level === 'error' ? '✗' : '⚠'} ${issue.message}${issue.at ? ` (${issue.at})` : ''}`);
  }

  const reportPath = path.join(OUTPUT_DIR, 'report.json');
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as {
      brokenLinks: { raw: string; from: string }[];
    };
    for (const link of report.brokenLinks) {
      console.log(`⚠ 断链：${link.raw}  <-  ${link.from}`);
    }
    if (report.brokenLinks.length > 0) {
      console.log(`\n共 ${report.brokenLinks.length} 个断链（不会阻断构建，但应尽快修复）`);
    }
  } else {
    console.log('ℹ 未找到 report.json，跳过断链检查（先运行 npm run content）');
  }

  console.log(`\n共规划 ${planned.length} 个页面，发现 ${issues.filter((i) => i.level === 'error').length} 个错误`);

  if (hasError) process.exit(1);
}

main();
