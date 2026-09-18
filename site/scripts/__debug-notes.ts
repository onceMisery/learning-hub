import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const OUTPUT_DIR = path.resolve(import.meta.dirname, '../public/content');

const dom = new JSDOM('<!doctype html><html data-theme="dark"><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const win = dom.window as unknown as Window & typeof globalThis;
const g = globalThis as unknown as Record<string, unknown>;

Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true, writable: true });
g.window = win;
g.document = win.document;
g.localStorage = win.localStorage;
g.HTMLElement = win.HTMLElement;
g.Element = win.Element;
g.Node = win.Node;
g.NodeFilter = win.NodeFilter;
g.CSS = win.CSS;
g.getComputedStyle = win.getComputedStyle;
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16);
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;
win.scrollTo = (() => {}) as typeof win.scrollTo;
win.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as typeof win.matchMedia;
class FakeIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
g.IntersectionObserver = FakeIntersectionObserver;
(win as unknown as Record<string, unknown>).IntersectionObserver = FakeIntersectionObserver;

g.fetch = async (input: unknown): Promise<Response> => {
  const url = String(input);
  const marker = '/content/';
  const index = url.indexOf(marker);
  if (index === -1) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  const relative = url.slice(index + marker.length).split('?')[0] ?? '';
  const filePath = path.join(OUTPUT_DIR, decodeURIComponent(relative));
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text } as unknown as Response;
  } catch {
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  }
};

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { App } = await import('../src/App');

const mount = win.document.getElementById('root') as HTMLElement;
const container = win.document.createElement('div');
mount.appendChild(container);
const root = createRoot(container);
await act(async () => {
  root.render(createElement(MemoryRouter, { initialEntries: ['/rust/tutorial/02-ownership'] }, createElement(App)));
});
const flush = async (ms = 200): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};
await flush(320);

const notesButton = (): HTMLButtonElement | undefined =>
  Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('划线笔记'));

const probe = (label: string): void => {
  const raw = win.localStorage.getItem('lh-notes');
  const count = raw ? (JSON.parse(raw) as { notes: unknown[] }).notes.length : 0;
  console.log(
    `[${label}] 存储=${count} 页头徽标=${JSON.stringify(notesButton()?.textContent)} ` +
      `container内mark=${container.querySelectorAll('mark[data-note-id]').length} ` +
      `全文档mark=${win.document.querySelectorAll('mark[data-note-id]').length}`,
  );
};

const paragraph = Array.from(container.querySelectorAll<HTMLElement>('p[data-block-path]')).find(
  (el) => (el.textContent ?? '').length > 80,
) as HTMLElement;
const phrase = '所有权';
const at = (paragraph.textContent ?? '').indexOf(phrase);

const locateOffset = (el: Element, offset: number): { node: Node; offset: number } | null => {
  const walker = win.document.createTreeWalker(el, win.NodeFilter.SHOW_TEXT);
  let seen = 0;
  let node = walker.nextNode();
  while (node) {
    const length = node.nodeValue?.length ?? 0;
    if (offset <= seen + length) return { node, offset: offset - seen };
    seen += length;
    node = walker.nextNode();
  }
  return null;
};

const a = locateOffset(paragraph, at);
const b = locateOffset(paragraph, at + phrase.length);
const range = win.document.createRange();
range.setStart(a!.node, a!.offset);
range.setEnd(b!.node, b!.offset);
const selection = win.getSelection();
selection?.removeAllRanges();
selection?.addRange(range);

probe('划之前');

await act(async () => {
  win.document.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true }));
});
await flush(160);

const toolbar = win.document.querySelector('[role="toolbar"]');
console.log('toolbar:', !!toolbar);
const highlight = Array.from(toolbar?.querySelectorAll('button') ?? []).find((btn) =>
  (btn.textContent ?? '').includes('高亮'),
);
console.log('高亮按钮:', !!highlight);

await act(async () => {
  (highlight as HTMLButtonElement)?.click();
});
await flush(160);
probe('高亮之后');

console.log('段落 HTML 片段:', paragraph.innerHTML.slice(0, 200));
console.log('全文档 body 子节点:', Array.from(win.document.body.children).map((el) => el.tagName + '#' + (el.id || el.getAttribute('role') || '')));

process.exit(0);
