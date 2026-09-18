import { Icon } from '../Icon';
import { CodeBlock } from './CodeBlock';

interface SourceRefProps {
  repo: string;
  file: string;
  lines: string | null;
  symbol: string | null;
  caption: string | null;
  code: string | null;
  html: string | null;
  lang: string;
  error: string | null;
  /** 仓库地址，用于拼接「在仓库中查看」 */
  repoUrl?: string;
  /** 源码所在的轨道目录，形如 tracks/frontend */
  trackDir?: string;
}

/**
 * 源码内联引用。
 *
 * 构建期按 `codeRoots` 白名单读取真实文件内容，
 * 因此文档里展示的代码永远与仓库里的代码一致，不会随重构而失效。
 * 解析失败（文件移动、白名单不含该路径）时给出明确提示而不是留白。
 */
export function SourceRef({
  file,
  lines,
  symbol,
  caption,
  code,
  html,
  lang,
  error,
  repoUrl,
  trackDir,
}: SourceRefProps) {
  const location = [lines ? `L${lines}` : null, symbol ? `@${symbol}` : null].filter(Boolean).join(' ');
  const blobUrl =
    repoUrl && trackDir
      ? `${repoUrl}/blob/main/${trackDir}/${file.split('/').map(encodeURIComponent).join('/')}`
      : null;

  return (
    <figure className="my-6 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-[12.5px]">
          <span className="text-[var(--text-3)]">
            <Icon name="file" size={14} />
          </span>
          <code className="truncate font-mono text-[12.5px] text-[var(--text)]">{file}</code>
          {location ? <span className="lh-chip">{location}</span> : null}
        </span>
        {blobUrl ? (
          <a
            className="lh-btn"
            style={{ height: 24, padding: '0 8px', fontSize: 11.5 }}
            href={blobUrl}
            target="_blank"
            rel="noreferrer"
          >
            在仓库中查看
            <Icon name="external" size={12} />
          </a>
        ) : null}
      </div>

      {error || !code || !html ? (
        <div className="px-4 py-5 text-[13.5px] text-[var(--warn)]">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="alert" size={14} />
            {error ?? '未能读取该源码片段'}
          </span>
          <p className="mt-1.5 text-[12.5px] text-[var(--text-3)]">
            请检查 track.json 的 codeRoots 是否包含该文件，以及路径是否仍然有效。
          </p>
        </div>
      ) : (
        <div className="[&_.lh-code]:rounded-none [&_.lh-code]:border-0">
          <CodeBlock html={html} code={code} lang={lang} lines={code.split('\n').length} />
        </div>
      )}

      {caption ? (
        <figcaption className="border-t border-[var(--border)] px-4 py-2 text-[12.5px] text-[var(--text-3)]">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
