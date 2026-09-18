import { createHighlighter, type Highlighter } from 'shiki';
import { SHIKI_LANGS, SHIKI_THEMES, normalizeLang } from './config';

let instance: Highlighter | null = null;

/** 惰性创建并复用 Shiki 实例（创建一次约几百毫秒，避免每页重复开销） */
export async function getHighlighter(): Promise<Highlighter> {
  if (!instance) {
    instance = await createHighlighter({
      themes: [SHIKI_THEMES.light, SHIKI_THEMES.dark],
      langs: SHIKI_LANGS,
    });
  }
  return instance;
}

/**
 * 把一段代码高亮为 HTML。
 *
 * 使用双主题模式：Shiki 会同时输出 `--shiki-light` / `--shiki-dark` 两组 CSS 变量，
 * 由前端样式表根据当前主题选择其中一组，从而无需在切换主题时重新渲染。
 *
 * 任何异常都降级为「转义后的纯文本」，保证单段代码出错不会中断整站构建。
 */
export async function highlightCode(code: string, langRaw: string | undefined): Promise<{ html: string; lang: string }> {
  const lang = normalizeLang(langRaw);
  const highlighter = await getHighlighter();
  const isSupported = lang === 'text' || highlighter.getLoadedLanguages().includes(lang);

  if (!isSupported) {
    return { html: escapeHtml(code), lang };
  }

  try {
    const html = highlighter.codeToHtml(code, {
      lang: lang === 'text' ? 'text' : lang,
      themes: { light: SHIKI_THEMES.light, dark: SHIKI_THEMES.dark },
      defaultColor: false,
    });
    return { html, lang };
  } catch {
    return { html: escapeHtml(code), lang };
  }
}

/** 极简 HTML 转义，用于降级路径与纯文本代码块 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
