# 05 · 阶段 4：Dexie 本地数据层（离线优先的地基）

## 学完你能做什么

- 把应用数据存进 IndexedDB，做到"关掉重开数据还在"
- 设计可被索引查询的 schema，并在需求变化时安全地做**版本迁移**
- 用事务保证跨表写入的原子性，用批量 API 把 5000 条写入从分钟级压到秒级
- 用 `useLiveQuery` 让 UI 自动跟着数据变，彻底删掉"改完记得刷新"这类逻辑

**前置**：阶段 3（React 组件）。

---

## 1. 为什么是 Dexie，而不是 localStorage 或 SQLite

| 方案 | 容量 | API | 查询能力 | 结论 |
| --- | --- | --- | --- | --- |
| `localStorage` | ~5MB | **同步**（大数据会卡住 UI） | 无，只能全量取出来自己筛 | 只适合放几个配置项 |
| `sessionStorage` | ~5MB | 同步 | 无 | 临时状态 |
| **Dexie / IndexedDB** | 按磁盘余量（GB 级） | 异步 Promise | 索引、范围查询、排序、事务 | **本项目选择** |
| SQLite（better-sqlite3） | 大 | 同步（阻塞）或异步 | 完整 SQL | 需要原生模块：ABI 与 Electron 版本必须匹配，打包复杂；且渲染进程用不了 |

**Dexie 是 IndexedDB 的封装**：原生 IndexedDB 是事件式 API（打开数据库 → 建事务 → 发请求 → 监听 `onsuccess`），写个查询要 30 行；Dexie 把它变成 `await db.cards.where('columnId').equals(id).toArray()`。

---

## 2. Schema 与索引（`src/renderer/db/db.ts`）

```ts
export class KanbanDB extends Dexie {
  boards!: Table<Board, string>;
  columns!: Table<Column, string>;
  cards!: Table<Card, string>;

  constructor() {
    super('lumen-kanban');

    this.version(1).stores({
      boards: 'id, name, createdAt',
      columns: 'id, boardId, order, [boardId+order]',
      cards: 'id, columnId, boardId, done, updatedAt, [boardId+columnId], *tags',
    });

    this.version(2)
      .stores({
        cards: 'id, columnId, boardId, done, updatedAt, priority, [boardId+columnId], *tags',
      })
      .upgrade(async (tx) => {
        await tx.table('cards').toCollection().modify((card: Card) => {
          if (typeof card.priority !== 'number') card.priority = 1;
        });
      });
  }
}
```

索引语法速查：

| 写法 | 含义 |
| --- | --- |
| `id` | 主键（第一个字段） |
| `columnId` | 普通索引 |
| `[boardId+columnId]` | **复合索引**：能高效做"按看板过滤 + 按列排序" |
| `*tags` | **多值索引**：数组里每个元素都能被 `where('tags').anyOf([...])` 命中 |
| `priority` | 数字索引，可用于排序 |

**两个硬约束**：

1. **IndexedDB 不能索引 `boolean`** —— 所以 `Card.done` 是 `0 | 1`。这是存储层反向约束了类型设计，必须在注释里写清楚
2. **改索引必须升版本** —— 只改 `stores()` 字符串而不升 `version()` 不会生效

---

## 3. 最小可运行示例：跑真实测试

数据层在浏览器外也能测，用 `fake-indexeddb` 提供 IndexedDB 实现（`tests/setup.ts` 里一行 `import 'fake-indexeddb/auto'`）。

```bash
npm test
```

**预期输出**（实测）：

```
 ✓ tests/operations.test.ts (6 tests) 47ms
      Tests  18 passed (18)（其中数据层 6 项）
```

这 6 个测试覆盖：初始化幂等、`order` 递增、跨列移动后重排且不重复、移动不存在的卡片时数据不变、搜索命中标题/备注/标签、空关键字返回全部。

**验证方式（手动）**：`npm run dev` → 新增卡片 → 刷新页面 → 卡片还在。DevTools → Application → IndexedDB → `lumen-kanban` 能看到三张表。

---

## 4. 关键操作与"为什么"

### 4.1 事务：跨表/跨行写入必须包起来

`moveCard`（`src/renderer/db/operations.ts`）：

