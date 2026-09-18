//! # 示例：崩溃恢复
//!
//! 这个例子把四种常见的"坏磁盘状态"造出来，看引擎怎么恢复：
//!
//! | 场景 | 人为破坏 | 期望结果 |
//! |------|---------|---------|
//! | A | 文件尾部追加半个帧（模拟写一半断电） | 半帧被截掉，之前的数据全在 |
//! | B | 中间某条记录被改了一个字节（位翻转） | **从坏记录开始，后面全部丢失** |
//! | C | 删掉 manifest.json | 靠扫描目录推断，数据全在 |
//! | D | 留下一个残留的 LOCK 文件 | 拒绝打开（防止两个进程同时写） |
//! | E | 写入后不关闭就"崩溃" | 数据在内核缓存里，进程崩溃不丢；断电才丢 |
//!
//! 运行：
//! ```bash
//! cargo run --example recovery_demo
//! ```

use minidb::prelude::Engine;
use std::fs;
use std::path::{Path, PathBuf};

const KEYS: usize = 5;

/// 每次场景都用一个全新的目录，保证输出可复现。
fn fresh_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("minidb_recovery_demo").join(name);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("建目录失败");
    dir
}

/// 写入 5 条记录并正常关闭，返回干净状态下的段文件大小。
fn seed(dir: &Path) -> u64 {
    let mut engine = Engine::open(dir).expect("打开失败");
    for i in 0..KEYS {
        engine
            .set(&format!("k{i}"), format!("value-{i}"))
            .expect("写入失败");
    }
    engine.close().expect("关闭失败");
    fs::metadata(dir.join("000000001.log")).map(|m| m.len()).unwrap_or(0)
}

/// 解析出每一帧的起始偏移。
///
/// 这就是模块二讲的帧格式：12 字节头 + key + value + 4 字节 CRC。
/// 能"扫出边界"本身就说明格式是自描述的。
fn frame_starts(bytes: &[u8]) -> Vec<u64> {
    let mut starts = Vec::new();
    let mut pos = 0usize;
    while pos + 12 <= bytes.len() {
        if bytes[pos..pos + 4] != [0x4D, 0x44, 0x42, 0x31] {
            break;
        }
        let key_len = u32::from_le_bytes([bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]]) as usize;
        let val_len = u32::from_le_bytes([bytes[pos + 8], bytes[pos + 9], bytes[pos + 10], bytes[pos + 11]]);
        let value_len = if val_len == u32::MAX { 0 } else { val_len as usize };
        starts.push(pos as u64);
        pos += 12 + key_len + value_len + 4;
    }
    starts
}

