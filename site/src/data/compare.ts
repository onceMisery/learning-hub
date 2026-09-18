/**
 * 跨轨对照数据。
 *
 * 这是整个仓库最有差异化的资产：同一个概念在 Java / Rust / TypeScript / Go / Python 里怎么写。
 * 数据源手写在仓库里，与各轨道的教程相互独立——轨道讲「这门语言怎么用」，
 * 这张表只回答「同一件事，换门语言该怎么写」。
 *
 * 约定（新增语言或新增主题时请照此办理）：
 * 1. 列顺序由 COMPARE_LANGUAGES 决定，与轨道顺序保持一致：Java → Rust → TypeScript → Go → Python。
 * 2. 单元格默认写作字符串：一段能直接抄走的代码，或一个精确的短语（不是整句散文）。
 *    长方法链可以用 \n 主动断行（建议断在 .method() 之间），否则整列会被一个
 *    超长不可断的 token 撑宽，把其他语言的列压到没法读。
 * 3. 某门语言确实没有对应概念时，用 absent('原因') 标注，页面渲染为弱化的
 *    「无对应概念 + 原因」。这与空字符串（渲染成「待补充」，表示还没写）是两回事。
 * 4. 一门语言在某行只要有一个单元格，该列就会出现在表里；整列留空会自动隐藏。
 * 5. note 写「容易踩的坑」，不要复述单元格内容。
 */

/** 表格列顺序 */
export const COMPARE_LANGUAGES = ['java', 'rust', 'typescript', 'go', 'python'] as const;

export type LanguageId = (typeof COMPARE_LANGUAGES)[number];

export const LANGUAGE_LABEL: Record<LanguageId, string> = {
  java: 'Java',
  rust: 'Rust',
  typescript: 'TypeScript',
  go: 'Go',
  python: 'Python',
};

/** 「该语言没有对应概念」的提示文案，数据与页面共用同一份，避免措辞漂移 */
export const NO_EQUIVALENT_LABEL = '无对应概念';

export interface AbsentCell {
  /** 为什么这门语言没有对应概念 */
  reason: string;
}

/** 单元格内容：字符串 = 代码或短语；AbsentCell = 该语言无对应概念 */
export type CompareCell = string | AbsentCell;

/**
 * 语义化构造「无对应概念」单元格。
 * 写成 absent('…') 而不是裸对象，是为了让数据表里一眼能看出这是刻意的标注，
 * 而不是写漏了或者手滑。
 */
export function absent(reason: string): AbsentCell {
  return { reason };
}

export interface CompareRow {
  /** 概念或场景 */
  concept: string;
  /** 一句话说明「容易踩的坑」 */
  note?: string;
  cells: Partial<Record<LanguageId, CompareCell>>;
}

export interface CompareTopic {
  id: string;
  title: string;
  description: string;
  rows: CompareRow[];
}

