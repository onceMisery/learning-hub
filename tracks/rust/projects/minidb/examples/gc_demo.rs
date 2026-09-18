//! # 示例：垃圾增长与合并压缩（Compaction）
//!
//! 这个例子回答三个问题：
//!   1. append-only 引擎的"垃圾"到底是怎么长出来的？
//!   2. 删除一条记录后，磁盘上是变大了还是变小了？
//!   3. 合并（compaction）之后，被删掉的键会不会"复活"？
//!
//! 运行：
//! ```bash
//! cargo run --example gc_demo
//! ```
//!
//! 只用到标准库 + minidb 自身的段引擎（`SegmentEngine`），没有额外的第三方依赖。

use minidb::stage4_traits::KvStore;
use minidb::stage6_compact::SegmentEngine;
use std::fs;
use std::path::{Path, PathBuf};

/// 数据目录里所有 `.log` 段文件的总字节数。
///
/// 注意：**不统计** `manifest.json` 和 `LOCK`，也**不统计** `.compacting` 临时文件——
/// 这正是"合并中途崩溃会留下什么"这个问题要观察的点。
fn seg_bytes(dir: &Path) -> u64 {
    fs::read_dir(dir)
        .expect("读目录失败")
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "log"))
        .map(|p| fs::metadata(&p).map(|m| m.len()).unwrap_or(0))
        .sum()
}

/// 列出目录里的所有文件（排序后），用来观察段的增删。
fn list_dir(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir)
        .expect("读目录失败")
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

/// 在段文件的原始字节里数墓碑标记（`val_len == 0xFFFFFFFF`）出现的次数。
///
/// 这是一个**教学用的粗扫描**：它不解析帧，只是找连续 4 个 0xFF。
/// 本例的 value 全是 ASCII 文本，不会误命中；真实引擎里应该用解析的方式数。
fn count_tombstone_marks(dir: &Path) -> usize {
    let mut total = 0;
    for entry in fs::read_dir(dir).expect("读目录失败").filter_map(Result::ok) {
        let path = entry.path();
        if path.extension().is_some_and(|x| x == "log") {
            let bytes = fs::read(&path).unwrap_or_default();
            total += bytes.windows(4).filter(|w| *w == [0xff, 0xff, 0xff, 0xff]).count();
        }
    }
    total
}

