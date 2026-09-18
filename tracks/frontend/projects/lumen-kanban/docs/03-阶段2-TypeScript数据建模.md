# 03 · 阶段 2：TypeScript 数据建模

## 学完你能做什么

- 为业务建立**能表达非法状态为非法的**类型模型（很多 bug 其实可以在建模阶段消灭）
- 用可辨识联合 + 穷尽性检查，让"新增一种情况忘了处理"变成编译错误
- 用 `Result` 替代异常跨越边界（IPC、解析、IO）
- 理解 TS 与 Java 类型系统的根本差异，不再用 Java 直觉写 TS

**前置**：阶段 0。

---

## 1. 最小可运行示例

配套文件：`examples/type-demo.ts`

```bash
npx tsc examples/type-demo.ts --ignoreConfig --outDir .tmp-examples \
  --target esnext --module esnext --moduleResolution bundler \
  --strict --noUncheckedIndexedAccess
node .tmp-examples/type-demo.js
```

> TS 7 新增的坑：命令行指定了文件时它会拒绝加载 `tsconfig.json`（`error TS5112`），必须加 `--ignoreConfig`。

**预期输出**（实测）：

```
成功，值是 42
失败，原因是 "abc" 不是合法数字
结构化类型 -> {"x":1,"y":2}
list[0] -> FIRST
list[5] -> (undefined)
```

**验证方式**：把示例最后那段注释掉的 `console.log(list[5].toUpperCase())` 打开，重新编译：

```
error TS18048: 'list[5]' is possibly 'undefined'.
```

这就是 `noUncheckedIndexedAccess` 的价值 —— 把一个线上崩溃提前成编译错误。

---

## 2. 用 Result 而不是抛异常

本项目 `src/shared/types.ts`：

```ts
export type Result<T, E = string> = { ok: true; data: T } | { ok: false; error: E };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const err = <E = string>(error: E): Result<never, E> => ({ ok: false, error });
```

**为什么**：

1. **跨进程**：Electron 的 IPC 用结构化克隆传值，`Error` 对象过去后只剩字符串，`instanceof` 全失效
2. **类型可见**：`Promise<Result<Snapshot>>` 明明白白告诉调用方"这个会失败，你必须处理"；`Promise<Snapshot>` 则把失败藏起来了
3. **穷尽检查**：`switch (result.ok)` 的 `default` 分支用 `never` 兜底，将来多一个分支就编译报错

**适用边界**：

| 用 Result | 用异常 |
| --- | --- |
| 可预期的业务失败（文件取消选择、校验不通过、网络失败） | 程序员错误（断言失败、不可能到达的分支） |
| 跨进程 / 跨模块边界 | 同函数内的局部错误 |

主进程里就是这样用的（`src/main/index.ts`）：

```ts
const parsed = snapshotSchema.safeParse(payload);
if (!parsed.success) return err(`数据格式不合法：${parsed.error.issues[0]?.message ?? '未知错误'}`);

if (result.canceled || !result.filePath) return err('已取消导出');
```

注意 `issues[0]?.message` —— 索引访问返回 `T | undefined`，必须处理，这正是阶段 0 那条配置在起作用。

---

## 3. 数据模型：把非法状态变成不可能

本项目 `src/shared/types.ts`：

```ts
export type Priority = 0 | 1 | 2;

export interface Card {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  notes: string;
  tags: string[];
  priority: Priority;
  /** IndexedDB 无法索引 boolean，用 0/1 代替 */
  done: 0 | 1;
  order: number;
  createdAt: number;
  updatedAt: number;
}
```

三个建模决定：

1. **`priority` 用字面量联合而不是 `number`** —— 传 `3` 直接编译报错，运行时不用再校验
2. **`done` 用 `0 | 1` 而不是 `boolean`** —— IndexedDB **不能索引 boolean**，用 0/1 才能走索引查询。这是被存储层反向约束的设计，注释必须写清楚原因，否则半年后有人会"顺手改成 boolean"
3. **所有 id 都是 `string`（UUID）而不是自增数字** —— 本地数据与将来的云端数据要能合并，自增号会撞

**为什么用 `interface` 而不是 `class`**：这些对象要跨进程结构化克隆、要存进 IndexedDB，`class` 实例会在克隆时丢掉原型。数据模型一律用纯对象 + `interface`。

---

## 4. TS 与 Java：三个必须纠正的直觉

| 你的 Java 直觉 | TS 的实际情况 | 后果 |
| --- | --- | --- |
| 类型兼容看"姓什么"（名义类型） | 只看结构（结构化类型） | `class PointClass` 不需要 `implements Point` 就能赋给 `Point`；但两个结构相同的不同类也能互相赋值，可能掩盖语义错误 |
| 泛型运行时还在（其实 Java 也是擦除，但你有 `Class<T>`） | 泛型**完全**擦除，运行期拿不到 `T` | 所有外部输入（`fetch` / `JSON.parse` / IPC / `localStorage`）本质上都是 `unknown`，必须运行时校验 |
| 受检异常强制你处理失败 | 没有受检异常 | 只能靠 `Result` 这类约定把失败写进类型 |

**因此本项目的规矩**：任何从外部进来的数据，先用 zod 校验再进业务代码（`src/shared/ipc.ts` 的 `snapshotSchema`、`src/main/index.ts` 的 `safeParse`）。

---

## 5. 类型收窄的六种手段（按使用频率）

```ts
// 1. typeof
if (typeof value === 'string') value.toUpperCase();

// 2. 字面量判别（最常用）
switch (result.ok) { case true: …; case false: …; }

// 3. in
if ('error' in result) showError(result.error);

// 4. instanceof
if (error instanceof TypeError) …

// 5. 类型谓词
const isCard = (value: unknown): value is Card => typeof (value as Card).title === 'string';

// 6. 可辨识联合（本项目 Priority / Result 都用它）
```

---

## 6. 本阶段踩坑速查

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| `'xxx' is possibly 'undefined'` | `noUncheckedIndexedAccess` 生效 | 用 `?.` / `??` 或先判空；不要直接 `as` 断言绕过 |
| `Object is possibly 'null'` | `strictNullChecks` | 同上 |
| `TS5112: tsconfig.json is present but will not be loaded` | TS 7 新行为：命令行指定文件时不加载配置 | 加 `--ignoreConfig` |
| `TS18046: 'x' is of type 'unknown'` | 外部数据未经校验 | zod `safeParse` 后再用 |
| 类型的 `import` 被打包进产物 | 没开 `verbatimModuleSyntax` 或未用 `import type` | 开启配置；类型导入写 `import type` |
| 想给已有类型加字段 | — | `interface` 可声明合并，`type` 不行；需要交叉用 `&` |
