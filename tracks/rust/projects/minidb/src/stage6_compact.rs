//! # 阶段 6：崩溃恢复与段合并（Compaction）
//!
//! 目标：把单段 WAL 升级成**多段（segment）+ 定期合并**的完整 Bitcask 引擎。
//! 这是存储引擎的核心工程部分，也是 Rust 与 Java 差异最"爽"的地方之一。
//!
//! ## 与 Java 的对照
//!
//! | 概念 | Java | Rust |
//! |------|------|------|
//! | 目录扫描 | `Files.list(dir)` 返回 `Stream<Path>` | `fs::read_dir` 返回 `Result<DirEntry>` 迭代器 |
//! | 原子替换 | `Files.move(src, dst, ATOMIC_MOVE)` | `fs::rename`（同一文件系统内是原子的） |
//! | 配置文件 | Jackson `readValue(new File("manifest.json"))` | `serde_json::from_reader` |
//! | 资源持有 | 靠 `Map<Long, RandomAccessFile>` + 手动 close | `BTreeMap<u64, File>`，**结构体析构即全部关闭** |
//! | 迭代器 | `Iterator<T>`（对象，一次性） | `impl Iterator<Item = T>`（零成本抽象，可组合） |
//! | 延迟计算 | `Stream`（有装箱开销） | `Iterator`（单态化，通常编译成裸循环） |
//!
//! ## 为什么需要 compaction？
//! append-only 日志里，同一个 key 被写 100 次就留了 100 条记录，
//! 只有最后一条有效，前 99 条是垃圾。compaction 就是"重写有效数据、丢弃垃圾"。
//! 这也是 LevelDB/RocksDB 的 LSM 与 Bitcask 共同的思想。

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};

use crate::error::{KvError, Result};
use crate::stage4_traits::KvStore;

// 为了让 stage5 与 stage6 共享二进制帧格式，这里直接复用 stage5 的编解码函数。
// 真实项目里这些函数应该抽到独立的 `frame` 模块——这里为了保持"阶段递进"的教学结构，
// 故意留在 stage5，让你看到模块之间如何通过 `pub(crate)` 共享内部实现。
use crate::stage5_wal as frame;

/// manifest 文件格式版本。
/// ≈ Java 里序列化类的 serialVersionUID：格式变了就拒绝加载，避免读到乱码。
const MANIFEST_VERSION: u32 = 1;
/// 活跃段超过这个大小就滚动到新段（1 MiB，方便测试触发）。
/// 生产里通常是 64 MiB ~ 1 GiB。
const SEGMENT_MAX_BYTES: u64 = 1024 * 1024;
/// 垃圾占比超过这个阈值时，`maybe_compact()` 会建议合并。
const COMPACT_THRESHOLD: f64 = 0.3;

/// 记录在数据目录里的位置。
#[derive(Debug, Clone, Copy)]
struct Location {
    seg: u64,
    offset: u64,
    len: u64,
}

/// 段元数据清单（落盘为 manifest.json）。
///
/// `#[derive(Serialize, Deserialize)]` ≈ Jackson 的 `@Data` + `ObjectMapper`，
/// 但有本质区别：**没有反射**。宏在编译期生成 `to_json`/`from_json` 的代码，
/// 运行期就是普通的字段读写，还能被内联。
#[derive(Debug, Serialize, Deserialize)]
struct Manifest {
    version: u32,
    active_id: u64,
    /// 已冻结的只读段 id（升序）。
    frozen: Vec<u64>,
}

