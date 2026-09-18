//! # 阶段 5：持久化 —— WAL、RAII 与底层 I/O
//!
//! 目标：把内存引擎改造成 **append-only 日志（WAL）+ 内存哈希索引** 的 Bitcask 引擎，
//! 做到进程重启后数据不丢。
//!
//! ## 与 Java 的对照
//!
//! | Java | Rust |
//! |------|------|
//! | `try (var out = new BufferedWriter(...))` | `BufWriter` + `Drop`（编译器自动关闭，**不可能忘记**） |
//! | `finally { close(); }` 写漏 → 句柄泄漏 | 没有 finally，作用域结束即释放 |
//! | `close()` 抛 `IOException` | `drop()` **不能**返回错误 → 惯用法是显式 `close(self) -> Result` |
//! | `RandomAccessFile.seek()` | `File::seek(SeekFrom::Start(n))`，同样需要 `&mut` |
//! | Jackson 序列化到 byte[] | 手写二进制帧（见下）或 serde；本阶段手写，阶段 6 用 serde 存 manifest |
//! | `FileLock` / `flock` | std 没有，需要 `fs2`/`file-lock` crate；这里用 `create_new` 做简易互斥 |
//!
//! ## 为什么这里不用 serde/JSON 存 WAL？
//! 真实引擎的 WAL 是二进制帧：定长头 + 变长体 + 校验和。
//! JSON 会让 100 字节的值膨胀成 300+ 字节的数组文本，还要每次解析数字。
//! 但 JSON 便于 `cat` 排查——所以本模块提供 `dump()` 把 WAL 转成人类可读文本（调试用）。
//! **这就是 Rust 工程的典型取舍：热路径用手写二进制，调试路径用 serde。**

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::error::{KvError, Result};
use crate::stage4_traits::KvStore;

/// 帧头魔数，用于快速判断"这里是不是一条合法记录"。
/// ≈ Java 里 class 文件的 0xCAFEBABE。
const MAGIC: [u8; 4] = *b"MDB1";
/// 帧头固定长度：magic(4) + `key_len(4)` + `val_len(4)`。
const HEADER_LEN: usize = 12;
/// 帧尾校验和长度（CRC32）。
const FOOTER_LEN: usize = 4;
/// 防御性上限：单条记录最大 64 MiB。
/// 放在模块常量区而不是函数体里，读不能信数据时用它做边界检查。
const MAX_RECORD: usize = 64 << 20;
/// `val_len == TOMBSTONE` 表示这是一条删除墓碑记录。
/// 用哨兵值而不是 `Option<u32>`，是因为定长二进制帧里放 Option 会浪费字节。
const TOMBSTONE: u32 = u32::MAX;

/// 索引条目：键 → 记录在日志文件中的位置。
///
/// Bitcask 的核心思想：**磁盘上只有 append-only 日志，内存中只有"键 → 偏移"的哈希索引**。
/// 于是随机读退化成一次 seek + 一次顺序读，写永远是最快的 append。
/// 代价是删除和更新会产生垃圾（阶段 6 的 compaction 负责回收）。
#[derive(Debug, Clone, Copy)]
struct IndexEntry {
    offset: u64,
    len: u64,
}

/// 基于 WAL 的持久化引擎（单段版本，阶段 6 会扩展为多段 + 合并）。
pub struct WalEngine {
    dir: PathBuf,
    /// 键 → 记录位置。Java 里这是 `HashMap<String, Long>`，
    /// 但注意这里**没有**任何锁——阶段 7 我们再解决并发问题。
    index: HashMap<String, IndexEntry>,
    /// 写句柄（以 append 模式打开）。
    ///
    /// ⚠️ 刻意不用 `BufWriter`：活跃日志段同时被 append 写和按 offset 随机读，
    /// 一旦加了用户态缓冲，"刚写完马上读"就会读到文件里的旧内容（甚至 EOF）。
    /// 写入合并交给 OS page cache，`write(2)` 本身已经足够快。
    /// 详细讨论见 `stage6_compact::SegmentEngine::active_writer` 的注释。
    writer: File,
    /// 当前日志写入位置（字节）。
    write_pos: u64,
    /// 已废弃（被覆盖/删除）但还占着磁盘的字节数。
    dead_bytes: u64,
    /// 目录锁文件句柄。用 `Option` 是为了在 `Drop` 里先关闭再删除
    /// （Windows 不允许删除仍被打开的文件）。
    lock: Option<File>,
}

