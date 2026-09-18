/**
 * 阶段 2 配套示例：类型系统到底帮你挡住了什么。
 *
 * 运行：
 *   npx tsc examples/type-demo.ts --outDir .tmp-examples --target esnext --module esnext --moduleResolution bundler --strict --noUncheckedIndexedAccess
 *   node .tmp-examples/type-demo.js
 */

// ---- 1. 用可辨识联合表达"成功/失败"，而不是抛异常 -------------------------
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const err = (error: string): Result<never> => ({ ok: false, error });

function parseCount(raw: string): Result<number> {
  const value = Number(raw);
  if (Number.isNaN(value)) return err(`"${raw}" 不是合法数字`);
  return ok(value);
}

function describe(result: Result<number>): string {
  switch (result.ok) {
    case true:
      // 这里 result 被收窄成 { ok: true; data: number }
      return `成功，值是 ${result.data}`;
    case false:
      // 这里 result 被收窄成 { ok: false; error: string }
      return `失败，原因是 ${result.error}`;
    default: {
      // 穷尽性检查：如果将来 Result 多了一个分支而这里没处理，编译直接报错
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

console.log(describe(parseCount('42')));
console.log(describe(parseCount('abc')));

// ---- 2. 结构化类型：看得见结构就能赋值，不看"姓什么" -----------------------
interface Point {
  x: number;
  y: number;
}

class PointClass {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

// Java 里 PointClass 必须 implements Point 才能赋值；TS 只看结构
const asPoint: Point = new PointClass(1, 2);
console.log('结构化类型 ->', JSON.stringify(asPoint));

// ---- 3. noUncheckedIndexedAccess：把"数组越界"提前到编译期 ----------------
const list: string[] = ['first'];
const first: string | undefined = list[0];
const missing: string | undefined = list[5];
console.log('list[0] ->', first?.toUpperCase() ?? '(undefined)');
console.log('list[5] ->', missing?.toUpperCase() ?? '(undefined)');

// 下面这行如果取消注释会编译失败：
// console.log(list[5].toUpperCase());
//                    ~~~~~~~~~~~ 'missing' is possibly 'undefined'
