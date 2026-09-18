# 阶段 9：Dexie 4 本地数据持久化

| 项目 | 内容 |
| --- | --- |
| **周期** | 1.5 周（约 15 小时） |
| **前置** | 完成阶段 8（Motion 13 动效层，看板交互已流畅）、阶段 7（React 19 + Zustand 5 状态分层）、阶段 2（已埋下 schema 版本号伏笔） |
| **本阶段技术栈** | Dexie 4（2026-09 验证）· dexie-react-hooks（`useLiveQuery`）· IndexedDB · TypeScript 7 |
| **产出物** | 把看板应用的数据层从 `localStorage` 迁到 IndexedDB：支持大数据量、复杂查询、schema 迁移、响应式订阅、导入导出 |

---

## 一、本阶段在学习路径中的位置

- **上承**：阶段 8 你给看板加好了动效层（见 [阶段 8：Motion 13 交互动效](./08-Motion13交互动效.md)），交互已经流畅。但数据还躺在 `localStorage` 里——它只有 ~5MB、同步阻塞、只能存字符串，看板卡片一多就撑爆。还记得阶段 2 的练习里你给 `localStorage` 数据**带上了 schema 版本号**吗？那正是为今天迁移 IndexedDB 埋的伏笔：现在要把"版本号"升级成真正的 schema 迁移链。
- **本阶段**：把数据层从 `localStorage` 迁到 **IndexedDB**，用 **Dexie 4** 这个 Promise 封装来管理。你会学到它的心智模型（为什么是异步的）、schema 与版本迁移、增删改查与批量、索引与查询、事务原子性，以及用 `useLiveQuery` 让 React 组件**响应式**订阅数据库变化（呼应阶段 2 的响应式练习与阶段 7 的 `useSyncExternalStore`）。
- **下接**：阶段 10 用 [阶段 10：Electron 43 桌面应用](./10-Electron43桌面应用.md) 把这个本地数据层直接搬进桌面应用——Electron 里 Dexie 就是现成的"嵌入式数据库"，离线优先能力无缝复用。

> 持久化是"根基"。动效再好看，数据一刷新就丢、一多就卡，应用依然不可用。本阶段把根基打牢。

---

## 二、学习目标（可验收）

1. 理解 **IndexedDB** 的定位与限制（异步、事务型、容量大、浏览器 quota、隐私模式下可能不可用），知道它比 `localStorage` 强在哪。
2. 能用 **Dexie 4** 定义 schema（含复合索引、多值索引）、做版本迁移（`version().stores().upgrade()`）。
3. 熟练使用 CRUD 与批量操作（`bulkGet` / `bulkPut` / `bulkDelete`）、事务（`transaction('rw', ...)`）、`where` 查询链、`orderBy`、分页。
4. 用 `useLiveQuery` 让 React 组件响应式订阅数据库变化（数据变了 UI 自动更新，无需手动失效）。
5. 设计**离线优先（offline-first）**的数据层：本地为真源 → 后台同步 → 冲突处理策略。
6. 处理边界：配额超限、数据库被用户清空、多标签页写入冲突、大数据量导入的性能。
7. 能把 Dexie 作为 Electron 桌面应用的本地存储（阶段 10 直接复用）。

---

## 三、核心概念详解

### 3.1 IndexedDB 的心智模型：为什么它是异步的

**是什么**：IndexedDB 是浏览器内置的**事务型 NoSQL 数据库**。心智模型是：**数据库（Database） → 对象仓库（Object Store，类比表）→ 索引（Index）→ 事务（Transaction）**。它能存结构化数据（`Object` / `Array` / `File` / `Blob` / `Date` / `Map` / `Set`），容量按磁盘余量可达数百 MB~GB 级。

**为什么需要**：`localStorage` 是同步的——主线程读 5MB 字符串会卡 UI；且只能存字符串，结构化对象要自己 `JSON.parse/stringify`。IndexedDB 是**异步**的：所有读写走事务，不阻塞渲染。理解"为什么异步"是关键——IndexedDB 可能落在磁盘甚至 OPFS，I/O 延迟不可预测，同步 API 会把页面冻死。