```ts
export async function moveCard(cardId: string, toColumnId: string, toIndex: number): Promise<void> {
  await db.transaction('rw', db.cards, async () => {
    const card = await db.cards.get(cardId);
    if (!card) return;

    const target = await db.cards.where('columnId').equals(toColumnId).sortBy('order');
    const rest = target.filter((item) => item.id !== cardId);
    const insertAt = Math.max(0, Math.min(toIndex, rest.length));
    rest.splice(insertAt, 0, { ...card, columnId: toColumnId });

    const timestamp = now();
    await db.cards.bulkPut(rest.map((item, index) => ({ ...item, order: index, updatedAt: timestamp })));
  });
}
```

**为什么整个函数包在事务里**：要重写目标列所有卡片的 `order`。中途失败必须整体回滚，否则会出现两张卡片 `order` 相同、每次刷新顺序随机漂移 —— 这是最难查的一类 bug。

### 4.2 批量 API

```ts
await db.cards.bulkAdd(rows);     // 新增
await db.cards.bulkPut(rows);     // 新增或覆盖（本项目重排用）
await db.cards.bulkDelete(ids);   // 删除
```

**为什么不用循环 `put`**：每条 `put` 都是一个独立事务，5000 条会慢一到两个数量级。`bulkPut` 走单个事务。

### 4.3 响应式查询

```tsx
const cards = useLiveQuery(
  () => db.cards.where('boardId').equals(boardId).toArray(),
  [boardId],   // 依赖变化重新订阅
  [],          // 加载中的默认值（不给的话首帧是 undefined）
);
```

**为什么用它**：它订阅的是**数据库本身**，任何地方（包括另一个窗口、另一个标签页）写入都会自动重跑查询。手写方案需要在每个写入点记得 `setCards(...)`，漏一处就是脏数据。

> 注意：`useLiveQuery` 每次返回新数组，如果把它直接放进 `useEffect` 的依赖数组会导致副作用反复触发。本项目 `BoardView` 的依赖写的是 `columns[0]?.id`（字符串），不是数组。

### 4.4 搜索：三条路线与取舍

| 路线 | 实现 | 适用 | 本项目 |
| --- | --- | --- | --- |
| 索引前缀查询 | `where('title').startsWithIgnoreCase(q)` | 只搜前缀、数据量大 | 否（我们要搜包含） |
| 全量读取 + 内存过滤 | 本项目 `searchCards` | **≤ 数千条**，实现 5 行 | ✅ 当前 |
| 倒排索引 / 全文索引 | 维护 term → id 映射表（可放 Web Worker） | 上万条 + 需要分词 | 数据量上来后再换 |

本项目把谓词抽成纯函数 `lib/search.ts` 的 `matchesKeyword`，让"数据库查询"和"UI 实时过滤"共用同一份规则，避免两处不一致。

---

## 5. 导出 / 导入（快照）

```ts
export async function exportSnapshot(): Promise<Snapshot> { /* 三张表全读 */ }

export async function importSnapshot(snapshot: Snapshot): Promise<void> {
  await db.transaction('rw', db.boards, db.columns, db.cards, async () => {
    await Promise.all([db.boards.clear(), db.columns.clear(), db.cards.clear()]);
    await db.boards.bulkPut(snapshot.boards);
    /* … */
  });
}
```

**为什么是"整库替换"而不是增量合并**：这是单机应用，本地数据本来就是唯一一份，替换语义最简单也最不容易出错。**什么时候该换成增量**：接了服务端、需要合并他人改动时，此时必须引入 `updatedAt` 比较与冲突解决策略（last-write-wins / 字段级合并）。

---

## 6. 本阶段踩坑速查

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| `TransactionInactiveError` | 事务里 `await` 了非 Dexie 的 Promise（如 `fetch`），事务会自动关闭 | 事务内只做 Dexie 操作，外部数据先取好 |
| 字段加了但查不到 | 没建索引却用 `where()` | 加索引 + 升版本；或不建索引改用内存过滤 |
| 改了 `stores()` 但索引没变 | 没升 `version()` | 升版本 |
| 老用户升级后字段是 `undefined` | 只加了字段没写 `upgrade()` | 在 `.upgrade()` 里回填默认值（本项目 v2 就是干这个的） |
| 写入几千条极慢 | 循环 `put` | 改 `bulkPut` |
| `done: true` 存进去查不到 | IndexedDB 不能索引 boolean | 用 0/1 |
| 测试报 `indexedDB is not defined` | 没引 fake-indexeddb | `tests/setup.ts` 加 `import 'fake-indexeddb/auto'` |
| 隐私模式下数据库打不开 | 浏览器禁用存储 | 捕获 `db.open()` 失败并提示用户 |