fn main() {
    let dir: PathBuf = std::env::temp_dir().join("minidb_gc_demo");
    // 每次运行都从干净状态开始，保证输出可复现
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("建目录失败");

    println!("数据目录：{}", dir.display());
    println!();

    // =======================================================================
    // 1. 反复覆盖同一批 key —— 垃圾就是这样长出来的
    // =======================================================================
    println!("=== 1. 反复覆盖 20 个热 key，各写 100 次 ===");

    let mut engine = SegmentEngine::open(&dir).expect("打开引擎失败");

    const HOT_KEYS: usize = 20;
    const ROUNDS: usize = 100;

    for round in 0..ROUNDS {
        for k in 0..HOT_KEYS {
            engine
                .set(&format!("hot-{k:02}"), format!("value-{round}").into_bytes())
                .expect("写入失败");
        }
    }

    let size_after_writes = seg_bytes(&dir);
    println!("逻辑键数    : {}", HOT_KEYS);
    println!("累计写入次数: {}", HOT_KEYS * ROUNDS);
    println!("磁盘占用    : {size_after_writes} 字节");
    println!("垃圾占比    : {:.1}%", engine.garbage_ratio() * 100.0);
    println!();
    println!("结论：{ROUNDS} 轮覆盖只留下 20 条有效记录，其余 {} 条都是垃圾。",
        HOT_KEYS * ROUNDS - HOT_KEYS);

    // =======================================================================
    // 2. 删除：磁盘不但没变小，反而变大了一点
    // =======================================================================
    println!();
    println!("=== 2. 删除 5 个 key ===");

    let before_delete = seg_bytes(&dir);
    for k in 0..5 {
        let old = engine.delete(&format!("hot-{k:02}")).expect("删除失败");
        assert!(old.is_some(), "被删的键本来应该存在");
    }
    let after_delete = seg_bytes(&dir);

    println!("删除前磁盘占用: {before_delete} 字节");
    println!("删除后磁盘占用: {after_delete} 字节");
    println!("净变化        : +{} 字节（墓碑也要占空间）", after_delete - before_delete);
    println!("墓碑标记数    : {}", count_tombstone_marks(&dir));
    println!("垃圾占比      : {:.1}%", engine.garbage_ratio() * 100.0);
    println!();
    println!("结论：删除 = 追加一条特殊记录（墓碑），**不会**立即释放空间。");

    // =======================================================================
    // 3. 合并压缩
    // =======================================================================
    println!();
    println!("=== 3. 执行合并（compact）===");

    // 注意：目录快照必须**在** compact() 之前取。
    // 如果写在 println! 里，它会在 compact() 之后才求值，打出来的是合并后的状态。
    let before = seg_bytes(&dir);
    let files_before = list_dir(&dir);
    let reclaimed = engine.compact().expect("合并失败");
    let after = seg_bytes(&dir);

    println!("合并前: {before} 字节，目录 = {files_before:?}");
    println!("合并后: {after} 字节，目录 = {:?}", list_dir(&dir));
    println!("引擎报告的回收量: {reclaimed} 字节");
    println!(
        "实际磁盘变化    : -{} 字节（{:.1}%）",
        before.saturating_sub(after),
        (before.saturating_sub(after)) as f64 / before as f64 * 100.0
    );
    println!("合并后垃圾占比  : {:.1}%", engine.garbage_ratio() * 100.0);
    println!("墓碑标记数      : {}", count_tombstone_marks(&dir));

    // 校验：有效数据还在，被删的键没有复活
    let live = engine.keys("hot-").expect("keys 失败");
    println!();
    println!("剩余键数: {}（期望 {}）", live.len(), HOT_KEYS - 5);
    assert_eq!(live.len(), HOT_KEYS - 5, "合并后键数不对");

    for k in 0..5 {
        let got = engine.get(&format!("hot-{k:02}")).expect("查询失败");
        assert!(got.is_none(), "hot-{k:02} 被删了，合并后不该复活");
    }
    for k in 5..HOT_KEYS {
        let got = engine.get(&format!("hot-{k:02}")).expect("查询失败");
        assert_eq!(
            got.as_deref(),
            Some(format!("value-{v}", v = ROUNDS - 1).as_bytes()),
            "hot-{k:02} 的值应该是最后一轮写入的"
        );
    }
    println!("✅ 15 个存活键的值都是最后一轮写入的，5 个被删键没有复活");

    engine.close().expect("关闭失败");

    // =======================================================================
    // 4. 重启后是否还成立？（墓碑被合并掉之后，删除会不会失效）
    // =======================================================================
    println!();
    println!("=== 4. 关闭后重新打开 ===");

    let engine = SegmentEngine::open(&dir).expect("重新打开失败");
    let live = engine.keys("hot-").expect("keys 失败");
    println!("重启后键数: {}（期望 {}）", live.len(), HOT_KEYS - 5);
    assert_eq!(live.len(), HOT_KEYS - 5);

    let resurrected = engine.get("hot-00").expect("查询失败");
    println!("重启后 GET hot-00 = {resurrected:?}（期望 None）");
    assert!(resurrected.is_none(), "合并已经把墓碑连同记录一起丢掉了，键不该复活");
    println!("✅ 合并时把被删键整条丢掉，所以不需要保留墓碑来\"压制\"旧值");
    drop(engine);

    // =======================================================================
    // 5. 合并中途崩溃：留下一个孤儿临时文件，但数据完好
    // =======================================================================
    println!();
    println!("=== 5. 模拟合并中途崩溃（留下 .compacting 临时文件）===");

    let orphan = dir.join(format!("{:09}.log.compacting", 999_999_999));
    fs::write(&orphan, vec![0xAB_u8; 4096]).expect("写孤儿文件失败");
    println!("已写入孤儿文件: {}", orphan.file_name().unwrap().to_string_lossy());

    let engine = SegmentEngine::open(&dir).expect("带着孤儿文件打开失败");
    let live = engine.keys("hot-").expect("keys 失败");
    println!("带孤儿文件打开后键数: {}", live.len());
    assert_eq!(live.len(), HOT_KEYS - 5, "孤儿临时文件不该影响数据");
    println!("✅ 数据完好 —— 因为合并是\"写临时文件 + 原子 rename\"，临时的半成品不会被当成段");
    println!("⚠️  但孤儿文件会一直占着磁盘：{} 字节", fs::metadata(&orphan).map(|m| m.len()).unwrap_or(0));
    println!("   生产实现要在 open 时清理所有 *.compacting（本项目的 TODO）");
    drop(engine);

    println!();
    println!("全部断言通过 ✅");
    println!("提示：数据留在 {}，可以自己 ls / xxd 看", dir.display());
}