```ts
// 原生 IndexedDB 的"打开 + 建仓库"骨架（仅为理解底层，日常用 Dexie 不用写这个）
const request = indexedDB.open('kanban', 1);
request.onupgradeneeded = (event) => {
  const db = (event.target as IDBOpenDBRequest).result;
  const cards = db.createObjectStore('cards', { keyPath: 'id' });
  cards.createIndex('byBoard', 'boardId', { unique: false });
};
request.onsuccess = () => console.log('打开成功');   // 回调式，冗长且易错
```

**坑在哪**：原生 API 是**事件式 + 回调式**（success/error/upgradeneeded 三套回调），一个事务出错要层层 `try/catch`。这就是 Dexie 存在的理由——它把这一切包成 Promise + 链式查询 DSL。练习 1 会让你先写一次原生 demo 体会这种繁琐。

### 3.2 为什么不用 localStorage：兑现阶段 2 的伏笔

**是什么**：`localStorage` 是同源下的键值存储，同步、仅字符串、约 5MB。它和 IndexedDB 是两套定位完全不同的方案。

**为什么需要**：阶段 2 你用 `localStorage.setItem('todos.v1', JSON.stringify({ version: 1, todos }))` 做了持久化——那个 `version: 1` 就是埋下的伏笔。当时你只能**手动**判断 version 做迁移，一旦字段变多、要按 board 查询、要存上万张卡片，`localStorage` 就彻底不够用了：同步阻塞、无索引、无事务、容量小。

```ts
// 阶段 2 的老写法：手动序列化 + 手动版本号
const raw = localStorage.getItem('kanban.v1');
const data = raw ? JSON.parse(raw) : { version: 1, cards: [] };
// 想"查某个 board 的卡片"？只能全量取出来 filter，数据一大就卡
const ofBoard = data.cards.filter((c) => c.boardId === id);
```

| 方案 | 容量 | 类型 | 查询 | 适用 |
| --- | --- | --- | --- | --- |
| `localStorage` | ~5MB | 同步、仅字符串 | 无（只能全量读） | 少量配置/令牌/草稿 |
| `sessionStorage` | ~5MB | 同步、会话级 | 无 | 临时状态 |
| **IndexedDB / Dexie** | 数百 MB~GB 级 | 异步、结构化 | 索引/范围/排序 | **应用主数据** |
| OPFS | 大 | 文件 | — | 大文件/流式 |

> 结论：`localStorage` 留给"少量、无关紧要、可丢失"的数据（如主题偏好）；**应用主数据交给 Dexie / IndexedDB**。

**坑在哪**：隐私模式（Safari 无痕）下 `localStorage` 可能抛 `QuotaExceededError` 或直接被禁用；IndexedDB 在隐私模式也可能受限但行为更可控。迁移时务必保留"读不到旧数据就降级到空"的兜底。

### 3.3 Dexie 的 schema 定义：对象仓库与索引语法

**是什么**：Dexie 用 `version(n).stores({...})` 声明对象仓库（表）和索引。第一个字段是**主键**，其余是索引。类型上用 `Table<T, Key>` 描述表。

**为什么需要**：把阶段 2 的"手写 JSON + 手动版本号"升级成"声明式 schema + 自动迁移"。Dexie 的 schema 字符串同时描述了主键、单字段索引、复合索引 `[a+b]`、多值索引 `*field`——一条字符串胜过几十行建表 SQL / JPA 注解。

```ts
import Dexie, { type Table } from 'dexie';

export interface Board {
  id: string;
  name: string;
  createdAt: number;
}

export interface Card {
  id: string;
  boardId: string;
  title: string;
  tags: string[];        // 多值索引：一个卡片多个标签可分别查
  priority: 0 | 1 | 2;
  done: 0 | 1;           // IndexedDB 不能索引 boolean，用 0/1
  createdAt: number;
  updatedAt: number;
}

export class KanbanDB extends Dexie {
  boards!: Table<Board, string>;
  cards!: Table<Card, string>;

  constructor() {
    super('kanban');
    this.version(1).stores({
      boards: 'id, name, createdAt',
      cards:  'id, boardId, done, updatedAt, [boardId+done], *tags, createdAt',
    });
  }
}

export const db = new KanbanDB();
```