/// 多段 Bitcask 引擎。
pub struct SegmentEngine {
    dir: PathBuf,
    /// 已打开的历史段读句柄。`BTreeMap` 而不是 `HashMap`：
    /// 段必须按 id 顺序重放（后写的覆盖先写的），有序容器让这个语义显式化。
    frozen: BTreeMap<u64, File>,
    active_id: u64,
    /// 活跃段的**写句柄**。
    ///
    /// ⚠️ 这里刻意**不用** `BufWriter`：
    /// 活跃段同时被写（append）和随机读（`get` 按索引里的 offset seek）。
    /// 如果加了写缓冲，刚写进去的记录还在用户态缓冲区里，读端在文件上看不到它，
    /// 会读到 EOF 并被误判成"数据损坏"。
    /// 于是我们依赖**操作系统 page cache** 做写入合并——
    /// `write(2)` 本身是进内核缓存的，速度远比想象中快。
    ///
    /// 这个坑在 Java 里一模一样：`BufferedWriter` 和 `RandomAccessFile` 混用会出问题，
    /// 只不过 Java 会静默返回旧数据/半截数据，而 Rust 会明确报 Corrupted。
    ///
    /// 生产引擎的做法通常是：写进内存 MemTable，读也先查 MemTable，只有 miss 才落盘。
    active_writer: File,
    active_pos: u64,
    index: HashMap<String, Location>,
    dead_bytes: u64,
    live_bytes: u64,
    /// 目录锁文件句柄。用 `Option` 包一层是为了能在 `Drop` 里**先关闭再删除**：
    /// Windows 不允许删除仍被打开的文件（Linux 可以），顺序搞反就会报"拒绝访问"。
    /// 这也是 RAII 的典型用法：句柄随 `Self` 析构而关闭，锁自动释放。
    lock: Option<File>,
}

impl SegmentEngine {
    /// 打开数据目录，必要时恢复。
    pub fn open(dir: impl AsRef<Path>) -> Result<Self> {
        let dir = dir.as_ref().to_path_buf();
        fs::create_dir_all(&dir)?;

        let lock = OpenOptions::new().write(true).create_new(true).open(dir.join("LOCK")).map_err(|e| {
            if e.kind() == io::ErrorKind::AlreadyExists {
                KvError::Protocol(format!("数据目录已被占用: {}", dir.display()))
            } else {
                KvError::Io(e)
            }
        })?;

        // ---- 1. 读取或推断 manifest（serde 的用武之地）----
        let manifest = Self::load_manifest(&dir)?;

        // ---- 2. 打开所有段并重建索引 ----
        let mut frozen = BTreeMap::new();
        let mut index: HashMap<String, Location> = HashMap::new();
        let mut dead_bytes = 0u64;
        let mut live_bytes = 0u64;

        for seg_id in manifest.frozen.iter().copied() {
            let path = Self::seg_path(&dir, seg_id);
            let file = File::open(&path)?;
            // 重放单个段：借用 &mut index，因此需要把其他借用分开——
            // 这就是 Rust 所有权在"防止 aliasing"上的直接体现。
            // 传 &path 是为了截断时能重新以**写模式**打开（见 replay_segment 里的注释）。
            let (d, l) = replay_segment(&file, seg_id, &mut index, &path)?;
            dead_bytes += d;
            live_bytes += l;
            frozen.insert(seg_id, file);
        }

        // ---- 3. 打开活跃段 ----
        let active_path = Self::seg_path(&dir, manifest.active_id);
        let active_file = OpenOptions::new().create(true).read(true).append(true).open(&active_path)?;
        let active_clone = active_file.try_clone()?;
        let (d, l) = replay_segment(&active_clone, manifest.active_id, &mut index, &active_path)?;
        dead_bytes += d;
        live_bytes += l;
        let active_pos = active_clone.metadata()?.len();

        Ok(Self {
            dir,
            frozen,
            active_id: manifest.active_id,
            active_writer: active_file,
            active_pos,
            index,
            dead_bytes,
            live_bytes,
            lock: Some(lock),
        })
    }

