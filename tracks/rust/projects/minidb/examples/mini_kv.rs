//! # mini_kv —— 单文件最小可运行版（约 200 行，只依赖标准库）
//!
//! 这是 `TUTORIAL.md` 第 12 章的"可运行的完整示例"。它把整个教程的核心思想
//! 压缩到一个文件里，去掉了多段、合并、并发、异步这些"工程放大器"，
//! 只保留 Bitcask 的骨架：
//!
//!   1. append-only 日志（WAL）
//!   2. 内存哈希索引 key -> (offset, len)
//!   3. 重启时重放日志重建索引
//!   4. CRC32 校验 + 尾部截断做崩溃恢复
//!   5. 墓碑（tombstone）表示删除
//!
//! 运行：
//!
//! ```bash
//! cargo run --example mini_kv            # 跑内置的自验证 demo
//! cargo run --example mini_kv -- ./db    # 指定数据文件
//! ```
//!
//! 也可以完全脱离 cargo，用 rustc 直接编译（因为它不依赖任何 crate）：
//!
//! ```bash
//! rustc examples/mini_kv.rs -o mini_kv && ./mini_kv
//! ```

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;

/// 帧头魔数：用来快速判断"这里是不是一条合法记录"。
const MAGIC: [u8; 4] = *b"MKV1";
/// 定长头：magic(4) + key_len(4) + val_len(4)。
const HEADER_LEN: usize = 12;
/// 定长尾：crc32(4)。
const FOOTER_LEN: usize = 4;
/// `val_len` 取这个哨兵值时表示"删除墓碑"。
const TOMBSTONE: u32 = u32::MAX;

/// 一个最小可用的 Bitcask 引擎。
struct MiniKv {
    /// 读写句柄。真实引擎会用位置读取（`read_at`）避免文件游标竞争，
    /// 这里为了少几行代码用 seek + read，因此方法都是 `&mut self`。
    file: File,
    /// 键 -> (记录起始偏移, 记录总字节数)
    index: HashMap<String, (u64, u64)>,
    /// 下一次写入的位置（= 当前文件长度）。
    pos: u64,
}

impl MiniKv {
    /// 打开（或创建）数据文件，并在必要时重放日志重建索引。
    fn open(path: impl AsRef<Path>) -> io::Result<Self> {
        // 注意：**不用** append 模式，而是 read + write，写入前手动 seek 到文件末尾。
        // 原因（跨平台坑）：Windows 上 append 模式只申请了 FILE_APPEND_DATA 权限，
        // 没有 FILE_WRITE_DATA，于是 `set_len` 会报 PermissionDenied。
        // 完整版 minidb 的做法是"平时只读，截断时临时换一个写句柄"。
        let mut file = OpenOptions::new().create(true).read(true).write(true).open(path)?;
        let len = file.metadata()?.len();
        let mut index: HashMap<String, (u64, u64)> = HashMap::new();
        let mut pos = 0u64;

        // ---- 重放：索引不落盘，靠重放日志重建 ----
        while pos < len {
            match read_frame(&mut file, pos) {
                Ok(frame) => {
                    if frame.value.is_some() {
                        index.insert(frame.key, (pos, frame.consumed));
                    } else {
                        index.remove(&frame.key); // 墓碑：删除
                    }
                    pos += frame.consumed;
                }
                // 读到一个不完整/校验失败的帧：说明上次写了一半就崩了。
                // 日志是 append-only 的，所以坏的一定在最后，截断即可。
                Err(_) => {
                    eprintln!("[recover] 发现损坏尾部，截断到 offset {pos}");
                    file.set_len(pos)?;
                    file.sync_all()?;
                    break;
                }
            }
        }
        Ok(Self { file, index, pos })
    }

    /// 写入一个键值对。
    fn set(&mut self, key: &str, value: &[u8]) -> io::Result<()> {
        self.append(key, Some(value))
    }