索引语法要点：
- 第一个字段是**主键**（`id`），必须唯一且存在于对象上。
- `*` 前缀 = 多值索引（数组的每个元素各建一条索引，查 `tags` 用 `anyOf`）。
- `[a+b]` = 复合索引（前缀范围查询 + 排序，如按 `boardId` 找某 `done` 状态）。
- 普通 `field` = 单字段索引。
- IndexedDB **不能索引 `boolean`**，用 `0/1` 代替；`undefined` 字段不进索引。

**坑在哪**：`stores` 字符串里**漏写某个查询要用到的字段**，查询就会退化成全表扫描（`toArray` 后 filter）。建 schema 时先列清楚"我会按什么查"，再决定索引。改 schema 必须升版本号（见 3.4），直接改旧版本的 `stores` 不生效。

### 3.4 版本迁移链：version().stores().upgrade()

**是什么**：Dexie 的 schema 演进是**版本链**：每次结构变化 `version(n+1).stores(...)` 声明新结构，并用 `.upgrade(tx)` 回调填充旧数据。它等价于后端的 Flyway / Liquibase 迁移。

**为什么需要**：用户可能从 v1 直接升级到 v3（跳过 v2），Dexie 会自动按链逐个跑 `upgrade`。你在 `upgrade` 里做"字段回填 / 数据清洗"，保证任意起点升级后结构一致。这把阶段 2 手写的"读出来判断 version 再改"彻底自动化了。

```ts
import Dexie, { type Table } from 'dexie';

class KanbanDB extends Dexie {
  cards!: Table<Card, string>;

  constructor() {
    super('kanban');
    this.version(1).stores({
      cards: 'id, boardId, done, updatedAt, createdAt',
    });
    // 从 v1 升到 v2：新增 priority 字段 + 复合索引 [boardId+done]
    this.version(2).stores({
      cards: 'id, boardId, done, updatedAt, [boardId+done], createdAt, priority',
    }).upgrade(async (tx) => {
      // 旧卡片没有 priority，批量回填默认值 1
      await tx.table('cards').toCollection().modify((c) => { c.priority ??= 1; });
    });
    // 从 v2 升到 v3：新增 archived 状态 + 复合索引 [boardId+archived]
    this.version(3).stores({
      cards: 'id, boardId, done, updatedAt, [boardId+done], [boardId+archived], createdAt, priority, archived',
    }).upgrade(async (tx) => {
      await tx.table('cards').toCollection().modify((c) => { c.archived ??= 0; });
    });
  }
}
```

**坑在哪**：
- **必须写 `upgrade()`** 回填新字段，否则老用户升级后读到 `undefined` 字段、查询该索引拿到空结果。
- `upgrade` 回调里只能操作**当前迁移涉及的事务**，且必须 `await`，否则迁移不完整。
- 不能"降版本"——用户数据若已是 v3，代码回退到 v2 会触发 `DatabaseClosedError` / 打开失败。降级方案见 3.11。
- 测试迁移：用 `fake-indexeddb` 从 v1 数据启动，断言 v3 字段正确（练习 3）。

### 3.5 增删改查与批量：bulkGet / bulkPut

**是什么**：Dexie 的 CRUD 走表方法：`get` / `put`（新增或覆盖）/ `add`（仅新增）/ `update`（局部改）/ `delete`。批量用 `bulkGet` / `bulkPut` / `bulkAdd` / `bulkDelete`。

**为什么需要**：循环 `await db.cards.put(c)` 一万次，每次开一个事务，慢几十倍。`bulkPut` 在一个事务里批量写，比循环 `put` 快一个数量级——导入大批量数据（练习 2 的 5000 条）必须用 bulk。