    /// 加载 manifest；不存在则扫描目录推断（向后兼容老数据）。
    fn load_manifest(dir: &Path) -> Result<Manifest> {
        let path = dir.join("manifest.json");
        if path.exists() {
            let file = File::open(path)?;
            // serde_json::from_reader ≈ objectMapper.readValue(inputStream, T.class)
            let m: Manifest = serde_json::from_reader(BufReader::new(file))?;
            if m.version != MANIFEST_VERSION {
                return Err(KvError::Corrupted {
                    reason: format!("manifest 版本不匹配: {} != {MANIFEST_VERSION}", m.version),
                    truncated_at: 0,
                });
            }
            return Ok(m);
        }

        // 目录里已有 .log 但没有 manifest → 扫描文件名推断段 id
        let mut ids: Vec<u64> = fs::read_dir(dir)?
            .filter_map(std::result::Result::ok)
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                name.strip_suffix(".log")?.parse::<u64>().ok()
            })
            .collect();
        ids.sort_unstable();
        let active_id = ids.pop().unwrap_or(1);
        Ok(Manifest { version: MANIFEST_VERSION, active_id, frozen: ids })
    }

    /// 持久化 manifest（**先写临时文件再 rename**，保证原子性）。
    fn save_manifest(&self) -> Result<()> {
        let m = Manifest {
            version: MANIFEST_VERSION,
            active_id: self.active_id,
            frozen: self.frozen.keys().copied().collect(),
        };
        let tmp = self.dir.join("manifest.json.tmp");
        {
            let mut f = BufWriter::new(File::create(&tmp)?);
            serde_json::to_writer(&mut f, &m)?;
            f.flush()?;
            f.get_ref().sync_all()?;
        } // ← f 在这里离开作用域，Drop 自动关闭文件（≈ try-with-resources）
        // rename 在同一文件系统内是原子的：不会出现"manifest 写了一半"的中间态
        fs::rename(tmp, self.dir.join("manifest.json"))?;
        Ok(())
    }

    /// 段文件路径：`<dir>/000000001.log`。
    fn seg_path(dir: &Path, id: u64) -> PathBuf {
        dir.join(format!("{id:09}.log"))
    }

    /// 当前活跃段是否该滚动。
    fn should_roll(&self) -> bool {
        self.active_pos >= SEGMENT_MAX_BYTES
    }

    /// 滚动：把活跃段冻结为只读段，开一个新的活跃段。
    fn roll(&mut self) -> Result<()> {
        // 没有用户态缓冲区要刷，直接 fsync 即可
        self.active_writer.sync_all()?;

        let old_id = self.active_id;
        let reader = File::open(Self::seg_path(&self.dir, old_id))?;
        self.frozen.insert(old_id, reader);

        let new_id = old_id + 1;
        let f = OpenOptions::new()
            .create(true)
            .read(true)
            .append(true)
            .open(Self::seg_path(&self.dir, new_id))?;
        self.active_writer = f;
        self.active_id = new_id;
        self.active_pos = 0;
        self.save_manifest()?;
        log::info!("段滚动: {old_id} -> {new_id}");
        Ok(())
    }

    /// 追加一条记录，返回位置。
    fn append(&mut self, key: &str, value: Option<&[u8]>) -> Result<Location> {
        let bytes = frame::encode_frame(key, value);
        let offset = self.active_pos;
        self.active_writer.write_all(&bytes)?;
        self.active_pos += bytes.len() as u64;
        Ok(Location { seg: self.active_id, offset, len: bytes.len() as u64 })
    }

    /// 读取某个位置的值。
    ///
    /// 注意这里**没有 clone 句柄**：`read_frame_at` 用的是位置读取
    /// （`read_at` / `seek_read`），不修改文件游标，所以传 `&File` 就够。
    /// 多个读者同时调用这个函数是安全的——这是索引能支撑并发读的前提。
    fn read_at(&self, loc: Location) -> Result<Option<Vec<u8>>> {
        let file: &File = if loc.seg == self.active_id {
            &self.active_writer
        } else {
            self.frozen
                .get(&loc.seg)
                .ok_or_else(|| KvError::Corrupted {
                    reason: format!("找不到段 {}", loc.seg),
                    truncated_at: loc.offset,
                })?
        };
        Ok(frame::read_frame_at(file, loc.offset)?.value)
    }

    /// 垃圾占比（0.0 ~ 1.0）。
    // u64 → f64 在大数值下会丢精度，但占比只需要两位有效数字，这里明确允许。
    #[must_use]
    #[allow(clippy::cast_precision_loss)]
    pub fn garbage_ratio(&self) -> f64 {
        let total = self.dead_bytes + self.live_bytes;
        if total == 0 {
            return 0.0;
        }
        self.dead_bytes as f64 / total as f64
    }

    /// 如果垃圾够多就自动合并一次，返回是否执行了合并。
    pub fn maybe_compact(&mut self) -> Result<bool> {
        if self.garbage_ratio() < COMPACT_THRESHOLD {
            return Ok(false);
        }
        self.compact()?;
        Ok(true)
    }

    /// 段合并：把所有有效记录重写到一个新段，然后原子替换。
    ///
    /// 步骤（每一步都要考虑"此时断电会怎样"）：
    /// 1. 写到临时文件 → 断电：临时文件是垃圾，旧数据完好
    /// 2. fsync 临时文件 → 断电：同上
    /// 3. rename 覆盖 → 原子的，要么全成要么全不成
    /// 4. 更新内存索引 → 纯内存操作
    /// 5. 删除旧段文件 → 断电：最多留下垃圾文件，下次启动扫描时清理
    pub fn compact(&mut self) -> Result<u64> {
        if self.index.is_empty() {
            return Ok(0);
        }
        // 合并前先 fsync：确保待迁移的数据已经真正落盘，
        // 否则"合并写完了但原数据还在内存里"时断电，就会丢数据。
        // （因为活跃段没用 BufWriter，这里不需要 flush 用户态缓冲区）
        self.active_writer.sync_all()?;

        let reclaimed = self.dead_bytes;
        let new_id = self.active_id + 1 + 1000; // 用一个明显更大的 id，避免与活跃段冲突
        let tmp_path = self.dir.join(format!("{new_id:09}.log.compacting"));

        // 收集要保留的键并排序：保证多次合并结果一致，也让读出顺序更顺序化
        let mut keys: Vec<String> = self.index.keys().cloned().collect();
        keys.sort();

        let mut new_index: HashMap<String, Location> = HashMap::with_capacity(keys.len());
        {
            let file = File::create(&tmp_path)?;
            let mut w = BufWriter::new(file);
            let mut pos = 0u64;

            for key in &keys {
                let old_loc = self.index[key];
                if let Some(value) = self.read_at(old_loc)? {
                    let bytes = frame::encode_frame(key, Some(&value));
                    w.write_all(&bytes)?;
                    new_index.insert(key.clone(), Location { seg: new_id, offset: pos, len: bytes.len() as u64 });
                    pos += bytes.len() as u64;
                }
            }
            w.flush()?;
            w.get_ref().sync_all()?;
        } // Drop 关闭文件

        let final_path = Self::seg_path(&self.dir, new_id);
        fs::rename(&tmp_path, &final_path)?;

        // 删除旧段（活跃段也要删，稍后重建一个空的）
        let old_ids: Vec<u64> = self.frozen.keys().copied().collect();
        let old_active = self.active_id;
        self.frozen.clear();
        self.live_bytes = 0;
        for id in old_ids {
            let _ = fs::remove_file(Self::seg_path(&self.dir, id));
        }
        let _ = fs::remove_file(Self::seg_path(&self.dir, old_active));

        // 合并出来的段是**只读**的，必须登记进 frozen，否则后续读会找不到段。
        // （这是合并逻辑里最容易漏的一步：索引指向了新段，但段句柄表没更新。）
        self.frozen.insert(new_id, File::open(&final_path)?);

        // 重建活跃段：用一个更新的 id，避免复用刚删掉的号
        let fresh_id = new_id + 1;
        let f = OpenOptions::new()
            .create(true)
            .read(true)
            .append(true)
            .open(Self::seg_path(&self.dir, fresh_id))?;
        self.active_writer = f;
        self.active_id = fresh_id;
        self.active_pos = 0;

        self.index = new_index;
        self.dead_bytes = 0;
        self.live_bytes = Self::seg_path(&self.dir, new_id).metadata()?.len();
        self.save_manifest()?;
        log::info!("合并完成，回收 {reclaimed} 字节");
        Ok(reclaimed)
    }

    /// 遍历所有有效键值对（演示**生命周期 + 惰性迭代器**）。
    ///
    /// 返回 `impl Iterator + '_`：
    /// - `impl Iterator` 让调用方可以用 `.map()` `.filter()` `.take()` 组合，
    ///   编译后通常内联成一个手写循环（零成本抽象）
    /// - `+ '_` 表示"这个迭代器借用了 self"，所以**不能比 self 活得久**
    ///
    /// Java 的 `Stream` 做不到"借用检查"：你必须自己保证流没被逃逸出去。
    pub fn iter(&self) -> impl Iterator<Item = Result<(String, Vec<u8>)>> + '_ {
        let mut keys: Vec<&String> = self.index.keys().collect();
        keys.sort();
        keys.into_iter().map(move |k| {
            let loc = self.index[k];
            // 这里借用 self（不可变），编译器保证迭代期间没人能 &mut self
            match self.read_at(loc) {
                Ok(Some(v)) => Ok((k.clone(), v)),
                Ok(None) => Err(KvError::KeyNotFound { key: k.clone() }),
                Err(e) => Err(e),
            }
        })
    }

    /// 关闭引擎（消费所有权，保证关闭后不可再用）。
    pub fn close(self) -> Result<()> {
        self.active_writer.sync_all()?;
        self.save_manifest()?;
        drop(self);
        Ok(())
    }
}