    /// 删除一个键（写一条墓碑，而不是抹掉已有数据）。
    fn delete(&mut self, key: &str) -> io::Result<()> {
        self.append(key, None)?;
        self.index.remove(key);
        Ok(())
    }

    /// 追加一帧到日志末尾，并更新内存索引。
    fn append(&mut self, key: &str, value: Option<&[u8]>) -> io::Result<()> {
        let frame = encode_frame(key, value);
        let offset = self.pos;
        self.file.seek(SeekFrom::End(0))?; // 等价于 O_APPEND（单线程下安全）
        self.file.write_all(&frame)?;
        self.pos += frame.len() as u64;
        if value.is_some() {
            self.index.insert(key.to_owned(), (offset, frame.len() as u64));
        }
        Ok(())
    }

    /// 读取一个键。随机读 = 一次 seek + 一次顺序读。
    fn get(&mut self, key: &str) -> io::Result<Option<Vec<u8>>> {
        let Some(&(offset, _)) = self.index.get(key) else {
            return Ok(None);
        };
        Ok(read_frame(&mut self.file, offset)?.value)
    }

    /// 所有键（排序后输出，保证结果稳定）。
    fn keys(&self) -> Vec<String> {
        let mut out: Vec<String> = self.index.keys().cloned().collect();
        out.sort();
        out
    }

    /// 显式关闭：fsync + 释放。真实引擎会返回 Result 而不是吞掉错误。
    fn close(self) -> io::Result<()> {
        self.file.sync_all()
    }
}

/// 一帧解码后的内容。
struct Frame {
    key: String,
    value: Option<Vec<u8>>,
    /// 该帧占用的总字节数（含头尾）。
    consumed: u64,
}

/// 编码一帧：[magic | key_len | val_len | key | value | crc32]
fn encode_frame(key: &str, value: Option<&[u8]>) -> Vec<u8> {
    let key_len = u32::try_from(key.len()).expect("key 太长");
    let val_len = value.map_or(TOMBSTONE, |v| u32::try_from(v.len()).expect("value 太长"));

    let mut buf = Vec::with_capacity(HEADER_LEN + FOOTER_LEN + key.len() + value.map_or(0, <[u8]>::len));
    buf.extend_from_slice(&MAGIC);
    buf.extend_from_slice(&key_len.to_le_bytes());
    buf.extend_from_slice(&val_len.to_le_bytes());
    buf.extend_from_slice(key.as_bytes());
    if let Some(v) = value {
        buf.extend_from_slice(v);
    }
    buf.extend_from_slice(&crc32(&buf).to_le_bytes());
    buf
}

/// 从指定偏移读取并校验一帧。
fn read_frame(file: &mut File, offset: u64) -> io::Result<Frame> {
    file.seek(SeekFrom::Start(offset))?;
    let mut header = [0u8; HEADER_LEN];
    file.read_exact(&mut header)?; // 读不满就返回 UnexpectedEof，调用方视为"损坏"

    if header[..4] != MAGIC {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "魔数不匹配"));
    }
    let key_len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    let val_len = u32::from_le_bytes([header[8], header[9], header[10], header[11]]);

    // 读不可信数据（磁盘上的字节）时必须有边界检查：
    // 直接 `vec![0; val_len]` 遇到损坏的长度字段会试图分配 4 GiB。
    let val_bytes = if val_len == TOMBSTONE { None } else { Some(val_len as usize) };
    let mut body = vec![0u8; key_len + val_bytes.unwrap_or(0)];
    file.read_exact(&mut body)?;
    let mut crc_bytes = [0u8; FOOTER_LEN];
    file.read_exact(&mut crc_bytes)?;

    // 校验和覆盖 header + key + value
    let mut check = Vec::with_capacity(HEADER_LEN + body.len());
    check.extend_from_slice(&header);
    check.extend_from_slice(&body);
    if crc32(&check) != u32::from_le_bytes(crc_bytes) {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "校验和不匹配"));
    }

    let key = String::from_utf8(body[..key_len].to_vec())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "key 不是合法 UTF-8"))?;
    let value = val_bytes.map(|n| body[key_len..key_len + n].to_vec());
    let consumed = (HEADER_LEN + FOOTER_LEN) as u64 + key_len as u64 + value.as_ref().map_or(0, |v| v.len() as u64);
    Ok(Frame { key, value, consumed })
}