```ts
// 单条
await db.cards.put({ id, boardId, title, done: 0, updatedAt: Date.now() });
const one = await db.cards.get(id);

// 批量：一次事务写完，速度碾压循环 put
await db.cards.bulkPut(cards);          // cards 是数组，已含 id
const many = await db.cards.bulkGet([id1, id2, id3]);   // 按主键批量取，缺失项为 undefined
await db.cards.bulkDelete([id1, id2]);  // 批量删

// 局部更新：只改 done，不动其他字段（比 put 整条更安全）
await db.cards.update(id, { done: 1, updatedAt: Date.now() });
```

**坑在哪**：
- 循环 `put` 大批量数据 → 慢几十倍，**必须用 `bulkPut`**。
- `put` 是"有则覆盖"，`add` 是"有则报错"——覆盖旧数据前想清楚。
- `bulkGet` 返回的数组**长度等于 key 数**，查不到的项是 `undefined`，遍历前先 `filter(Boolean)`。
- `update(id, patch)` 不会触达嵌套属性（如 `tags[0]`），要改嵌套得 `get` 后 `put`。

### 3.6 索引与复合索引：怎么查才快

**是什么**：索引让查询不必全表扫描。单字段索引按一个值查；**复合索引** `[boardId+done]` 支持"前缀范围 + 排序"；**多值索引** `*tags` 让数组元素各自可查。

**为什么需要**：看板的核心查询是"某 board 下、未完成的卡片，按更新时间排序"。没有复合索引就要全表 `filter`；有了 `[boardId+done]` 就能走索引 + 范围，毫秒级。

```ts
// 复合索引范围查询：board 下未完成的卡片
await db.cards.where('[boardId+done]').equals([boardId, 0]).toArray();

// 复合索引前缀范围：某个 board 的全部卡片（只用到 boardId 前缀）
await db.cards.where('[boardId+done]').between([boardId, ''], [boardId, '\uffff']).toArray();

// 多值索引：带 bug 或 urgent 标签的卡片
await db.cards.where('tags').anyOf(['bug', 'urgent']).toArray();

// 单字段索引精确查
await db.cards.where('boardId').equals(id).toArray();
```

**坑在哪**：
- 复合索引查询的 key **顺序必须和 schema 一致**（`[boardId+done]` 不能只按 `done` 查，索引不支持后缀）。
- 多值索引 `anyOf` 是"或"语义；要"且"得多次查后交集。
- 查不到数据时 `where(...).equals(x)` 返回空数组而非 `undefined`，别用 `if (!res)` 判断，用 `res.length === 0`。

### 3.7 where 查询链、排序与分页

**是什么**：Dexie 的查询是链式 DSL：`where().equals()/above()/below()/between()/startsWith()/anyOf()/inAnyRange()`，配合 `orderBy` 排序、`offset().limit()` 分页，终结于 `toArray()` / `count()` / `first()` / `each()`。

**为什么需要**：阶段 7 你用 Zustand 存的全量数组在内存里 `filter/sort`；一旦数据上千、要分页、要按索引查，就该把"查询"下推到数据库。Dexie 的链式和 JPA 的 `Criteria` / JPQL 非常像，Java 程序员会很有亲切感。

```ts
// 排序 + 分页：第 page 页，每页 50 条，按 updatedAt 倒序
const pageRows = await db.cards
  .orderBy('updatedAt')          // 要求 updatedAt 是索引，否则退化为内存排序
  .reverse()
  .offset(page * 50)
  .limit(50)
  .toArray();

// 某个 board 内按 order 排序（配合 layout 拖拽排序后的顺序持久化）
const ordered = await db.cards.where('boardId').equals(id).sortBy('order');

// 计数（索引计数很快，不走全表）
const total = await db.cards.where('boardId').equals(id).count();

// 模糊前缀：标题以 "fix" 开头的卡片
await db.cards.where('title').startsWith('fix').toArray();
```

**坑在哪**：
- `orderBy('field')` 的 field **必须是索引**，否则 Dexie 在内存里排序且可能告警；大数据集下性能差。
- `offset/limit` 分页要做"越界保护"（`offset >= total` 时返回空，不是报错）。
- `sortBy` 是一次性取回再排序，大结果集先 `where` 缩小范围再加 `limit`。