impl WalEngine {
    /// 打开（或创建）一个数据目录。
    ///
    /// 注意这里用 `Result` 而不是抛异常；而且**没有** `throws` 声明——
    /// 因为 Rust 的签名里已经写明了一切。
    pub fn open(dir: impl AsRef<Path>) -> Result<Self> {
        let dir = dir.as_ref().to_path_buf();
        fs::create_dir_all(&dir)?;

        // 简易目录锁：create_new 在文件已存在时失败（原子操作，≈ Java 的 createFile）。
        // 生产环境请用 `fs2::FileExt::try_lock_exclusive` 或 `file-lock` crate，
        // 因为 O_EXCL 在进程崩溃后不会自动释放。
        let lock = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dir.join("LOCK"))
            .map_err(|e| {
                if e.kind() == io::ErrorKind::AlreadyExists {
                    KvError::Protocol(format!("数据目录已被占用: {}", dir.display()))
                } else {
                    KvError::Io(e)
                }
            })?;

        let log_path = dir.join("000000001.log");
        let exists = log_path.exists();
        // 用 append 模式打开写句柄：所有 write 都原子追加到末尾，
        // 即使多个进程写同一文件（配合 O_APPEND 的原子性）也不会互相覆盖。
        // 同一个句柄也用来做随机读——读走位置读取（read_at），不动文件游标，
        // 所以读写互不干扰，也不需要额外的读句柄。
        let writer = OpenOptions::new().create(true).read(true).append(true).open(&log_path)?;

        let mut engine = Self {
            dir,
            index: HashMap::new(),
            writer,
            write_pos: 0,
            dead_bytes: 0,
            lock: Some(lock),
        };

        if exists {
            // 重启恢复：重放日志重建索引（阶段 6 会加入损坏检测与截断）
            engine.replay()?;
        }
        Ok(engine)
    }

    /// 重放日志，重建内存索引。
    ///
    /// 这是 crash recovery 的核心：**索引不落盘，靠重放日志重建**。
    /// 索引落盘反而更慢（随机写），重放是纯顺序读，非常快。
    fn replay(&mut self) -> Result<()> {
        // 重放用独立的写模式句柄：既要顺序读，又可能需要截断坏尾巴。
        let file = OpenOptions::new().read(true).write(true).open(self.dir.join("000000001.log"))?;
        let mut pos = 0u64;
        let len = file.metadata()?.len();

        while pos < len {
            match read_frame_at(&file, pos) {
                Ok(Frame { key, value, consumed }) => {
                    if value.is_some() {
                        if let Some(old) = self.index.insert(key, IndexEntry { offset: pos, len: consumed }) {
                            self.dead_bytes += old.len;
                        }
                    } else {
                        if let Some(old) = self.index.remove(&key) {
                            self.dead_bytes += old.len;
                        }
                        self.dead_bytes += consumed;
                    }
                    pos += consumed;
                }
                // 读到不完整的尾部（断电写了一半）：截断到最后一个完整帧。
                // 真实引擎在这里还要校验 CRC，我们已经在 read_frame_at 内部做了。
                Err(KvError::Corrupted { .. }) => {
                    log::warn!("WAL 尾部损坏，截断到 offset {pos}");
                    file.set_len(pos)?;
                    break;
                }
                Err(e) => return Err(e),
            }
        }
        self.write_pos = pos;
        Ok(())
    }

    /// 追加一条记录到日志末尾，返回写入位置。
    fn append(&mut self, key: &str, value: Option<&[u8]>) -> Result<u64> {
        let frame = encode_frame(key, value);
        let offset = self.write_pos;
        // 一次write(2)写完一帧（进入 OS page cache），随后立刻可读。
        // append 模式保证并发追加的原子性，不需要我们自己加锁。
        self.writer.write_all(&frame)?;
        self.write_pos += frame.len() as u64;
        Ok(offset)
    }

    /// 落盘（fsync）。
    ///
    /// durability 三档，Java 开发者要特别注意：
    ///  1. 什么都不做：数据在 OS page cache 里，进程崩溃不丢，**机器断电丢**
    ///  2. `sync_data()`：刷数据不刷元数据
    ///  3. `sync_all()`：fsync，连 inode 元数据一起落盘，机器断电也不丢，通常 ~0.1~1ms
    ///
    ///  ≈ Java 的 `FileChannel.force(true)`。生产引擎默认走第 1 档（性能），
    ///  提供 `sync` 命令让调用方按需升级到第 3 档。
    pub fn sync(&mut self) -> Result<()> {
        self.writer.sync_all()?;
        Ok(())
    }

    /// 显式关闭：消费 `self`，返回 `Result`。
    ///
    /// **为什么不用 `Drop` 就够了？** 因为 `drop(&mut self)` 不能返回错误——
    /// 如果 fsync 失败了，你没有任何办法通知调用方，数据就静默丢了。
    /// 所以 Rust 的惯用法是：
    /// - `Drop` 负责"尽力而为"的清理（关句柄，不能报错）
    /// - `close(self)` 消费所有权，负责"必须成功"的收尾（flush + fsync）
    /// - 因为 `self` 被消费，编译器保证**关闭后无法再使用**——
    ///   比 Java 的 `IllegalStateException("connection closed")` 运行期检查强得多。
    pub fn close(self) -> Result<()> {
        self.writer.sync_all()?;
        drop(self); // 触发 Drop；即使上面返回 Err，析构仍会发生
        Ok(())
    }

    /// 调试用：把二进制 WAL 转成人类可读的 JSON 文本。
    ///
    /// 这里用 `serde_json` —— **热路径不用它，调试路径随便用**。
    /// 这是 Rust 项目里 serde 最常见的定位（≈ Java 里只在 DEBUG 日志里开 Jackson）。
    pub fn dump(&self) -> Result<String> {
        let file = &self.writer;
        let mut pos = 0u64;
        let len = file.metadata()?.len();
        let mut lines = Vec::new();

        while pos < len {
            match read_frame_at(file, pos) {
                Ok(f) => {
                    pos += f.consumed;
                    let json = serde_json::json!({
                        "offset": pos,
                        "key": f.key,
                        "op": if f.value.is_some() { "set" } else { "del" },
                        "bytes": f.consumed,
                    });
                    lines.push(json);
                }
                Err(_) => break,
            }
        }
        serde_json::to_string_pretty(&lines).map_err(Into::into)
    }

    /// 当前可回收的垃圾字节数。
    #[must_use]
    pub const fn dead_bytes(&self) -> u64 {
        self.dead_bytes
    }
}