/// 重放单个段，把结果合并进 `index`，返回 (新增垃圾, 新增有效字节)。
///
/// 这是一个**自由函数**而不是方法，因为它需要 `&mut index` 而 `SegmentEngine`
/// 的其他字段不能被同时借用——拆成自由函数是绕过借用冲突最干净的方式之一。
/// （Java 开发者会本能地想写成 private 方法，在 Rust 里这常常编译不过。）
fn replay_segment(file: &File, seg_id: u64, index: &mut HashMap<String, Location>, path: &Path) -> Result<(u64, u64)> {
    let len = file.metadata()?.len();
    let mut pos = 0u64;
    let mut dead = 0u64;
    let mut live = 0u64;

    while pos < len {
        // read_frame_at 需要 Read + Seek；File 两者都实现了
        match frame::read_frame_at(file, pos) {
            Ok(f) => {
                let loc = Location { seg: seg_id, offset: pos, len: f.consumed };
                if f.value.is_some() {
                    if let Some(old) = index.insert(f.key, loc) {
                        dead += old.len;
                        // 用 saturating_sub 而不是 `-`：旧记录可能在**另一个段**里，
                        // 本段的 live 计数里没有它。debug 模式下整数溢出会 panic，
                        // 这是 Rust 与 Java 很大的不同（Java 的 long 会静默回绕）。
                        live = live.saturating_sub(old.len);
                    }
                    live += f.consumed;
                } else {
                    if let Some(old) = index.remove(&f.key) {
                        dead += old.len;
                        live = live.saturating_sub(old.len);
                    }
                    dead += f.consumed;
                }
                pos += f.consumed;
            }
            // 尾部残缺：截断到最后一个完整帧。
            // 这是 crash recovery 的关键：**日志是 append-only 的，
            // 所以最后一个不完整的帧一定是崩前的半次写，丢掉即可**。
            Err(KvError::Corrupted { truncated_at, .. }) => {
                log::warn!("段 {seg_id} 在 offset {truncated_at} 处损坏，已截断");
                // 必须用**写模式**打开才能 set_len。
                // 段文件平时以只读打开（更安全：防止误写历史段），
                // 所以截断这一步要临时换一个句柄。
                // （这个坑在 Linux 上不报错、只在 Windows 上报 PermissionDenied，
                //   跨平台开发时要格外小心权限差异。）
                let writable = OpenOptions::new().write(true).open(path)?;
                writable.set_len(truncated_at)?;
                writable.sync_all()?;
                break;
            }
            Err(e) => return Err(e),
        }
    }
    Ok((dead, live))
}