### 3.8 事务与原子性：transaction('rw', ...)

**是什么**：`db.transaction('rw', db.cards, db.boards, async () => {...})` 开启一个事务；`'r'` 只读、`'rw'` 读写。事务内所有操作要么全成功、要么全回滚。

**为什么需要**：删除一个看板时，要连带删除它下面所有卡片、更新统计——这三步必须原子。否则中途失败会留下"孤儿卡片"（指向已删 board）或"统计错乱"。这与 JDBC / JPA 的 `@Transactional` 是同一回事。

```ts
// 删除看板：连带删卡片 + 更新父统计，原子执行
await db.transaction('rw', db.boards, db.cards, async () => {
  const cards = await db.cards.where('boardId').equals(boardId).toArray();
  await db.cards.bulkDelete(cards.map((c) => c.id));
  await db.boards.delete(boardId);
  // 中途抛错 → 整个事务回滚，上面删的卡片也会恢复
});

// 只读事务：并发读不阻塞写
await db.transaction('r', db.cards, async () => {
  const n = await db.cards.count();
  return n;
});
```

**坑在哪**（这是 Dexie 最容易踩的雷）：
- **事务里 `await` 了非 Dexie 的 Promise**（如 `fetch`、定时器、别的库），事务会**自动关闭**，后续 Dexie 操作报 `TransactionInactiveError`。规则：事务内只做 Dexie 操作，网络请求放事务外。
- 跨表写入**必须显式列在事务表清单里**（`db.transaction('rw', db.cards, db.boards, ...)`），漏写会报 `ReadOnlyError`。
- 只读操作误用 `'rw'` 会拿不必要的写锁，影响并发。

### 3.9 useLiveQuery：响应式订阅（呼应阶段 2 与阶段 7）

**是什么**：`useLiveQuery`（来自 `dexie-react-hooks`）让 React 组件**响应式**订阅一个 Dexie 查询结果——数据库一变，组件自动重渲染并拿到新数据，无需手动 `setState` / 失效。

**为什么需要**：阶段 2 你手写了"改完数据再 `render(state)`"；阶段 7 用 `useSyncExternalStore`（Zustand 的底层）实现外部状态订阅。Dexie 把同一思想接到数据库上：`useLiveQuery` 内部就是基于 `useSyncExternalStore` 的"外部存储订阅"，只不过数据源是 IndexedDB 的变更事件。这样你删掉所有"改完手动刷新"的逻辑。

```tsx
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';

function CardList({ boardId }: { boardId: string }) {
  // 查询结果随数据库变化自动刷新；[boardId] 变化时重新订阅
  const cards = useLiveQuery(
    () => db.cards.where('boardId').equals(boardId).sortBy('order'),
    [boardId],           // 依赖：boardId 变就重新查询
    [],                  // 初始/加载中的默认值（避免首帧 undefined）
  );

  if (!cards) return <Spinner />;     // 加载中
  return <ul>{cards.map((c) => <li key={c.id}>{c.title}</li>)}</ul>;
}
```

**坑在哪**：
- 查询函数**每次返回新数组引用**是正常的，`useLiveQuery` 靠"内容是否变化"判断，但依赖数组 `[boardId]` 要写全——漏写会导致订阅不更新或无限重跑。
- `useLiveQuery` 返回可能是 `undefined`（加载中），渲染前先判空。
- 大结果集要加 `limit` / 分页，或只查 `id` 列表再按需 `get` 详情，否则每次变更都序列化一大坨。
- **与 Zustand 的分工**：Dexie 是持久化真源，Zustand 只放 UI 状态（当前选中、筛选、主题）。别把 Dexie 数据再抄一份进 store——双份真相、内存翻倍、还容易不一致。

### 3.10 离线优先与同步冲突

**是什么**：离线优先（offline-first）是"本地数据库为真源，UI 永远读本地；写操作先进本地再异步同步到服务端"的架构。同步用 **outbox（发件箱）** 模式：待同步的写操作进 `outbox` 表，后台同步器消费它。