fn main() {
    let base = std::env::temp_dir().join("minidb_recovery_demo");
    let _ = fs::remove_dir_all(&base);
    fs::create_dir_all(&base).expect("建根目录失败");

    // =======================================================================
    // 基线：干净写入
    // =======================================================================
    println!("=== 基线：正常写入 {} 条记录并关闭 ===", KEYS);
    let dir0 = fresh_dir("baseline");
    let clean_len = seed(&dir0);
    let starts = frame_starts(&fs::read(dir0.join("000000001.log")).unwrap());
    println!("段大小      : {clean_len} 字节");
    println!("帧起始偏移  : {starts:?}");
    println!("每帧固定 {} 字节（key 2 + value 7 + 头尾 16）", starts[1] - starts[0]);
    println!();

    // =======================================================================
    // 场景 A：尾部半帧
    // =======================================================================
    println!("=== 场景 A：写一半断电（尾部追加半个帧）===");
    let dir = fresh_dir("a_torn_tail");
    let before = seed(&dir);

    let seg = dir.join("000000001.log");
    let mut bytes = fs::read(&seg).expect("读段失败");
    bytes.extend_from_slice(&[0x4D, 0x44, 0x42, 0x31, 0x01, 0x00]); // 魔数 + 残缺长度
    fs::write(&seg, &bytes).expect("写回失败");
    println!("追加 6 字节垃圾后，文件大小: {}", fs::metadata(&seg).unwrap().len());

    {
        let engine = Engine::open(&dir).expect("打开失败");
        let keys = engine.keys("").expect("keys 失败");
        println!("恢复后键数  : {}（期望 {}）", keys.len(), KEYS);
        println!("k4 的值     : {:?}", String::from_utf8(engine.get("k4").unwrap().unwrap()).unwrap());
        assert_eq!(keys.len(), KEYS, "好数据不该丢");
        engine.close().expect("关闭失败");
    }
    let after = fs::metadata(&seg).unwrap().len();
    println!("截断后大小  : {after} 字节（恢复成 {before}）");
    assert_eq!(after, before, "半帧应该被截掉");
    println!("✅ 半帧被丢弃，好数据完好 —— 因为日志是 append-only，最后一个不完整帧一定是崩溃时的半次写");
    println!();

    // =======================================================================
    // 场景 B：中间位翻转
    // =======================================================================
    println!("=== 场景 B：中间一条记录被改了一个字节 ===");
    let dir = fresh_dir("b_bitflip");
    seed(&dir);

    let seg = dir.join("000000001.log");
    let mut bytes = fs::read(&seg).expect("读段失败");
    let starts = frame_starts(&bytes);
    // 篡改第 3 条记录（下标 2）的 value 第一个字节
    let victim = 2;
    let value_off = starts[victim] as usize + 12 + 2; // 12 字节头 + key("k2") 2 字节
    let original = bytes[value_off];
    bytes[value_off] ^= 0xFF;
    fs::write(&seg, &bytes).expect("写回失败");
    println!("第 {victim} 条记录（offset {}）的 value 首字节: 0x{original:02x} → 0x{:02x}",
        starts[victim], bytes[value_off]);

    {
        let engine = Engine::open(&dir).expect("打开失败");
        let keys = engine.keys("").expect("keys 失败");
        println!("恢复后键数  : {}（原本 {KEYS} 条）", keys.len());
        println!("存活的键    : {keys:?}");
        assert_eq!(keys.len(), victim, "坏记录之后的数据也被截掉了");
        // 注意 k2 本身也没了：截断发生在**它开始的地方**
        assert!(engine.get("k2").unwrap().is_none());
        engine.close().expect("关闭失败");
    }
    println!("截断后大小  : {} 字节（干净时是 {clean_len}）", fs::metadata(&seg).unwrap().len());
    println!("⚠️  一条记录坏掉，它**后面所有**记录都保不住 —— 变长帧无法在坏点之后重新同步");
    println!("   这不是实现偷懒：损坏的 val_len 让你不知道下一条记录从哪开始");
    println!();

    // =======================================================================
    // 场景 C：manifest 丢失
    // =======================================================================
    println!("=== 场景 C：删掉 manifest.json ===");
    let dir = fresh_dir("c_no_manifest");
    seed(&dir);

    let manifest = dir.join("manifest.json");
    println!("删除前目录  : {:?}", sorted_names(&dir));
    fs::remove_file(&manifest).expect("删除 manifest 失败");
    println!("删除后目录  : {:?}", sorted_names(&dir));

    {
        let engine = Engine::open(&dir).expect("带着缺失的 manifest 打开失败");
        let keys = engine.keys("").expect("keys 失败");
        println!("恢复后键数  : {}", keys.len());
        assert_eq!(keys.len(), KEYS, "扫描目录兜底应该救回全部数据");
        engine.close().expect("关闭失败");
    }
    println!("重建后目录  : {:?}", sorted_names(&dir));
    println!("✅ manifest 只是**加速启动的缓存**，真正的数据在段文件里");
    println!();

    // =======================================================================
    // 场景 D：残留 LOCK
    // =======================================================================
    println!("=== 场景 D：残留的 LOCK 文件（模拟上次 kill -9）===");
    let dir = fresh_dir("d_stale_lock");
    seed(&dir);

    fs::write(dir.join("LOCK"), b"").expect("写 LOCK 失败");
    match Engine::open(&dir) {
        Ok(_) => panic!("有 LOCK 时不该打开成功"),
        Err(e) => println!("打开失败（这是正确的）: {e}"),
    }
    println!("✅ 拒绝打开 —— 宁可拒绝也不能让两个进程同时写一个目录");
    println!("⚠️  代价：真正的 kill -9 之后必须人工删 LOCK。生产实现要写 pid 并检查 pid 是否存活");
    println!();

    // =======================================================================
    // 场景 E：写入后不关闭
    // =======================================================================
    println!("=== 场景 E：写入后不关闭（进程被 kill -9）===");
    let dir = fresh_dir("e_no_close");
    {
        let mut engine = Engine::open(&dir).expect("打开失败");
        engine.set("x", "1").expect("写入失败");
        engine.set("y", "2").expect("写入失败");

        // 不调用 close()，直接看磁盘上有没有
        let len = fs::metadata(dir.join("000000001.log")).map(|m| m.len()).unwrap_or(0);
        println!("未关闭时文件大小: {len} 字节");
        assert!(len > 0, "write() 已经把数据交给了内核");

        // 故意泄漏，跳过 Drop（≈ 进程被 kill -9，析构函数没机会跑）
        std::mem::forget(engine);
    }
    println!("✅ 数据已经在内核 page cache 里，进程崩溃不会丢");
    println!("⚠️  但**没有 fsync**：整机断电时，内核还没回写的部分会丢");
    println!("   本项目只在段滚动 / 关闭 / 合并时 fsync，所以断电可能丢最后几秒的写入");

    println!();
    println!("全部断言通过 ✅");
    println!("提示：各场景的数据留在 {}", base.display());
}

/// 目录里的文件名（排序后）。
fn sorted_names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir)
        .expect("读目录失败")
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}
