import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';

/**
 * 冒烟测试：在 jsdom 里真实渲染整个应用。
 *
 * 目的不是做单元测试，而是回答三个问题：
 *   1. 组件树能否挂载（有没有 import 错误、渲染期异常）；
 *   2. 首屏数据能否加载（内容 JSON 是否命中）；
 *   3. 关键页面是否渲染出预期内容。
 *
 * 任何 console.error 都会被当成失败，用来兜住 React 的警告与未捕获异常。
 */

const OUTPUT_DIR = path.resolve(import.meta.dirname, '../public/content');

const dom = new JSDOM('<!doctype html><html data-theme="dark"><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

const win = dom.window as unknown as Window & typeof globalThis;

// 把 jsdom 的全局搬到 Node 全局，让 React 与业务代码能正常运行
const g = globalThis as unknown as Record<string, unknown>;
// navigator 在 Node 22 是只读的 getter，必须用 defineProperty 覆盖
Object.defineProperty(globalThis, 'navigator', {
  value: win.navigator,
  configurable: true,
  writable: true,
});
g.window = win;
g.document = win.document;
// 站点把「主题」「侧边栏收起」这类阅读偏好存在 localStorage 里，
// 映射过来才能真的验证到落盘那一步（否则应用侧只会静默降级）
g.localStorage = win.localStorage;
g.HTMLElement = win.HTMLElement;
g.Element = win.Element;
g.Node = win.Node;
// 划线笔记读取锚点单元文本时要用到 TreeWalker 的 SHOW_TEXT 常量
g.NodeFilter = win.NodeFilter;
g.CSS = win.CSS;
g.getComputedStyle = win.getComputedStyle;
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16);
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 没有实现滚动，路由切换时会调用
win.scrollTo = (() => {}) as typeof win.scrollTo;

// jsdom 不实现 matchMedia
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

// jsdom 不实现 IntersectionObserver（TOC 会用到）
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

/** 把 /content/** 的请求映射到本地生成物 */
g.fetch = async (input: unknown): Promise<Response> => {
  const url = String(input);
  const marker = '/content/';
  const index = url.indexOf(marker);
  if (index === -1) {
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  }
  const relative = url.slice(index + marker.length).split('?')[0] ?? '';
  const filePath = path.join(OUTPUT_DIR, decodeURIComponent(relative));
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(text),
      text: async () => text,
    } as unknown as Response;
  } catch {
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  }
};

const consoleErrors: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => {
  consoleErrors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
  originalError(...args);
};