// ---------------------------------------------------------------------------
// Drop：RAII 的另一半。
// Java 的 try-with-resources 是**语法糖 + 约定**（你也可能忘写）；
// Rust 的 Drop 是**类型系统的一部分**：值离开作用域必定调用，没有任何例外，
// 连 panic 展开时都会执行。所以文件句柄、锁、socket 不可能泄漏。
// ---------------------------------------------------------------------------
impl Drop for WalEngine {
    fn drop(&mut self) {
        // 只能尽力而为：忽略错误（Drop 不能返回 Result）。
        // 已经 write(2) 进内核的数据不会因为进程退出而丢失，这里只是补一次 fsync。
        if let Err(e) = self.writer.sync_all() {
            log::error!("WAL sync 失败（Drop 中）: {e}");
        }
        drop(self.lock.take()); // 先关句柄，再删文件（Windows 要求）
        let _ = fs::remove_file(self.dir.join("LOCK"));
    }
}

impl KvStore for WalEngine {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let Some(entry) = self.index.get(key) else {
            return Ok(None);
        };
        // 位置读取（`read_frame_at` 内部用 `read_at`/`seek_read`）：
        // 不修改文件游标，也不需要 clone 句柄，天然支持并发。
        let frame = read_frame_at(&self.writer, entry.offset)?;
        Ok(frame.value)
    }

    fn set(&mut self, key: &str, value: Vec<u8>) -> Result<()> {
        let offset = self.append(key, Some(&value))?;
        let new_len = frame_len(key.len(), Some(value.len()));
        if let Some(old) = self.index.insert(key.to_owned(), IndexEntry { offset, len: new_len }) {
            // 旧记录成了垃圾，等 compaction 回收
            self.dead_bytes += old.len;
        }
        Ok(())
    }

    fn delete(&mut self, key: &str) -> Result<Option<Vec<u8>>> {
        let Some(entry) = self.index.remove(key) else {
            return Ok(None);
        };
        // 写墓碑：删除也是一次 append，不修改已有数据
        self.append(key, None)?;
        self.dead_bytes += entry.len + frame_len(key.len(), None);

        // 为了返回被删的旧值，需要把它读出来（一次额外 IO）。
        // 真实引擎通常不让 DEL 返回旧值，就是为了避免这次读放大。
        let frame = read_frame_at(&self.writer, entry.offset)?;
        Ok(frame.value)
    }

    fn keys(&self, prefix: &str) -> Result<Vec<String>> {
        let mut out: Vec<String> = self.index.keys().filter(|k| k.starts_with(prefix)).cloned().collect();
        out.sort(); // HashMap 迭代顺序不确定，排序保证测试可重复
        Ok(out)
    }

    /// 单段版本没有合并逻辑，返回 0（阶段 6 实现真正的 compaction）。
    fn compact(&mut self) -> Result<u64> {
        Ok(0)
    }
}

