import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useShell } from '@/components/Layout';
import { EmptyState } from '@/components/ui/States';
import {
  COMPARE_LANGUAGES,
  COMPARE_TOPICS,
  LANGUAGE_LABEL,
  NO_EQUIVALENT_LABEL,
  type CompareCell,
  type LanguageId,
} from '@/data/compare';

export function ComparePage() {
  const { setRight } = useShell();
  const [activeId, setActiveId] = useState(COMPARE_TOPICS[0]?.id ?? '');
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setRight(null);
  }, [setRight]);

  const active = useMemo(
    () => COMPARE_TOPICS.find((topic) => topic.id === activeId) ?? COMPARE_TOPICS[0],
    [activeId],
  );

  // 只显示在该主题里至少出现过一次的语言列，避免出现整列空白
  const visibleLanguages = useMemo(() => {
    if (!active) return [];
    const used = new Set<string>();
    for (const row of active.rows) {
      for (const [lang, value] of Object.entries(row.cells)) {
        if (value) used.add(lang);
      }
    }
    return COMPARE_LANGUAGES.filter((lang) => used.has(lang) && !hidden.has(lang));
  }, [active, hidden]);

  const toggleLanguage = (lang: LanguageId): void => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(lang)) next.delete(lang);
      else next.add(lang);
      // 至少保留两列，否则表格失去对照意义
      return next.size >= COMPARE_LANGUAGES.length - 1 ? prev : next;
    });
  };

  return (
    // 对照表有五门语言，比常规正文宽得多：这里放开到 1280px，
    // 窄屏则由 .lh-table-wrap 横向滚动兜底，不压缩列宽。
    <div className="mx-auto max-w-[1280px]">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-tight sm:text-[30px]">对照中心</h1>
        <p className="mt-2.5 max-w-[640px] text-[14.5px] leading-[1.75] text-[var(--text-2)]">
          同一个概念在不同语言里怎么写。左边是 Java 的既有心智，右边是目标语言的对应做法——
          从「这行代码怎么翻译」而不是「这门语言有什么语法」开始学，迁移成本会低很多。
        </p>
      </header>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {COMPARE_LANGUAGES.map((lang) => {
          const off = hidden.has(lang);
          return (
            <button
              key={lang}
              type="button"
              onClick={() => toggleLanguage(lang)}
              aria-pressed={!off}
              className="lh-btn !h-7 !px-2.5 !text-[12px]"
              style={off ? { opacity: 0.45 } : undefined}
              title={off ? '点击显示该语言' : '点击隐藏该语言'}
            >
              {off ? null : <Icon name="check" size={11} />}
              {LANGUAGE_LABEL[lang]}
            </button>
          );
        })}
      </div>

      <div className="mb-6 flex flex-wrap gap-1.5 border-b border-[var(--border)] pb-3">
        {COMPARE_TOPICS.map((topic) => (
          <button
            key={topic.id}
            type="button"
            onClick={() => setActiveId(topic.id)}
            className="lh-btn !h-8 !text-[13px]"
            style={
              topic.id === active?.id
                ? {
                    background: 'var(--brand-soft)',
                    borderColor: 'color-mix(in srgb, var(--brand) 40%, transparent)',
                    color: 'var(--brand)',
                  }
                : undefined
            }
          >
            {topic.title}
          </button>
        ))}
      </div>

      {!active || visibleLanguages.length === 0 ? (
        <EmptyState title="没有可显示的对照内容" description="请至少保留两种语言。" />
      ) : (
        <section>
          <p className="mb-3 text-[13.5px] text-[var(--text-2)]">{active.description}</p>
          <div className="lh-table-wrap">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr>
                  <th className="min-w-[140px] bg-[var(--surface-2)] px-3 py-2.5 text-left font-medium">
                    概念
                  </th>
                  {visibleLanguages.map((lang) => (
                    // 语言列给足最小宽度：宁可整表横向滚动，也不要出现
                    // 「一列只有三四个字宽、代码被拆成竖条」的情况
                    <th
                      key={lang}
                      className="min-w-[160px] bg-[var(--surface-2)] px-3 py-2.5 text-left font-medium"
                    >
                      {LANGUAGE_LABEL[lang]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.rows.map((row) => (
                  <tr key={row.concept} className="align-top">
                    <td className="border-b border-[var(--border)] px-3 py-3">
                      <span className="font-medium text-[var(--text)]">{row.concept}</span>
                      {row.note ? (
                        <span className="mt-1 block text-[12px] leading-[1.6] text-[var(--text-3)]">
                          {row.note}
                        </span>
                      ) : null}
                    </td>
                    {visibleLanguages.map((lang) => (
                      <td key={lang} className="border-b border-[var(--border)] px-3 py-3">
                        <CellContent value={row.cells[lang]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * 单元格内容。三种状态必须一眼可分：
 *   · 字符串      → 代码或短语，等宽字体
 *   · AbsentCell  → 这门语言确实没有对应概念，弱化显示并附上原因
 *   · 空          → 还没写，显示「待补充」
 * 后两者语义完全不同，不要合并成一种灰色文字。
 */
function CellContent({ value }: { value: CompareCell | undefined }) {
  if (typeof value === 'string') {
    return (
      // pre-wrap 让数据里用 \n 主动断行的长方法链能真的换行；
      // break-words 兜底，避免个别超长 token 撑破单元格。
      <code className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6] text-[var(--text)]">
        {value}
      </code>
    );
  }

  if (value) {
    return (
      <span className="block">
        <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[11.5px] leading-none text-[var(--text-3)]">
          <Icon name="close" size={10} />
          {NO_EQUIVALENT_LABEL}
        </span>
        <span className="mt-1.5 block text-[12px] leading-[1.6] text-[var(--text-3)]">
          {value.reason}
        </span>
      </span>
    );
  }

  return <span className="text-[12.5px] text-[var(--text-3)]">待补充</span>;
}