async function main(): Promise<void> {
  try {
    await fs.access(OUTPUT_DIR);
  } catch {
    throw new Error('未找到生成内容，请先执行 `pnpm content`');
  }

  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter } = await import('react-router-dom');
  const { App } = await import('../src/App');

  const mount = win.document.getElementById('root');
  if (!mount) throw new Error('缺少 #root 容器');

  /** 刷新一次宏任务队列，让 fetch 与状态更新在 act 内落地 */
  const flush = async (ms = 160): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  };

  /**
   * 每条用例独立挂载一棵树。
   * MemoryRouter 的 initialEntries 只在首次挂载时生效，
   * 复用同一个 root 做「换路由」是不可靠的。
   */
  const renderAt = async (route: string): Promise<{ html: string; container: HTMLElement }> => {
    const container = win.document.createElement('div');
    mount.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: [route] }, createElement(App)));
    });
    await flush();
    const html = container.innerHTML;
    return { html, container };
  };

  const checks: { name: string; route: string; expect: string[] }[] = [
    { name: '首页', route: '/', expect: ['From Java to X', 'Rust', '前端'] },
    { name: '轨道页', route: '/rust', expect: ['Rust', '教程', 'minidb'] },
    {
      name: '文档页',
      route: '/rust/tutorial/02-ownership',
      expect: ['所有权与生命周期', '本页目录', '分钟'],
    },
    {
      // minidb 已从「拆分页」改成按模块独立成文（track.json 里不再有 splitBy），
      // 所以这里校验的是普通项目页。若将来重新启用 splitBy，记得改回拆分页断言。
      name: '项目模块页',
      route: '/rust/project-minidb/04-compaction',
      expect: ['模块四', '本页目录', '墓碑'],
    },
    {
      name: '自定义组件页',
      route: '/frontend/guide/custom-blocks',
      expect: [
        '如何在文档里内联真实源码',
        '在仓库中查看',
        'KanbanDB',
        'codeRoots',
        // LangTabs 多语言对照块：标题与标签都要渲染出来
        '多语言语法对照',
        'TypeScript',
        'Python',
      ],
    },
    {
      name: '对照中心',
      route: '/compare',
      expect: [
        '对照中心',
        '错误处理',
        // 补全后新增的主题，确认都渲染成了可切换的标签
        '基础类型',
        '字符串',
        '函数与闭包',
        '结构体与面向对象',
        'Rust',
        'Python',
      ],
    },
    { name: '进度页', route: '/progress', expect: ['我的进度', '各轨道进度'] },
    // 单段未知路径会被当作「轨道不存在」，给出可操作的提示而不是裸 404
    { name: '未知轨道', route: '/not-exist-track', expect: ['没有找到这条轨道'] },
    // 多级未知路径才落到真正的 404
    { name: '404 页', route: '/a/b/c/d', expect: ['404'] },
    { name: '未知文档', route: '/rust/tutorial/not-exist', expect: ['页面不存在'] },
  ];

  let failed = 0;
  for (const check of checks) {
    const { html } = await renderAt(check.route);
    const missing = check.expect.filter((token) => !html.includes(token));
    if (missing.length > 0) {
      failed += 1;
      console.log(`✗ ${check.name}（${check.route}）缺少：${missing.join('、')}`);
    } else {
      console.log(`✓ ${check.name}（${check.route}）`);
    }
  }

  // 搜索面板：打开 → 输入中文关键词 → 校验检索链路
  {
    await renderAt('/');
    await act(async () => {
      win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    await flush(200);

    const dialog = win.document.querySelector('[role="dialog"]');
    const input = dialog?.querySelector('input');
    if (!input) {
      failed += 1;
      console.log('✗ 搜索面板未能打开或缺少输入框');
    } else {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, '所有权');
        input.dispatchEvent(new win.Event('input', { bubbles: true }));
      });
      await flush(250);
      const results = win.document.querySelectorAll('[role="dialog"] li');
      if (results.length === 0) {
        failed += 1;
        console.log('✗ 搜索「所有权」没有返回结果');
      } else {
        console.log(`✓ 搜索「所有权」命中 ${results.length} 条`);
      }
    }
  }

  // 对照中心：五种语言都能成列，且「无对应概念」与「待补充」必须区分开
  {
    const { container } = await renderAt('/compare');

    const headers = Array.from(container.querySelectorAll('thead th')).map(
      (th) => th.textContent?.trim() ?? '',
    );
    const wantLangs = ['Java', 'Rust', 'TypeScript', 'Go', 'Python'];
    const missing = wantLangs.filter((lang) => !headers.includes(lang));
    if (missing.length > 0) {
      failed += 1;
      console.log(`✗ 对照中心缺少语言列：${missing.join('、')}`);
    } else {
      console.log(`✓ 对照中心五种语言都能成列（共 ${headers.length - 1} 列）`);
    }

    // 切到「集合与迭代」：所有权陷阱那一行，除 Rust 外都该是「无对应概念」
    const topicButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '集合与迭代',
    );
    if (!topicButton) {
      failed += 1;
      console.log('✗ 对照中心缺少主题：集合与迭代');
    } else {
      await act(async () => {
        topicButton.click();
      });
      await flush(80);

      const text = container.textContent ?? '';
      const noneCount = (text.match(/无对应概念/g) ?? []).length;
      if (noneCount === 0) {
        failed += 1;
        console.log('✗ 「无对应概念」没有渲染出来');
      } else if (text.includes('待补充')) {
        failed += 1;
        console.log('✗ 数据补全后仍出现「待补充」占位');
      } else {
        console.log(`✓ 「无对应概念」标注 ${noneCount} 处，无「待补充」残留`);
      }
    }
  }

  // 多语言语法对照块：五个标签齐全，且切换后确实换掉面板内容
  {
    const { container } = await renderAt('/frontend/guide/custom-blocks');
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

    if (tabs.length === 0) {
      failed += 1;
      console.log('✗ 自定义组件页没有渲染出多语言对照标签');
    } else {
      const labels = tabs.map((tab) => tab.textContent?.trim() ?? '');
      const want = ['Java', 'TypeScript', 'Rust', 'Go', 'Python'];
      const missing = want.filter((label) => !labels.includes(label));

      if (missing.length > 0) {
        failed += 1;
        console.log(`✗ 多语言对照标签缺少：${missing.join('、')}（实际：${labels.join('/')}）`);
      } else {
        const panelBefore = container.querySelector('[role="tabpanel"]')?.textContent ?? '';
        const tsTab = tabs.find((tab) => tab.textContent?.trim() === 'TypeScript');
        await act(async () => {
          tsTab?.click();
        });
        await flush(80);
        const panelAfter = container.querySelector('[role="tabpanel"]')?.textContent ?? '';

        if (tsTab?.getAttribute('aria-selected') !== 'true' || panelAfter === panelBefore) {
          failed += 1;
          console.log('✗ 切换语言标签后面板内容没有更新');
        } else if (!panelAfter.includes('const count')) {
          failed += 1;
          console.log('✗ 切到 TypeScript 后没有看到对应的示例代码');
        } else {
          console.log(`✓ 多语言对照 ${labels.length} 个标签可切换（TypeScript 面板正常）`);
        }
      }
    }
  }

  // 自定义块标签泄漏：若 `<Callout …>正文</Callout>` 没被解析成块，页面上会显示原始标签文本。
  // 直接扫生成物，覆盖所有页面（不只是本次访问到的路由）。
  {
    interface InlineNode {
      type: string;
      value?: string;
    }
    interface ScanBlock {
      type?: string;
      inline?: InlineNode[];
      blocks?: ScanBlock[];
      items?: { nested?: ScanBlock[] }[];
    }

    const leaks: string[] = [];
    const scan = (blocks: ScanBlock[], file: string, trail: string): void => {
      blocks.forEach((block, index) => {
        const at = `${trail}[${index}]`;
        const leaked = (block.inline ?? []).some(
          (node) => node.type === 'raw' && /<\/?(?:Callout|LangTabs|SourceRef)\b/.test(node.value ?? ''),
        );
        if (leaked) leaks.push(`${file}${at}`);
        if (block.blocks) scan(block.blocks, file, at);
        (block.items ?? []).forEach((item, i) => {
          if (item.nested) scan(item.nested, file, `${at}.li${i}`);
        });
      });
    };

    const pageDir = path.join(OUTPUT_DIR, 'pages');
    for (const file of await fs.readdir(pageDir)) {
      const page = JSON.parse(await fs.readFile(path.join(pageDir, file), 'utf8')) as { blocks?: ScanBlock[] };
      scan(page.blocks ?? [], file, '');
    }

    if (leaks.length > 0) {
      failed += 1;
      console.log(`✗ 自定义块标签未解析，会以原始文本显示：${leaks.join('、')}`);
    } else {
      console.log('✓ 自定义块标签全部解析，无原始标签泄漏');
    }
  }

  // 划线笔记：选区 → 锚点 → 渲染 → 存储 → 列表 → 删除
  {
    win.localStorage.removeItem('lh-notes');
    const { container } = await renderAt('/rust/tutorial/02-ownership');

    /** 把单元内的字符偏移映射到 (文本节点, 偏移)，用于构造跨行内元素的选区 */
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

    const selectRange = (el: Element, from: number, to: number): string => {
      const a = locateOffset(el, from);
      const b = locateOffset(el, to);
      if (!a || !b) return '';
      const range = win.document.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      const selection = win.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return range.toString();
    };

    /** 模拟"松手"：真实用户拖选完必然会触发 mouseup，我们据此读取选区 */
    const lift = async (): Promise<void> => {
      await act(async () => {
        win.document.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true }));
      });
      await flush(140);
    };

    const clickByText = async (scope: ParentNode, text: string): Promise<boolean> => {
      const button = Array.from(scope.querySelectorAll('button')).find((item) =>
        (item.textContent ?? '').includes(text),
      );
      if (!button) return false;
      await act(async () => {
        (button as HTMLButtonElement).click();
      });
      await flush(120);
      return true;
    };

    /** 色点是动作不是单选框：按 data-color 点，别按文字找（文字会随样式变） */
    const clickSwatch = async (scope: ParentNode, color: string): Promise<boolean> => {
      const button = scope.querySelector<HTMLButtonElement>(`.lh-note-swatch[data-color="${color}"]`);
      if (!button) return false;
      await act(async () => {
        button.click();
      });
      await flush(120);
      return true;
    };

    interface StoredNote {
      id: string;
      style: string;
      /** 旧数据没有这个字段：兼容用例正是靠它验证回落 */
      color?: string;
      note: string;
      segments: { path: string; start: number; end: number; quote: string }[];
    }

    const readNotes = (): StoredNote[] => {
      const raw = win.localStorage.getItem('lh-notes');
      if (!raw) return [];
      return (JSON.parse(raw) as { notes: StoredNote[] }).notes;
    };

    const paragraph = Array.from(container.querySelectorAll<HTMLElement>('p[data-block-path]')).find(
      (el) => (el.textContent ?? '').length > 80,
    );
    const phrase = '所有权';
    const fullText = paragraph?.textContent ?? '';
    const at = fullText.indexOf(phrase);

    if (!paragraph || at < 0) {
      failed += 1;
      console.log('✗ 划线笔记：文档页没有可用于划线的段落');
    } else {
      // ① 拖选 → 弹出操作菜单（浮层走 portal 挂在 body 上，不在 container 里）
      selectRange(paragraph, at, at + phrase.length);
      await lift();
      const toolbar = win.document.querySelector('[role="toolbar"]');

      const swatchCount = toolbar ? toolbar.querySelectorAll('.lh-note-swatch').length : 0;

      if (!toolbar) {
        failed += 1;
        console.log('✗ 划线笔记：选中文字后没有弹出操作菜单');
      } else if (swatchCount !== 5) {
        failed += 1;
        console.log(`✗ 划线笔记：操作菜单里的色板不是 5 个色点（实际 ${swatchCount}）`);
      } else if (!(await clickSwatch(toolbar, 'yellow'))) {
        failed += 1;
        console.log('✗ 划线笔记：操作菜单里点不到黄色色点');
      } else {
        const records = readNotes();
        const segment = records[0]?.segments[0];
        const marks = Array.from(container.querySelectorAll('mark[data-note-id]'));

        if (records.length !== 1 || segment?.quote !== phrase) {
          failed += 1;
          console.log(
            `✗ 划线笔记：落库内容不符（条数=${records.length}，原文=${JSON.stringify(segment?.quote)}）`,
          );
        } else if (segment.start !== at) {
          failed += 1;
          console.log(`✗ 划线笔记：起止位置错误（期望 ${at}，实际 ${segment.start}）`);
        } else if (marks.length === 0 || marks[0].textContent !== phrase) {
          failed += 1;
          console.log('✗ 划线笔记：正文里没有画出对应的标记');
        } else if (records[0]?.style !== 'highlight' || records[0]?.color !== 'yellow') {
          failed += 1;
          console.log(`✗ 划线笔记：样式/颜色没有落库（style=${records[0]?.style}，color=${records[0]?.color}）`);
        } else if (!(marks[0] as HTMLElement).className.includes('lh-hl--c-yellow')) {
          failed += 1;
          console.log(`✗ 划线笔记：正文标记没带上颜色类（${(marks[0] as HTMLElement).className}）`);
        } else if (paragraph.textContent !== fullText) {
          failed += 1;
          console.log('✗ 划线笔记：切分标记时改动了正文文本');
        } else {
          console.log(`✓ 划线笔记：拖选「${phrase}」→ 高亮，坐标与原文均已落库（path=${segment.path}）`);
        }

        // ② 重复划线：同一段再划一次，不应产生第二条，而是引导编辑已有笔记
        selectRange(paragraph, at, at + phrase.length);
        await lift();
        const toolbar2 = win.document.querySelector('[role="toolbar"]');
        if (toolbar2) await clickSwatch(toolbar2, 'green');
        const toast = win.document.querySelector('[role="status"]')?.textContent ?? '';
        if (readNotes().length !== 1) {
          failed += 1;
          console.log(`✗ 划线笔记：重复划线产生了多条记录（${readNotes().length}）`);
        } else if (!toast.includes('已经划过')) {
          failed += 1;
          console.log(`✗ 划线笔记：重复划线没有给出提示（toast=${JSON.stringify(toast)}）`);
        } else {
          console.log('✓ 划线笔记：重复划线被识别并复用已有笔记');
        }

        // 关掉可能弹出的编辑弹层，避免影响后续步骤
        await act(async () => {
          win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
        });
        await flush(80);

        // ③ 统一列表入口：汇总本页笔记
        if (!(await clickByText(container, '划线笔记'))) {
          failed += 1;
          console.log('✗ 划线笔记：页头缺少笔记列表入口');
        } else {
          const drawer = win.document.querySelector('[aria-label="本页划线笔记"]');
          const cards = drawer ? Array.from(drawer.querySelectorAll('li')) : [];
          if (!drawer || cards.length !== 1) {
            failed += 1;
            console.log(`✗ 划线笔记：列表没有汇总出本页笔记（条目=${cards.length}）`);
          } else {
            console.log('✓ 划线笔记：列表入口汇总出本页全部笔记');

            // ③b 列表里直接换色：不用打开编辑弹层，记录与正文标记都要同步变
            if (!(await clickSwatch(cards[0], 'pink'))) {
              failed += 1;
              console.log('✗ 划线笔记：列表卡片上没有换色入口');
            } else {
              const recolored = readNotes()[0];
              const mark = container.querySelector('mark[data-note-id]') as HTMLElement | null;
              if (recolored?.color !== 'pink') {
                failed += 1;
                console.log(`✗ 划线笔记：列表换色没有落库（color=${recolored?.color}）`);
              } else if (!mark || !mark.className.includes('lh-hl--c-pink')) {
                failed += 1;
                console.log(`✗ 划线笔记：列表换色后正文标记没跟着变（${mark?.className}）`);
              } else {
                console.log('✓ 划线笔记：列表里换色，记录与正文标记同步更新');
              }
            }
          }

          // ④ 删除：删除后列表与正文标记都要一并消失
          const card = cards[0];
          const deleteButton = card?.querySelector<HTMLButtonElement>('button[aria-label="删除这条笔记"]');
          await act(async () => {
            deleteButton?.click();
          });
          await flush(80);
          if (card && (await clickByText(card, '确认删除'))) {
            const left = readNotes().length;
            const marksLeft = container.querySelectorAll('mark[data-note-id]').length;
            if (left !== 0 || marksLeft !== 0) {
              failed += 1;
              console.log(`✗ 划线笔记：删除后仍有残留（记录=${left}，标记=${marksLeft}）`);
            } else {
              console.log('✓ 划线笔记：删除后记录与正文标记同步清除');
            }
          } else {
            failed += 1;
            console.log('✗ 划线笔记：列表里没有删除入口');
          }
        }

        // ⑤ 旧数据兼容：改动前落库的笔记没有 color 字段（或值根本不在色板里），
        //    读出来要回落成默认蓝色，而且整条笔记不能因此被丢掉
        const legacyPath = paragraph.dataset.blockPath ?? '';
        const otherPara = Array.from(container.querySelectorAll<HTMLElement>('p[data-block-path]')).find(
          (el) => el !== paragraph && (el.textContent ?? '').length > 20,
        );
        const otherQuote = (otherPara?.textContent ?? '').slice(0, 4);
        const legacy = [
          {
            id: 'legacy-no-color',
            pageId: 'rust/tutorial/02-ownership',
            style: 'highlight',
            segments: [{ path: legacyPath, start: at, end: at + phrase.length, quote: phrase }],
            note: '',
            text: phrase,
            orphaned: false,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'legacy-bad-color',
            pageId: 'rust/tutorial/02-ownership',
            style: 'underline',
            color: 'not-a-color',
            segments: [{ path: otherPara?.dataset.blockPath ?? '', start: 0, end: otherQuote.length, quote: otherQuote }],
            note: '',
            text: otherQuote,
            orphaned: false,
            createdAt: 2,
            updatedAt: 2,
          },
        ];

        await act(async () => {
          win.localStorage.setItem('lh-notes', JSON.stringify({ version: 1, notes: legacy }));
          win.dispatchEvent(new win.StorageEvent('storage', { key: 'lh-notes' }));
        });
        await flush(160);

        const legacyMarks = Array.from(container.querySelectorAll<HTMLElement>('mark[data-note-id]'));
        if (legacyMarks.length !== 2) {
          failed += 1;
          console.log(`✗ 划线笔记：旧数据被丢弃了（只渲染出 ${legacyMarks.length} 个标记）`);
        } else if (!legacyMarks.every((mark) => mark.className.includes('lh-hl--c-blue'))) {
          failed += 1;
          console.log(
            `✗ 划线笔记：旧数据没有回落到默认蓝色（${legacyMarks.map((mark) => mark.className).join(' | ')}）`,
          );
        } else {
          console.log('✓ 划线笔记：旧数据（缺 color / color 非法）回落到默认蓝色且未被丢弃');
        }

        // 清掉，别把这两条带进后面的用例
        await act(async () => {
          win.localStorage.removeItem('lh-notes');
          win.dispatchEvent(new win.StorageEvent('storage', { key: 'lh-notes' }));
        });
        await flush(120);

        // 清空选区，并把两条计时器都排空：
        //   ① 选区去抖 320ms（落地时 setDraft）
        //   ② toast 2400ms（落地时 setToast(null)，由上面的删除 / 重复划线触发）
        // 只要还有一条在 act 之外落地，冒烟输出就会多一条 act 警告。
        await act(async () => {
          win.getSelection()?.removeAllRanges();
          await new Promise((resolve) => setTimeout(resolve, 380));
          // toast 消失后节点才卸载，轮询它比硬等一个常数稳（上限 3s）
          for (let i = 0; i < 30 && win.document.querySelector('[role="status"]'); i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        });
      }
    }
  }

  // 锚点模型的边界情况：重叠裁剪、内容变更后的重定位
  {
    const { collectUnits, subtractSegments, relocateSegments } = await import('../src/lib/note-anchor');

    const units = collectUnits([
      { type: 'paragraph', inline: [{ type: 'text', value: '甲乙丙丁戊己庚辛' }] },
      { type: 'list', ordered: false, items: [{ checked: null, children: [{ type: 'text', value: '子项一' }], nested: null }] },
      { type: 'quote', blocks: [{ type: 'paragraph', inline: [{ type: 'text', value: '引用段' }] }] },
    ]);
    const paths = units.map((unit) => unit.path).join('|');
    if (paths !== '0|1.0|2.0') {
      failed += 1;
      console.log(`✗ 锚点模型：路径与渲染结构不一致（${paths}）`);
    } else {
      console.log(`✓ 锚点模型：路径与渲染结构一致（${paths}）`);
    }

    // 部分重叠 → 只划空出来的部分；完全覆盖 → 不产生新片段
    const partial = subtractSegments(
      [{ path: '0', text: '甲乙丙丁戊己庚辛', start: 0, end: 10 }],
      [{ path: '0', start: 3, end: 6, quote: '丁戊己' }],
    );
    const covered = subtractSegments(
      [{ path: '0', text: '甲乙丙丁戊己庚辛', start: 3, end: 6 }],
      [{ path: '0', start: 0, end: 10, quote: '甲乙丙丁戊己庚辛' }],
    );
    if (partial.length !== 2 || partial[0].quote !== '甲乙丙' || partial[1].quote !== '庚辛') {
      failed += 1;
      console.log(`✗ 锚点模型：重叠裁剪结果不符（${JSON.stringify(partial)}）`);
    } else if (covered.length !== 0) {
      failed += 1;
      console.log('✗ 锚点模型：完全覆盖时应返回空片段');
    } else {
      console.log('✓ 锚点模型：重叠裁剪正确，且不会改动已有笔记');
    }

    // 内容更新后：同段落位移可自愈；出现歧义时保留数据并标记失效
    const shifted = relocateSegments([{ path: '0', start: 2, end: 4, quote: '丙丁' }], [
      { path: '0', text: '前言甲乙丙丁戊己庚辛' },
    ]);
    const lost = relocateSegments([{ path: '0', start: 0, end: 2, quote: '这个词已经不存在了' }], [
      { path: '0', text: '甲乙丙丁戊己庚辛' },
    ]);
    if (!shifted.changed || shifted.segments[0].start !== 4 || shifted.orphaned) {
      failed += 1;
      console.log(`✗ 锚点模型：位移自愈失败（${JSON.stringify(shifted)}）`);
    } else if (!lost.orphaned || lost.segments.length !== 1) {
      failed += 1;
      console.log('✗ 锚点模型：找不到原文时应保留数据并标记失效');
    } else {
      console.log('✓ 锚点模型：位移可自愈，失效时保留原数据');
    }
  }

  // 侧边栏整列收起：点开关 → data-collapsed / inert 翻转 + 偏好落盘
  {
    const aside = (): Element | null => win.document.querySelector('#desktop-sidebar');
    const toggle = (): HTMLButtonElement | null =>
      win.document.querySelector<HTMLButtonElement>('button[aria-label*="侧边导航"]');

    if (!aside() || !toggle()) {
      failed += 1;
      console.log('✗ 桌面侧边栏或它的开关没有渲染出来');
    } else {
      const before = aside()?.getAttribute('data-collapsed');
      await act(async () => {
        toggle()?.click();
      });
      await flush(80);
      const after = aside()?.getAttribute('data-collapsed');
      const stored = win.localStorage.getItem('lh-sidebar');
      const expectStored = after === 'true' ? 'collapsed' : 'expanded';

      if (before === after || stored !== expectStored || aside()?.hasAttribute('inert') !== (after === 'true')) {
        failed += 1;
        console.log(
          `✗ 侧边栏收起异常（${before} → ${after}，inert=${aside()?.hasAttribute('inert')}，localStorage=${stored}）`,
        );
      } else {
        console.log(`✓ 侧边栏可收起（${before} → ${after}，偏好已落盘：${stored}）`);
        await act(async () => {
          toggle()?.click();
        });
        await flush(60);
      }
    }
  }

  // 主题切换：验证不会抛错且 data-theme 会翻转
  {
    const before = win.document.documentElement.getAttribute('data-theme');
    await act(async () => {
      const button = win.document.querySelector<HTMLButtonElement>('button[aria-label*="切换到"]');
      button?.click();
    });
    await flush(80);
    const after = win.document.documentElement.getAttribute('data-theme');
    if (before === after) {
      failed += 1;
      console.log('✗ 主题切换未生效');
    } else {
      console.log(`✓ 主题切换 ${before} → ${after}`);
    }
  }

  if (consoleErrors.length > 0) {
    failed += 1;
    console.log(`\n✗ 控制台出现 ${consoleErrors.length} 条错误：`);
    for (const message of consoleErrors.slice(0, 8)) console.log(`  - ${message}`);
  }

  if (failed > 0) {
    console.log(`\n冒烟测试失败：${failed} 项`);
    process.exit(1);
  }
  console.log('\n✓ 冒烟测试全部通过');
}

main().catch((error: unknown) => {
  console.error('冒烟测试异常：', error);
  process.exit(1);
});