**为什么需要**：看板类应用用户期望"断网也能用、联网自动同步"。本地为真源保证零延迟；outbox 保证"写操作不丢失"。冲突几乎必然发生（多端改了同一条），需要明确策略。

```ts
// outbox 表：记录待同步的写操作
db.version(4).stores({
  outbox: '++id, entity, op, synced, createdAt',
});

// 写操作：先落本地（即时可见），再入 outbox
async function createCard(card: Card) {
  await db.cards.put(card);                       // 本地即时生效
  await db.outbox.add({                           // 待后台同步
    entity: 'card', op: 'create', payload: card, synced: 0, createdAt: Date.now(),
  });
}
```

冲突策略（按业务选，没有银弹）：
- **last-write-wins**：比较 `updatedAt`，新的覆盖旧的（练习 4 用这个）。
- **字段级合并**：只对冲突字段取并集（适合协作编辑）。
- **手动解决**：标记冲突项，让用户选（适合不可逆操作）。

软删除（`deletedAt` + 墓碑）避免同步时"复活"已删数据：删除只写 `deletedAt`，真正清理由后台 GC。

**坑在哪**：
- outbox 同步失败要**可重试**且**幂等**（同一操作重复提交不产生副作用）。
- 多标签页同时写 → 需 `BroadcastChannel` / Dexie 的 `storageMutated` 事件协同（见 3.11）。
- 同步状态要在 UI 展示（待同步 / 同步中 / 已同步 / 失败可重试），否则用户不知道"还没存上去"。

### 3.11 错误处理与常见报错

**是什么**：Dexie 抛出的典型错误有 `DatabaseClosedError`（库被关或版本不兼容）、`SchemaDiffError` / `UpgradeError`（schema 与代码不一致）、`QuotaExceededError`（配额满）、`TransactionInactiveError`（事务内 awaited 外部 Promise）。

**为什么需要**：浏览器环境比服务端恶劣得多——用户清空站点数据、隐私模式限制、磁盘满、多标签页抢库。这些不是"异常分支"，是"必然发生"，必须兜底。

```ts
import { db } from './db';

// 配额超限：捕获并提示，必要时引导清理
try {
  await db.cards.bulkPut(hugeCards);
} catch (err) {
  if (err instanceof DOMException && err.name === 'QuotaExceededError') {
    const { usage, quota } = await navigator.storage.estimate();
    alert(`本地空间不足：${usage} / ${quota} 字节，请清理旧数据`);
  } else {
    throw err;
  }
}

// 数据库版本不兼容（用户数据比代码新）：监听并降级
db.on('versionchange', () => db.close());   // 收到新版本通知先关闭，等新代码接管
```

**坑在哪**：
- `DatabaseClosedError`：常见于"代码回退到旧版本"或"用户数据已是新版但代码是旧版"。降级方案：捕获后引导用户重新加载到正确版本；不要试图强行 `open` 更高版本的数据。
- `SchemaDiffError`：代码 `stores` 与已存数据库结构不符——通常是你改了 `version(1).stores` 却没升版本号。改结构必须新建 `version(n+1)`。
- 隐私模式下 IndexedDB 可能直接打开失败——启动时要 `try/catch db.open()` 并降级到内存态提示用户。

### 3.12 数据导入导出与备份

**是什么**：导入导出是把本地数据库序列化为可传输格式（JSON / 文件），用于备份、迁移、跨设备。Dexie 官方 `dexie-export-import` 提供 `exportDB()` / `importInto()`。

**为什么需要**：用户换设备、清缓存前想备份；或要把演示数据批量灌入。自己写也能做，但官方工具处理了 blob、事务、进度回调等细节。

```ts
import { exportDB, importInto } from 'dexie-export-import';
import { db } from './db';

// 导出为 Blob（可触发下载）
const blob = await exportDB(db);
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url; a.download = 'kanban-backup.json'; a.click();

// 导入（含冲突策略：'overwrite' 覆盖 / 'merge' 合并）
async function restore(file: File) {
  await importInto(db, file, { acceptVersionDiff: true, overwriteValues: true });
}
```