// ---------------------------------------------------------------------------
// 二进制帧编解码
//
// 帧格式（小端）：
//   ┌─────────┬──────────┬──────────┬────────┬──────────┬─────────┐
//   │ magic 4 │ key_len 4│ val_len 4│  key   │  value   │ crc32 4 │
//   └─────────┴──────────┴──────────┴────────┴──────────┴─────────┘
//   val_len == u32::MAX 表示墓碑（删除）
// ---------------------------------------------------------------------------

/// 一帧解码后的内容。
///
/// 字段标 `pub(crate)` 而不是 `pub`：帧格式是**内部实现细节**，
/// 不应该出现在这个 crate 的公开 API 里，但同 crate 的其它模块（stage6）需要访问。
/// ≈ Java 里把类的可见性限制在 package-private。
pub(crate) struct Frame {
    pub(crate) key: String,
    pub(crate) value: Option<Vec<u8>>,
    /// 该帧占用的总字节数（含头尾）。
    pub(crate) consumed: u64,
}

/// 计算一帧的总长度。
pub(crate) const fn frame_len(key_len: usize, value: Option<usize>) -> u64 {
    let v = match value {
        Some(n) => n as u64,
        None => 0,
    };
    (HEADER_LEN + FOOTER_LEN) as u64 + key_len as u64 + v
}

/// 编码一帧（含 CRC32 校验和）。
pub(crate) fn encode_frame(key: &str, value: Option<&[u8]>) -> Vec<u8> {
    // 用 try_from + expect 而不是 `as`：32 位平台上 `usize as u32` 会静默截断，
    // 把一个超长 key 变成"看起来合法"的小数字，写下去就是数据损坏。
    // 这是 Rust 与 Java 的重要差异——Java 的 `(int) longValue` 截断也是静默的。
    let key_len = u32::try_from(key.len()).expect("key 长度超过 4 GiB");
    let val_len = value
        .map_or(TOMBSTONE, |v| u32::try_from(v.len()).expect("value 长度超过 4 GiB"));

    let cap = (HEADER_LEN + FOOTER_LEN) + key.len() + value.map_or(0, <[u8]>::len);

    let mut buf = Vec::with_capacity(cap); // 预分配 ≈ new ArrayList<>(cap)，避免多次扩容
    buf.extend_from_slice(&MAGIC);
    buf.extend_from_slice(&key_len.to_le_bytes());
    buf.extend_from_slice(&val_len.to_le_bytes());
    buf.extend_from_slice(key.as_bytes());
    if let Some(v) = value {
        buf.extend_from_slice(v);
    }
    let crc = crc32(&buf);
    buf.extend_from_slice(&crc.to_le_bytes());
    buf
}

/// 从 `File` 的指定偏移读满缓冲区，返回一个 explicit 的字节缓冲区。
///
/// ## 为什么必须有这个函数
///
/// `File::try_clone()` **不是**给你一个独立游标的句柄——
/// 它底层是 `dup(2)` / `DuplicateHandle`，新旧句柄**共享同一个文件偏移量**。
/// 所以"每个线程 clone 一份句柄然后各自 seek"在并发下会互相踩,
/// 表现出来就是随机出现「魔数不匹配」「校验和不匹配」这种看似玄学的错误。
///
/// 正确做法是用**位置读取**（positional read）：
/// 一次性传入 offset，不修改文件游标，因此可以安全地并发调用。
/// Java 里对应的是 `FileChannel.read(ByteBuffer, position)`——同样不加锁也安全。
///
/// 这里用 `#[cfg]` 做平台分发，这也是 Rust 处理条件编译的标准方式。
/// （Java 里通常要靠运行时 `OsUtils.isWindows()` 判断 + 接口抽象。）
pub(crate) fn read_exact_at(file: &File, buf: &mut [u8], offset: u64) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileExt;
        read_loop(|b, off| file.read_at(b, off), buf, offset)
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        read_loop(|b, off| file.seek_read(b, off), buf, offset)
    }

    #[cfg(not(any(unix, windows)))]
    {
        // 兜底：退化成 seek + read（不能并发，仅保证能编译通过）
        use std::io::{Read, Seek, SeekFrom};
        let mut f = file;
        f.seek(SeekFrom::Start(offset))?;
        f.read_exact(buf)
    }
}