export const COMPARE_TOPICS: CompareTopic[] = [
  {
    id: 'error',
    title: '错误处理',
    description: '异常是被抛出还是被返回？这一条几乎决定了整门语言的 API 风格。',
    rows: [
      {
        concept: '表达失败',
        note: 'Rust / Go 把失败放进返回值，调用点必须显式处理。',
        cells: {
          java: 'throw new BizException("…")',
          rust: 'Result<T, E>，配合 ? 运算符',
          typescript: 'throw new Error("…")（无类型约束）',
          go: 'return nil, fmt.Errorf("加载用户: %w", err)',
          python: 'raise BizError("…")',
        },
      },
      {
        concept: '强制处理',
        note: 'Java 的受检异常常被 catch 后吞掉，反而不如返回值可靠。',
        cells: {
          java: '受检异常必须声明 throws',
          rust: '未使用的 Result 会触发 must_use 警告',
          typescript: '无强制，靠 lint 与约定',
          go: 'err 声明后不用会编译失败，但丢弃返回值合法，靠 errcheck 兜底',
          python: '无强制，异常可以被静默忽略',
        },
      },
      {
        concept: '聚合多种错误',
        note: '判定错误别做字符串比较：Go 用 errors.Is，Python 用 except 子类。',
        cells: {
          java: '自定义异常体系 + 继承',
          rust: 'thiserror 定义 enum，或 anyhow 做应用层',
          typescript: 'class XError extends Error',
          go: 'errors.Is / errors.As 沿 %w 链判定，或 errors.Join 合并',
          python: 'class BizError(Exception) 继承体系；3.11+ 用 ExceptionGroup',
        },
      },
      {
        concept: '快速失败',
        cells: {
          java: 'Objects.requireNonNull / assert',
          rust: 'unwrap() / expect()（生产代码慎用）',
          typescript: 'if (!x) throw new Error()',
          go: 'panic() 只用于不可恢复场景，惯例仍是返回 error',
          python: 'assert x is not None / raise ValueError("…")',
        },
      },
    ],
  },
  {
    id: 'null',
    title: '空值与可选',
    description: '「十亿美元错误」在各语言里的不同解法。',
    rows: [
      {
        concept: '表示可能没有值',
        note: 'Go / Python 的「没有值」是运行时事实，编译器不做检查。',
        cells: {
          java: 'Optional<T>（仅约定，字段仍可为 null）',
          rust: 'Option<T>，语言层面没有 null',
          typescript: 'T | null | undefined',
          go: '指针 *T 的 nil，或 (T, bool) 双返回值约定',
          python: 'Optional[T]（即 T | None），None 是单例对象',
        },
      },
      {
        concept: '取值',
        cells: {
          java: 'optional.orElse(default)',
          rust: 'match / if let / unwrap_or',
          typescript: 'x ?? default',
          go: 'if p != nil { v = *p }，没有默认值运算符',
          python: 'x if x is not None else default（用 x or default 会误吞 0 与空串）',
        },
      },
      {
        concept: '链式处理',
        cells: {
          java: 'optional.map(…).flatMap(…)',
          rust: 'opt.map(…).and_then(…)',
          typescript: 'x?.y?.z',
          go: '逐层判空 if p != nil && p.Next != nil，没有语法糖',
          python: 'getattr(x, "y", None)，没有 ?. 语法',
        },
      },
      {
        concept: '编译器能否保证',
        note: 'Rust 是唯一在编译期消灭空指针的语言。',
        cells: {
          java: '不能，Optional 本身也可能为 null',
          rust: '能，必须穷举 Some / None',
          typescript: '开启 strictNullChecks 后可以',
          go: '不能，nil 解引用只在运行时 panic',
          python: '不能，None 可赋给任何变量；只有 mypy --strict 能拦住',
        },
      },
    ],
  },
  {
    id: 'concurrency',
    title: '并发模型',
    description: '共享内存还是消息传递，决定了并发代码的组织方式。',
    rows: [
      {
        concept: '基本单位',
        cells: {
          java: 'Thread / ExecutorService / 虚拟线程',
          rust: 'std::thread，或 tokio 的 async task',
          typescript: '单线程事件循环 + Worker',
          go: 'go f() 起 goroutine，sync.WaitGroup 等它结束',
          python: 'threading.Thread / asyncio.Task；CPU 密集要换 multiprocessing',
        },
      },
      {
        concept: '共享状态',
        cells: {
          java: 'synchronized / Lock / AtomicInteger',
          rust: 'Arc<Mutex<T>> / Arc<RwLock<T>>',
          typescript: 'SharedArrayBuffer + Atomics（少见）',
          go: 'sync.Mutex / atomic.Int64；官方口径是「用通信代替共享内存」',
          python: 'threading.Lock；受 GIL 限制，纯 Python 代码不会真正并行',
        },
      },
      {
        concept: '消息传递',
        note: 'Go 的 channel 是语言级原语，其余语言都要靠标准库或运行时提供。',
        cells: {
          java: 'BlockingQueue',
          rust: 'std::sync::mpsc / tokio::sync::mpsc',
          typescript: 'postMessage / MessageChannel',
          go: 'channel：ch <- v 发送、<-ch 接收，select 做多路复用',
          python: 'queue.Queue（线程）/ asyncio.Queue（协程）',
        },
      },
      {
        concept: '取消与超时',
        note: 'Go 用 context 逐层透传取消信号，这一点比 Java 的中断标志干净得多。',
        cells: {
          java: 'Future.cancel / Thread.interrupt',
          rust: '取消即 drop future，配合 tokio::select! 抢跑',
          typescript: 'AbortController',
          go: 'context.Context 逐层透传，ctx.Done() 通知取消',
          python: 'asyncio.Task.cancel() 或 future 的超时参数',
        },
      },
      {
        concept: '编译期安全',
        note: 'Rust 的 Send / Sync 会在编译期拦住跨线程误用。',
        cells: {
          java: '靠运行时与规约',
          rust: 'Send / Sync trait 静态约束',
          typescript: '单线程，天然没有数据竞争',
          go: '无编译期约束，靠 go test -race 在运行时检测',
          python: '无编译期约束；GIL 掩盖了部分竞争，但复合操作仍非原子',
        },
      },
    ],
  },
  {
    id: 'collections',
    title: '集合与迭代',
    description: '从 for 循环到链式流水线的思维转变。',
    rows: [
      {
        concept: '动态数组',
        cells: {
          java: 'List<T> / ArrayList',
          rust: 'Vec<T>',
          typescript: 'Array<T>',
          go: '[]T 切片（底层是数组 + 长度 + 容量）',
          python: 'list[T]',
        },
      },
      {
        concept: '键值对',
        note: 'Go / Python 取不存在的键不会报错，必须显式区分「零值」与「没有」。',
        cells: {
          java: 'Map<K, V> / HashMap',
          rust: 'HashMap<K, V>',
          typescript: 'Map<K, V> / Record<string, T>',
          go: 'map[K]V；v, ok := m[k] 区分零值与不存在',
          python: 'dict[K, V]；m.get(k, default) 避免 KeyError',
        },
      },
      {
        concept: '定长与不可变',
        cells: {
          java: 'List.of(…) 不可变；int[] 定长',
          rust: '&[T] 借用切片；[T; N] 定长数组',
          typescript: 'readonly T[]；as const 只读字面量',
          go: '[N]T 定长数组是值语义，[]T 切片是引用语义，别混用',
          python: 'tuple 不可变；list 可变',
        },
      },
      {
        concept: '链式处理',
        note: 'Rust 的迭代器是惰性的，不 collect 就不会执行。',
        cells: {
          java: 'stream().map()\n  .filter()\n  .collect()',
          rust: 'iter().map()\n  .filter()\n  .collect()（惰性）',
          typescript: 'arr.map().filter()（每次生成新数组）',
          go: '没有内建流水线，用 for 循环或 slices / maps 泛型包',
          python: '推导式 [f(x) for x in xs if p(x)]；生成器表达式是惰性的',
        },
      },
      {
        concept: '所有权陷阱',
        note: 'Rust 里迭代默认移动，需要借用时要写 .iter()。',
        cells: {
          java: absent('Java 没有所有权概念，集合里存的是对象引用'),
          rust: 'into_iter 移动 / iter 借用 / iter_mut 可变借用',
          typescript: absent('TypeScript 没有所有权概念，元素按引用共享'),
          go: absent('Go 没有所有权概念，切片赋值会共享底层数组（不是复制）'),
          python: absent('Python 没有所有权概念，赋值只是多一个引用指向同一对象'),
        },
      },
    ],
  },
  {
    id: 'types',
    title: '基础类型',
    description: '数值、布尔与类型系统的基本盘——能依赖多少隐式转换，决定了代码的啰嗦程度。',
    rows: [
      {
        concept: '整数',
        note: '要跨平台可复现就别用宽度随平台变化的类型。',
        cells: {
          java: 'int（32 位）/ long（64 位），宽度固定',
          rust: 'i32 / i64 / usize，位数写进类型名',
          typescript: 'number 是双精度浮点，没有整数类型；超 2^53 用 bigint',
          go: 'int 随平台 32/64 位变化；要固定宽度写 int32 / int64',
          python: 'int 任意精度，不会溢出',
        },
      },
      {
        concept: '浮点',
        note: '金额一律别用二进制浮点：Java 用 BigDecimal、Python 用 Decimal。',
        cells: {
          java: 'double 是默认；float 要写后缀 f',
          rust: 'f64 是默认；f32 需显式标注',
          typescript: 'number（只有一种浮点）',
          go: 'float64 是默认；float32 需显式声明',
          python: 'float 即双精度；要精确十进制用 decimal.Decimal',
        },
      },
      {
        concept: '布尔与真值判断',
        note: '只有 TS / Python 有真假值转换，Java / Rust / Go 必须写显式比较。',
        cells: {
          java: 'boolean，条件必须是布尔表达式',
          rust: 'bool，条件必须是 bool，没有隐式转换',
          typescript: 'boolean；但有 truthy/falsy，if (s) 可以判空串',
          go: 'bool，条件必须是 bool；0 与 "" 都不等于 false',
          python: 'bool；0、""、[]、None 都是 falsy，if xs: 是惯用法',
        },
      },
      {
        concept: '声明与类型推断',
        cells: {
          java: 'String name = "x";（类型必须写在前面）',
          rust: 'let name = String::from("x");（默认靠推断）',
          typescript: 'const name = "x"（靠推断）；显式标注写 const name: string = "x"',
          go: 'name := "x"（短声明，仅函数内）；包级用 var name string',
          python: 'name = "x"（无声明）；注解 name: str 运行时不检查',
        },
      },
      {
        concept: '类型转换',
        note: '只有 Java 允许隐式拓宽（int → long）；Rust / Go 必须逐处显式转换。',
        cells: {
          java: '(int) 3.7 强转；Integer.parseInt("12")',
          rust: '3.7 as i32（截断）；"12".parse::<i32>()?（可失败）',
          typescript: 'Number("12")，编译期完全不管',
          go: 'int(3.7) 截断；strconv.Atoi("12") 返回 (int, error)',
          python: 'int(3.7) 截断；int("12") 本质是构造调用',
        },
      },
      {
        concept: '零值 / 默认值',
        note: 'Go 把「零值可用」当设计目标，Rust 相反：强制你写出初始状态。',
        cells: {
          java: '字段默认 0 / false / null；局部变量必须先赋值',
          rust: '没有隐式零值，必须显式初始化',
          typescript: '默认 undefined；只有 strict 模式才在类型里体现',
          go: '每种类型都有零值（0 / "" / nil / false），var 声明即可用',
          python: '没有隐式零值，用到未赋值变量是 NameError',
        },
      },
    ],
  },
  {
    id: 'strings',
    title: '字符串',
    description: '可变还是不可变、按字节还是按字符计数——文本处理里最容易踩坑的两个分歧点。',
    rows: [
      {
        concept: '类型与可变性',
        cells: {
          java: 'String 不可变；循环拼接用 StringBuilder',
          rust: 'String（拥有、可增长）与 &str（借用、只读）两种',
          typescript: 'string 是原始值，本身不可变',
          go: 'string 不可变；拼接用 strings.Builder',
          python: 'str 不可变；拼接用 "".join(parts)',
        },
      },
      {
        concept: '插值与格式化',
        note: '只有 TS / Python / Rust 有内建插值语法，Go 必须靠 fmt。',
        cells: {
          java: 'String.format("你好 %s", name)',
          rust: 'format!("你好 {name}")',
          typescript: '`你好 ${name}`（模板字符串）',
          go: 'fmt.Sprintf("你好 %s", name)',
          python: 'f"你好 {name}"（f-string）',
        },
      },
      {
        concept: '取值与索引',
        note: 'Rust / Go 的下标取到的是字节不是字符，中文场景必须显式转 chars / []rune。',
        cells: {
          java: 's.charAt(i)；s.substring(a, b)（按 UTF-16 码元）',
          rust: '不能写 s[i]；s.len() 是字节数，字符数要 s.chars().count()',
          typescript: 's[i] / s.slice(a, b)（按 UTF-16 码元）',
          go: 's[i] 取到 byte，len(s) 是字节数；字符用 []rune(s)',
          python: 's[i] / s[a:b]（按 Unicode 码点，最直观）',
        },
      },
      {
        concept: '批量拼接',
        cells: {
          java: 'StringBuilder.append(…)，避免循环里 + 产生垃圾对象',
          rust: 'let mut s = String::new(); s.push_str(…)',
          typescript: 'parts.join("")',
          go: 'strings.Builder（或 strings.Join）',
          python: '"".join(parts)；循环里 += 有 O(n²) 风险',
        },
      },
      {
        concept: '常用查找替换',
        note: 'Go 的字符串操作几乎都在 strings 包，而不是挂在类型上的方法。',
        cells: {
          java: 's.contains / indexOf / replace / split',
          rust: 's.contains / find / replace / split',
          typescript: 's.includes / indexOf / replaceAll / split',
          go: 'strings.Contains / Index / ReplaceAll / Split',
          python: 'sub in s / s.find / s.replace / s.split',
        },
      },
    ],
  },
  {
    id: 'functions',
    title: '函数与闭包',
    description: '参数怎么传、能返回几个值、函数是不是一等公民——决定了接口和回调的写法。',
    rows: [
      {
        concept: '声明与调用',
        cells: {
          java: 'int add(int a, int b) { … }',
          rust: 'fn add(a: i32, b: i32) -> i32 { … }',
          typescript: 'function add(a: number, b: number): number { … }',
          go: 'func add(a, b int) int { … }（同类型参数可合并）',
          python: 'def add(a: int, b: int) -> int:（注解可选）',
        },
      },
      {
        concept: '多返回值',
        note: 'Go 把「可能失败」写进签名，这是它整套错误处理惯例的起点。',
        cells: {
          java: absent('Java 只能返回单个对象，多值要自定义类或数组包装'),
          rust: 'fn f() -> (i32, String) 元组返回，或用 struct',
          typescript: '返回对象字面量 { code, msg }',
          go: 'func f() (int, error) 语言级支持，error 惯例放最后',
          python: 'return a, b（本质是元组解包）',
        },
      },
      {
        concept: '默认参数与可选参数',
        cells: {
          java: absent('Java 没有默认参数，只能靠方法重载'),
          rust: absent('Rust 没有默认参数，用 Option<T> 参数或 Builder 模式替代'),
          typescript: 'function f(b = 1) 或 f(b?: number)',
          go: absent('Go 没有默认参数，惯例是用 options 结构体或可变参数'),
          python: 'def f(b=1)；可变对象（list / dict）不要当默认值',
        },
      },
      {
        concept: '可变参数',
        cells: {
          java: 'void f(String... xs)',
          rust: absent('Rust 没有用户态可变参数，用切片 &[T] 或宏替代'),
          typescript: 'function f(...xs: string[])',
          go: 'func f(xs ...string)，调用时写 f(a, b) 或 f(list...)',
          python: 'def f(*args, **kwargs)',
        },
      },
      {
        concept: '闭包与一等函数',
        note: 'Go / Python 的闭包捕获的是变量本身而不是值，循环里注册回调要显式传参。',
        cells: {
          java: 'x -> x + 1（必须绑定到函数式接口）',
          rust: '|x| x + 1（分 Fn / FnMut / FnOnce 三档约束）',
          typescript: '(x) => x + 1（捕获的是引用）',
          go: 'func(x int) int { return x + 1 }',
          python: 'lambda x: x + 1（只能单表达式，且延迟绑定）',
        },
      },
      {
        concept: '参数传递语义',
        note: 'Go / Python 都是「值传递 + 内部含指针」，别简单理解成引用传递。',
        cells: {
          java: '值传递；对象传的是引用副本，能改内容不能换对象',
          rust: '默认移动所有权，要共享得写 & / &mut',
          typescript: '原始值复制，对象按引用',
          go: '全部值传递；slice / map / channel 内部含指针，表现像引用',
          python: '传对象引用；重新赋值不影响调用方，原地修改会',
        },
      },
    ],
  },
  {
    id: 'oop',
    title: '结构体与面向对象',
    description: '没有继承的时候怎么复用代码——组合、接口与数据类，五种语言给出三种答案。',
    rows: [
      {
        concept: '定义数据载体',
        cells: {
          java: 'class User { private String name; private int age; } + getter',
          rust: 'struct User { name: String, age: u8 }',
          typescript: 'interface User { name: string; age: number }',
          go: 'type User struct { Name string; Age int }',
          python: '@dataclass class User: name: str; age: int',
        },
      },
      {
        concept: '方法定义',
        note: '只有 Go 能给任意本包类型挂方法；Rust 用 impl 块达到同样效果。',
        cells: {
          java: '方法写在类体内，this 隐式存在',
          rust: 'impl User { fn greet(&self) { … } }（数据与实现分离）',
          typescript: 'class User { greet() { … } }',
          go: 'func (u User) Greet() { … }（接收者写在函数名前）',
          python: 'def greet(self):（self 是第一个显式参数）',
        },
      },
      {
        concept: '继承',
        note: 'Rust / Go 都没有继承，官方推荐的替代路径是「接口 + 组合」。',
        cells: {
          java: 'extends 单继承类，implements 多接口',
          rust: absent('Rust 没有继承，复用靠组合与 trait 默认方法'),
          typescript: 'extends 单继承（原型链），implements 多接口',
          go: absent('Go 没有继承，复用靠结构体嵌入（embedding）'),
          python: 'class Admin(User)：支持多继承，按 MRO 解析',
        },
      },
      {
        concept: '接口与多态',
        note: 'Go 的接口是隐式满足的，因此接口可以定义在调用方而不是实现方。',
        cells: {
          java: 'interface + implements，必须显式声明',
          rust: 'trait + impl Trait for T，同样显式',
          typescript: 'interface 结构化匹配（鸭子类型），运行时不做检查',
          go: '方法集匹配即实现，无需 implements 关键字',
          python: '鸭子类型；要静态检查用 typing.Protocol',
        },
      },
      {
        concept: '可见性',
        cells: {
          java: 'public / protected / private / 包级默认',
          rust: 'pub 对外，模块内默认私有，pub(crate) 折中',
          typescript: 'public / private / protected（仅编译期，运行时不存在）',
          go: '首字母大写即导出，小写仅包内可见，没有 private 关键字',
          python: '_name 约定为内部，__name 触发名称改写，全靠约定',
        },
      },
      {
        concept: '相等性判定',
        note: '开箱即用做值比较的只有 Go 的 struct 与 Python 的 dataclass。',
        cells: {
          java: '默认引用相等，需重写 equals 与 hashCode',
          rust: '默认没有 ==，需 #[derive(PartialEq)]',
          typescript: '对象用 === 比引用，值比较得自己写',
          go: 'struct 可直接 == 逐字段比较；含 slice / map 的类型不可比较',
          python: '默认 == 等价于 is；@dataclass 会自动生成按值比较的 __eq__',
        },
      },
    ],
  },
  {
    id: 'tooling',
    title: '工程化与工具链',
    description: '从 Maven 到 Cargo / pnpm / go mod / uv 的命令对照。',
    rows: [
      {
        concept: '依赖声明',
        cells: {
          java: 'pom.xml / build.gradle',
          rust: 'Cargo.toml + Cargo.lock',
          typescript: 'package.json + lockfile',
          go: 'go.mod + go.sum（用 go get 增删，不手改版本）',
          python: 'pyproject.toml + uv.lock（或 requirements.txt）',
        },
      },
      {
        concept: '跑测试',
        cells: {
          java: 'mvn test',
          rust: 'cargo test',
          typescript: 'vitest run / npm test',
          go: 'go test ./...（测试文件与被测代码同目录，_test.go 结尾）',
          python: 'pytest（函数名 test_ 开头，无需继承 TestCase）',
        },
      },
      {
        concept: '静态检查',
        cells: {
          java: 'SpotBugs / Checkstyle',
          rust: 'cargo clippy -- -D warnings',
          typescript: 'oxlint / eslint',
          go: 'go vet ./... 加 staticcheck',
          python: 'ruff check 加 mypy（类型相关）',
        },
      },
      {
        concept: '格式化',
        note: 'Go 的 gofmt 没有配置项——放弃风格争论换来全社区一致，这点最像 Rust 的 cargo fmt。',
        cells: {
          java: 'spotless / google-java-format',
          rust: 'cargo fmt',
          typescript: 'prettier',
          go: 'gofmt / go fmt ./...（无任何配置项）',
          python: 'ruff format 或 black',
        },
      },
      {
        concept: '依赖安全审计',
        cells: {
          java: 'OWASP Dependency-Check',
          rust: 'cargo audit / cargo deny',
          typescript: 'pnpm audit',
          go: 'govulncheck ./...',
          python: 'pip-audit 或 uv pip audit',
        },
      },
    ],
  },
];