impl KvStore for SegmentEngine {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        match self.index.get(key) {
            Some(loc) => self.read_at(*loc),
            None => Ok(None),
        }
    }

    fn set(&mut self, key: &str, value: Vec<u8>) -> Result<()> {
        if self.should_roll() {
            self.roll()?;
        }
        let loc = self.append(key, Some(&value))?;
        if let Some(old) = self.index.insert(key.to_owned(), loc) {
            self.dead_bytes += old.len;
            self.live_bytes -= old.len;
        }
        self.live_bytes += loc.len;
        Ok(())
    }

    fn delete(&mut self, key: &str) -> Result<Option<Vec<u8>>> {
        let Some(loc) = self.index.remove(key) else {
            return Ok(None);
        };
        let old = self.read_at(loc)?;
        // 墓碑也要落盘，否则重启后键会"复活"
        let tomb = self.append(key, None)?;
        self.dead_bytes += loc.len + tomb.len;
        self.live_bytes -= loc.len;
        Ok(old)
    }

    fn keys(&self, prefix: &str) -> Result<Vec<String>> {
        let mut out: Vec<String> = self.index.keys().filter(|k| k.starts_with(prefix)).cloned().collect();
        out.sort_unstable();
        Ok(out)
    }

    fn compact(&mut self) -> Result<u64> {
        SegmentEngine::compact(self)
    }
}