**坑在哪**：
- 导入前先确认用户数据会被覆盖还是合并，避免误删。
- 大库导出可能卡 UI，官方 API 支持进度回调，配合 `useAnimationFrame` 显示进度条。
- 敏感数据（令牌、隐私）**不要明文落盘**——IndexedDB 等同明文文件，导出文件记得加密或提示用户。

---

## 四、与 Java 经验的对照

| Java 经验 | 前端对应（Dexie 4） | 注意差异 |
| --- | --- | --- |
| JDBC / JPA 事务 `@Transactional` | `db.transaction('rw', ...)` | 事务内**不能 await 外部 Promise**（fetch 等），否则事务自动关闭 |
| Hibernate schema migration（Flyway / Liquibase） | `version(n).stores().upgrade()` | 版本链自动按起点逐个跑 upgrade；不能降版本 |
| JPA `@Entity` + `@Table` | `Table<T, Key>` + `version().stores()` | schema 用字符串声明，含索引语法 |
| `@Index` / 联合索引 | `stores` 里的 `[a+b]`、`*tags` | 复合索引不支持后缀查询；boolean 用 0/1 |
| JPQL / Criteria 查询 | `where().equals().and()` 查询链 | 链式 DSL，终结于 `toArray()` / `count()` |
| JDBC batch 批量插入 | `bulkPut` / `bulkAdd` / `bulkGet` | 比循环 put 快一个数量级，大批量必用 |
| 主从同步 / CDC | outbox 队列 + 增量同步 | 离线优先：本地为真源，后台消费 outbox |
| 数据库配额 / 磁盘满 | `QuotaExceededError` + `navigator.storage.estimate()` | 浏览器 quota 不可控，必须兜底提示 |
| 内存 H2 做单测 | `fake-indexeddb` 内存实现 | 单测可直接跑，无需真实浏览器 |

---

## 五、实践练习

### 练习 1（必做）：IndexedDB 原生体验（2 小时）

**目标**：不用 Dexie，用原生 IndexedDB API 写一个"存一条、按索引查一条"的最小 demo。

**步骤**：
1. `indexedDB.open` 建库 + `onupgradeneeded` 建对象仓库与索引。
2. `add` 一条、`get` 一条、用 `index('byBoard').getAll(boardId)` 查。
3. 体会回调嵌套与 `onsuccess/onerror` 的繁琐。

**验收点**：能跑通"存 + 按索引查"，并口头说清 Dexie 封装了哪些样板代码。

### 练习 2（必做）：数据层迁移（6 小时）

**目标**：把看板从 `localStorage` 迁到 Dexie。

**步骤**：
1. 定义 `boards` / `cards` / `labels` 三张表，含复合索引与多值索引。
2. 首次启动时把旧 `localStorage` 数据**一次性迁移**进来（写迁移脚本 + 版本号）。
3. 用 `useLiveQuery` 替换手写的"改完再 setState"，删掉所有手动刷新逻辑。
4. 批量操作：一次导入 5000 条卡片，用 `bulkPut` 分批，测量耗时。
5. 事务：删除看板时连带删除其下所有卡片，验证中途失败可整体回滚。

**验收点**：全量迁移动成功；5000 条 `bulkPut` 耗时 < 3s；删除看板事务回滚正确。

### 练习 3（必做）：Schema 演进（3 小时）

**目标**：真实演练版本迁移链。

**步骤**：
1. 给 `cards` 增加 `priority` 字段（v1 → v2），写 `upgrade()` 回填默认值。
2. 增加 `archived` 状态与复合索引 `[boardId+archived]`（v2 → v3）。
3. 写测试：用 `fake-indexeddb` 从 v1 数据结构启动，断言迁移后字段正确、索引可用。
4. 模拟"用户回滚到 v1 数据"的场景并给出降级方案（见 3.11）。

**验收点**：从 v1 启动能正确升到 v3；字段与索引断言全部通过。

### 练习 4（进阶）：离线优先 + 同步（4 小时）