/// 位置读取可能一次读不满，需要循环补齐（和 `Read::read_exact` 同样的语义）。
#[allow(unused_variables)]
fn read_loop<F>(read_at: F, buf: &mut [u8], offset: u64) -> io::Result<()>
where
    F: Fn(&mut [u8], u64) -> io::Result<usize>,
{
    let mut filled = 0usize;
    while filled < buf.len() {
        let n = read_at(&mut buf[filled..], offset + filled as u64)?;
        if n == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "读取到文件末尾"));
        }
        filled += n;
    }
    Ok(())
}

/// 从文件的指定偏移读取一帧。
///
/// 注意参数是 `&File` 而不是 `&mut File`：位置读取不修改文件游标，
/// 所以**不可变借用就够**了——这意味着多个读操作可以并发进行，
/// 连 `RwLock` 的读锁都不需要。这是 Rust 类型系统直接带给并发的好处。
pub(crate) fn read_frame_at(file: &File, offset: u64) -> Result<Frame> {
    let mut header = [0u8; HEADER_LEN];
    match read_exact_at(file, &mut header, offset) {
        Ok(()) => {}
        // 文件末尾 / 读到一半 → 视为损坏（调用方会截断）
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => {
            return Err(KvError::Corrupted { reason: "头部不完整".into(), truncated_at: offset });
        }
        Err(e) => return Err(e.into()),
    }

    if header[..4] != MAGIC {
        return Err(KvError::Corrupted { reason: "魔数不匹配".into(), truncated_at: offset });
    }
    let key_len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    let val_len = u32::from_le_bytes([header[8], header[9], header[10], header[11]]);

    // 防御性检查：MAX_RECORD 防止损坏的长度字段让你直接 `vec![0; 4GB]`。
    // 读不可信数据（磁盘上的字节）时必须有这道闸——这是 C/C++ 时代
    // 无数缓冲区溢出漏洞的根因，Rust 在类型层面已经拦掉了大部分，但这个边界要自己守。
    let value_bytes = if val_len == TOMBSTONE {
        None
    } else {
        let n = usize::try_from(val_len).unwrap_or(usize::MAX);
        if n > MAX_RECORD {
            return Err(KvError::Corrupted {
                reason: format!("记录长度异常: {n}"),
                truncated_at: offset,
            });
        }
        Some(n)
    };
    if key_len > MAX_RECORD {
        return Err(KvError::Corrupted { reason: "key 长度异常".into(), truncated_at: offset });
    }

    // 后面的读取都靠"基址 + 偏移"定位，不再依赖文件游标。
    // 每个字段的位置由帧格式推导，因此可以任意顺序、任意并发地读。
    let mut cursor = offset + HEADER_LEN as u64;

    let mut key_buf = vec![0u8; key_len];
    read_exact_at(file, &mut key_buf, cursor).map_err(|_| KvError::Corrupted {
        reason: "key 不完整".into(),
        truncated_at: offset,
    })?;
    cursor += key_len as u64;

    let value = match value_bytes {
        Some(n) => {
            let mut v = vec![0u8; n];
            read_exact_at(file, &mut v, cursor).map_err(|_| KvError::Corrupted {
                reason: "value 不完整".into(),
                truncated_at: offset,
            })?;
            cursor += n as u64;
            Some(v)
        }
        None => None,
    };

    let mut crc_buf = [0u8; FOOTER_LEN];
    read_exact_at(file, &mut crc_buf, cursor).map_err(|_| KvError::Corrupted {
        reason: "校验和不完整".into(),
        truncated_at: offset,
    })?;

    // 校验和覆盖 header + key + value
    let mut check = Vec::with_capacity(HEADER_LEN + key_len + value_bytes.unwrap_or(0));
    check.extend_from_slice(&header);
    check.extend_from_slice(&key_buf);
    if let Some(v) = &value {
        check.extend_from_slice(v);
    }
    let expected = u32::from_le_bytes(crc_buf);
    if crc32(&check) != expected {
        return Err(KvError::Corrupted { reason: "校验和不匹配".into(), truncated_at: offset });
    }

    let key = String::from_utf8(key_buf)
        .map_err(|_| KvError::Corrupted { reason: "key 不是合法 UTF-8".into(), truncated_at: offset })?;

    Ok(Frame { key, value, consumed: frame_len(key_len, value_bytes) })
}