impl Drop for SegmentEngine {
    fn drop(&mut self) {
        // Drop 里只能"尽力而为"：没有用户态缓冲要刷，做一次 fsync 即可
        if let Err(e) = self.active_writer.sync_all() {
            log::error!("关闭时 sync 失败: {e}");
        }
        // 正常退出时删掉锁文件，让下一次 open 能成功。
        // 注意顺序：先 take() 把 File 移出并 drop（关闭句柄），**再**删除文件。
        // 进程被 kill -9 时这里不会执行，锁文件会残留——
        // 生产实现要把 pid 写进锁文件并在 open 时检查该 pid 是否还活着
        // （或用 `fs2` 的 OS 级 flock，进程退出由内核自动释放）。
        drop(self.lock.take());
        let _ = fs::remove_file(self.dir.join("LOCK"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segment_roll_and_recovery() {
        let dir = tempfile::tempdir().unwrap();
        {
            let mut e = SegmentEngine::open(dir.path()).unwrap();
            // 写足够多的数据触发滚动
            for i in 0..200 {
                let v = vec![7u8; 8192]; // 8KB × 200 ≈ 1.6MB > 1MiB 阈值
                e.set(&format!("k{i}"), v).unwrap();
            }
            assert!(!e.frozen.is_empty(), "应该至少冻结了一个段");
            e.close().unwrap();
        }
        // 重新打开：索引靠重放重建
        let e = SegmentEngine::open(dir.path()).unwrap();
        assert_eq!(e.get("k0").unwrap().map(|v| v.len()), Some(8192));
        assert_eq!(e.keys("k").unwrap().len(), 200);
    }

    #[test]
    fn compaction_reclaims_space() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = SegmentEngine::open(dir.path()).unwrap();
        for _ in 0..50 {
            e.set("hot", b"value".to_vec()).unwrap(); // 反复覆盖同一个键
        }
        let garbage_before = e.dead_bytes;
        assert!(garbage_before > 0);

        let reclaimed = e.compact().unwrap();
        assert!(reclaimed > 0);
        assert_eq!(e.dead_bytes, 0);
        // 合并后数据依然可读
        assert_eq!(e.get("hot").unwrap(), Some(b"value".to_vec()));
    }

    #[test]
    fn crash_mid_write_is_recoverable() {
        let dir = tempfile::tempdir().unwrap();
        {
            let mut e = SegmentEngine::open(dir.path()).unwrap();
            e.set("good", b"data".to_vec()).unwrap();
            e.close().unwrap();
        }
        // 手动在文件尾部追加半个损坏的帧，模拟断电
        let seg = dir.path().join(format!("{:09}.log", 1));
        let mut f = OpenOptions::new().append(true).open(&seg).unwrap();
        f.write_all(&[0x4D, 0x44, 0x42, 0x31, 0x01, 0x00]).unwrap(); // 魔数 + 残缺长度
        f.sync_all().unwrap();
        drop(f);

        // 恢复后：好数据还在，坏尾巴被截掉
        let e = SegmentEngine::open(dir.path()).unwrap();
        assert_eq!(e.get("good").unwrap(), Some(b"data".to_vec()));
    }

    #[test]
    fn iterator_is_lazy_and_borrows_self() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = SegmentEngine::open(dir.path()).unwrap();
        e.set("a", b"1".to_vec()).unwrap();
        e.set("b", b"2".to_vec()).unwrap();

        // take(1) 只处理一个元素——惰性求值的证明
        let first: Vec<_> = e.iter().take(1).collect();
        assert_eq!(first.len(), 1);
    }
}