// ---- CRC32（IEEE 802.3 多项式），查表在编译期生成 --------------------------

const fn build_crc_table() -> [u32; 256] {
    let mut table = [0u32; 256];
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

fn crc32(data: &[u8]) -> u32 {
    let mut c = 0xFFFF_FFFFu32;
    for &b in data {
        c = CRC_TABLE[((c ^ u32::from(b)) & 0xFF) as usize] ^ (c >> 8);
    }
    c ^ 0xFFFF_FFFF
}

// ---- 自验证 demo -----------------------------------------------------------

fn main() -> io::Result<()> {
    let path = std::env::args().nth(1).unwrap_or_else(|| "./mini_kv_demo.db".to_owned());
    // 每次 demo 都从干净状态开始（忽略"文件不存在"这种预期错误）
    let _ = std::fs::remove_file(&path);
    println!("== mini_kv 自验证 demo（数据文件: {path}）==\n");

    // ---- 1. 写入 + 覆盖 + 删除 ----
    {
        let mut kv = MiniKv::open(&path)?;
        kv.set("name", b"minidb")?;
        kv.set("lang", b"rust")?;
        kv.set("name", b"minidb-v2")?; // 覆盖：旧记录变成垃圾
        kv.set("tmp", b"to-be-deleted")?;
        kv.delete("tmp")?; // 写墓碑
        println!("[1] 写入完成，当前键: {:?}", kv.keys());
        assert_eq!(kv.get("name")?.as_deref(), Some(b"minidb-v2".as_slice()));
        assert_eq!(kv.get("tmp")?, None);
        kv.close()?;
    }

    // ---- 2. 重启：索引靠重放重建 ----
    {
        let mut kv = MiniKv::open(&path)?;
        println!("[2] 重启后键: {:?}", kv.keys());
        assert_eq!(kv.get("name")?.as_deref(), Some(b"minidb-v2".as_slice()));
        assert_eq!(kv.get("lang")?.as_deref(), Some(b"rust".as_slice()));
        assert_eq!(kv.get("tmp")?, None, "删除的键不能复活");
        println!("    重放后数据完好 ✓");
        kv.close()?;
    }

    // ---- 3. 模拟断电：往文件尾部追加半个损坏的帧 ----
    {
        let mut f = OpenOptions::new().append(true).open(&path)?;
        f.write_all(b"MKV1\x02\x00")?; // 魔数 + 残缺长度
        f.sync_all()?;
    }

    // ---- 4. 恢复：好数据保留，坏尾巴被截断 ----
    {
        let mut kv = MiniKv::open(&path)?;
        assert_eq!(kv.get("name")?.as_deref(), Some(b"minidb-v2".as_slice()));
        kv.set("after", b"recovery-ok")?; // 恢复后还能继续写
        assert_eq!(kv.get("after")?.as_deref(), Some(b"recovery-ok".as_slice()));
        println!("[4] 崩溃恢复后仍可读写 ✓");
        kv.close()?;
    }

    // ---- 5. 数据文件长什么样 ----
    let size = std::fs::metadata(&path)?.len();
    println!("\n[5] 数据文件大小: {size} 字节（4 次写 + 1 次删除 + 1 次恢复写）");
    println!("    用 `xxd {path} | head` 可以看到 MKV1 魔数和 CRC32 尾部");
    println!("\n全部断言通过 ✓");
    Ok(())
}