/// CRC32 校验和（IEEE 802.3 多项式）。
///
/// 表在**编译期**用 const fn 生成，运行期零成本——
/// 这是 Rust 的拿手好戏，Java 里只能写成 static 初始化块或硬编码数组。
const fn build_crc_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    // 循环变量直接用 u32：避免 `as` 转换，也就没有 64 位平台上的截断风险
    let mut i = 0u32;
    while i < 256 {
        let mut c = i;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            k += 1;
        }
        table[i as usize] = c;
        i += 1;
    }
    table
}

static CRC_TABLE: [u32; 256] = build_crc_table();

/// 计算字节切片的 CRC32。
fn crc32(data: &[u8]) -> u32 {
    let mut c = 0xFFFF_FFFFu32;
    for &b in data {
        c = CRC_TABLE[((c ^ u32::from(b)) & 0xFF) as usize] ^ (c >> 8);
    }
    c ^ 0xFFFF_FFFF
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 位置读取需要真实的 `File`（内存 Cursor 没有 `read_at` 语义），
    /// 所以测试统一用临时文件。
    fn temp_file_with(data: &[u8]) -> tempfile::NamedTempFile {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(data).unwrap();
        f.flush().unwrap();
        f
    }

    #[test]
    fn frame_roundtrip() {
        let f = encode_frame("k", Some(b"v"));
        let file = temp_file_with(&f);
        let decoded = read_frame_at(file.as_file(), 0).unwrap();
        assert_eq!(decoded.key, "k");
        assert_eq!(decoded.value, Some(b"v".to_vec()));
        assert_eq!(usize::try_from(decoded.consumed).unwrap(), f.len());
    }

    #[test]
    fn read_frame_at_offset_skips_previous_records() {
        // 连续写两帧，用 offset 直接定位到第二帧——
        // 这正是 Bitcask 索引随机读的工作方式
        let first = encode_frame("a", Some(b"1111"));
        let second = encode_frame("b", Some(b"22"));
        let mut all = first.clone();
        all.extend_from_slice(&second);
        let file = temp_file_with(&all);

        let f2 = read_frame_at(file.as_file(), first.len() as u64).unwrap();
        assert_eq!(f2.key, "b");
        assert_eq!(f2.value, Some(b"22".to_vec()));
    }

    /// 位置读取不修改文件游标：同一个 File 句柄连续读两次，
    /// 结果必须一致（这是并发读安全的前提）。
    #[test]
    fn positional_read_is_idempotent() {
        let f = encode_frame("k", Some(b"v"));
        let file = temp_file_with(&f);
        for _ in 0..3 {
            assert_eq!(read_frame_at(file.as_file(), 0).unwrap().key, "k");
        }
    }

    #[test]
    fn tombstone_frame() {
        let f = encode_frame("k", None);
        let file = temp_file_with(&f);
        let decoded = read_frame_at(file.as_file(), 0).unwrap();
        assert_eq!(decoded.value, None);
    }

    #[test]
    fn corrupted_frame_is_detected() {
        let mut f = encode_frame("k", Some(b"v"));
        let last = f.len() - 1;
        f[last] ^= 0xFF; // 破坏 CRC
        let file = temp_file_with(&f);
        assert!(matches!(read_frame_at(file.as_file(), 0), Err(KvError::Corrupted { .. })));
    }

    #[test]
    fn truncated_tail_is_detected() {
        let mut f = encode_frame("k", Some(b"v"));
        f.truncate(f.len() - 3); // 模拟写了一半断电
        let file = temp_file_with(&f);
        assert!(matches!(read_frame_at(file.as_file(), 0), Err(KvError::Corrupted { .. })));
    }
}