**目标**：实现离线优先架构。

**步骤**：用 MSW 模拟后端：
1. 所有写操作先进 Dexie（本地即时可见），并写入 `outbox` 表。
2. 后台每 10 秒尝试同步 outbox；断网时暂停，恢复网络自动继续。
3. 冲突：服务端 `updatedAt` 比本地新则覆盖本地（last-write-wins），并在 UI 标记冲突项。
4. 展示同步状态图标（待同步 / 同步中 / 已同步 / 失败可重试）。

**验收点**：断网写卡片不丢；恢复网络后自动同步；冲突项有 UI 标记。

### 练习 5（进阶）：导入导出与容量（2 小时）

**目标**：掌握备份与边界处理。

**步骤**：
1. 实现全量导出 JSON / 导入（含冲突策略：覆盖 or 合并）。
2. 用 `navigator.storage.estimate()` 展示已用容量。
3. 制造 `QuotaExceededError`（写入超大 blob）并给出友好提示。

**验收点**：导出文件能成功还原；配额超限有友好提示而非白屏。

### 练习 6（挑战）：全文搜索（3 小时）

**目标**：本地搜索不依赖服务端。

**步骤**：为 `title` 建立倒排（或集成 mini-search / FlexSearch），支持中文分词（至少支持前缀与子串匹配），搜索 1 万条数据响应 < 100ms。

**验收点**：1 万条本地搜索 < 100ms；中文子串匹配正确。

---

## 六、常见坑与自查清单

### 高频坑

- 索引 `boolean` 字段 → IndexedDB 不支持，用 `0/1`。
- 事务里 `await` 了 fetch 等非 Dexie Promise → 事务自动关闭，报 `TransactionInactiveError`。
- `useLiveQuery` 的查询函数依赖数组写不全 → 订阅不更新或无限重跑。
- 忘记写 `upgrade()` → 老用户升级后字段缺失、索引查空。
- 循环 `put` 写入大量数据 → 慢几十倍，必须用 `bulkPut`。
- 把 Dexie 数据又抄一份进 Zustand → 双份真相、内存翻倍、易不一致。
- 多标签页同时写 → 需 `BroadcastChannel` / `storageMutated` 协调。
- 敏感信息明文存储 → 桌面/浏览器里等于明文文件。
- 改了 `version(1).stores` 却没升版本号 → `SchemaDiffError`。
- 直接改 schema 旧版本 → 必须新建 `version(n+1)`，旧版本只读不改。

### 自查清单

- [ ] 能独立定义含复合索引 `[a+b]`、多值索引 `*tags` 的 schema。
- [ ] 写过至少一次带 `upgrade()` 的版本迁移，并有 `fake-indexeddb` 测试覆盖。
- [ ] 组件通过 `useLiveQuery` 订阅数据，无手动刷新逻辑（呼应阶段 2 响应式与阶段 7 `useSyncExternalStore`）。
- [ ] 会用事务保证跨表写入的原子性（删除看板连带删卡片可回滚）。
- [ ] 5000 条批量导入耗时在可接受范围（< 3s），且用了 `bulkPut`。
- [ ] 实现了离线优先的 outbox 同步与冲突处理（last-write-wins 等）。
- [ ] 处理了配额超限（`QuotaExceededError` + `navigator.storage.estimate`）与数据库被清空的降级路径。
- [ ] 数据导入导出可用，敏感数据未明文落盘。

---

## 七、参考资料

- Dexie 官方文档（Schema / Versioning / WhereClause / Transaction / liveQuery）：[dexie.org](https://dexie.org)（2026-09 验证，Dexie 4 系列）
- `dexie-react-hooks`（`useLiveQuery`）文档
- MDN：[IndexedDB API](https://developer.mozilla.org/docs/Web/API/IndexedDB_API)、[Storage Quota 与 Eviction](https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction)
- `dexie-export-import`（导入导出）、`fake-indexeddb`（单测内存实现）
- 对照参考：JPA / Hibernate 的 schema migration 思路（Flyway / Liquibase），理解版本链迁移的来由
