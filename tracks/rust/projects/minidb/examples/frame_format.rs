//! # 帧格式与 CRC 的逐字节演示
//!
//! 配套 `02-文件格式与落盘.md`。这里**重新实现**了一遍与 `src/stage5_wal.rs`
//! 完全相同的帧格式（库里的 `encode_frame` 是 `pub(crate)`，示例拿不到），
//! 目的就是让你能亲眼看到每一字节。
//!
//! 运行：
//!
//! ```bash
//! cargo run --example frame_format
//! ```

const MAGIC: [u8; 4] = *b"MDB1";
const HEADER_LEN: usize = 12;
const FOOTER_LEN: usize = 4;
const MAX_RECORD: usize = 64 << 20;
const TOMBSTONE: u32 = u32::MAX;

/// 编码一帧：[magic | key_len | val_len | key | value | crc32]
fn encode_frame(key: &str, value: Option<&[u8]>) -> Vec<u8> {
    let key_len = u32::try_from(key.len()).expect("key 长度超过 4 GiB");
    let val_len = value.map_or(TOMBSTONE, |v| u32::try_from(v.len()).expect("value 长度超过 4 GiB"));

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

/// 解码一帧；任何一步不对都返回可读的错误原因。
///
/// 注意**每一步都先检查长度再切片** —— 帧来自磁盘，是彻底不可信的输入。
/// 少一次检查，一个残缺的帧就会让切片越界 panic，而不是返回一个可恢复的错误。
fn decode_frame(buf: &[u8]) -> Result<(String, Option<Vec<u8>>, usize), String> {
    // 取 buf[cursor..cursor+n]；不够就报错而不是 panic
    let slice = |cursor: usize, n: usize| -> Result<&[u8], String> {
        buf.get(cursor..cursor + n)
            .ok_or_else(|| format!("长度不足：需要 {n} 字节 @ offset {cursor}，实际只有 {} 字节", buf.len()))
    };

    let header = slice(0, HEADER_LEN)?;
    if header[..4] != MAGIC {
        return Err(format!("魔数不匹配：{:02x?}", &header[..4]));
    }
    let key_len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    let val_len = u32::from_le_bytes([header[8], header[9], header[10], header[11]]);

    // 读不可信数据时的闸门：没有它，一个损坏的长度字段会让你 vec![0; 4GB]
    if key_len > MAX_RECORD {
        return Err(format!("key 长度异常：{key_len}"));
    }
    let value_bytes = if val_len == TOMBSTONE {
        None
    } else {
        let n = val_len as usize;
        if n > MAX_RECORD {
            return Err(format!("记录长度异常：{n}"));
        }
        Some(n)
    };

    let mut cursor = HEADER_LEN;
    let key = String::from_utf8(slice(cursor, key_len)?.to_vec())
        .map_err(|_| "key 不是合法 UTF-8".to_owned())?;
    cursor += key_len;

    let value = value_bytes.map(|n| slice(cursor, n).map(<[u8]>::to_vec)).transpose()?;
    cursor += value_bytes.unwrap_or(0);

    // 校验和覆盖 header + key + value
    let crc_bytes = slice(cursor, FOOTER_LEN)?;
    let expected = u32::from_le_bytes([crc_bytes[0], crc_bytes[1], crc_bytes[2], crc_bytes[3]]);
    if crc32(&buf[..cursor]) != expected {
        return Err("校验和不匹配".to_owned());
    }
    Ok((key, value, cursor + FOOTER_LEN))
}

fn crc32(data: &[u8]) -> u32 {
    let mut c = 0xFFFF_FFFFu32;
    for &b in data {
        c = CRC_TABLE[((c ^ u32::from(b)) & 0xFF) as usize] ^ (c >> 8);
    }
    c ^ 0xFFFF_FFFF
}

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

/// 按 16 字节一行打印十六进制 + ASCII。
fn hexdump(bytes: &[u8]) {
    for (i, chunk) in bytes.chunks(16).enumerate() {
        let hex: Vec<String> = chunk.iter().map(|b| format!("{b:02x}")).collect();
        let ascii: String = chunk
            .iter()
            .map(|&b| if b.is_ascii_graphic() { b as char } else { '.' })
            .collect();
        println!("  {:08x}  {:<47}  |{}|", i * 16, hex.join(" "), ascii);
    }
}

fn main() {
    // ---- 1. 一条普通记录 -------------------------------------------------
    println!("=== 1. 编码一条记录 ===");
    let frame = encode_frame("name", Some(b"minidb"));
    println!("key = \"name\", value = \"minidb\"");
    println!("帧长度 = {} 字节", frame.len());
    hexdump(&frame);
    println!("逐字段：");
    println!("  magic   = {:02x?}  (\"{}\")", &frame[0..4], String::from_utf8_lossy(&frame[0..4]));
    println!(
        "  key_len = {:02x?}  (= {})",
        &frame[4..8],
        u32::from_le_bytes([frame[4], frame[5], frame[6], frame[7]])
    );
    println!(
        "  val_len = {:02x?}  (= {})",
        &frame[8..12],
        u32::from_le_bytes([frame[8], frame[9], frame[10], frame[11]])
    );
    println!("  key     = {:02x?}  (\"name\")", &frame[12..16]);
    println!("  value   = {:02x?}  (\"minidb\")", &frame[16..22]);
    println!("  crc32   = {:02x?}", &frame[22..26]);

    let (k, v, consumed) = decode_frame(&frame).expect("自己编的帧应该能解出来");
    println!("解码回来：key={k}, value={:?}, consumed={consumed}", v.as_deref().map(String::from_utf8_lossy));
    assert_eq!(k, "name");
    assert_eq!(v.as_deref(), Some(b"minidb".as_slice()));
    assert_eq!(consumed, frame.len());

    // ---- 2. 墓碑 ---------------------------------------------------------
    println!("\n=== 2. 墓碑（删除标记）===");
    let tomb = encode_frame("name", None);
    println!("val_len = {:02x?}  (= u32::MAX = 墓碑)", &tomb[8..12]);
    println!("帧长度 = {} 字节（比上面少 {} 字节的 value）", tomb.len(), frame.len() - tomb.len());
    hexdump(&tomb);
    let (k, v, _) = decode_frame(&tomb).expect("墓碑也要能解出来");
    assert_eq!(k, "name");
    assert!(v.is_none(), "墓碑解码后 value 必须是 None");

    // ---- 3. 篡改一个字节 -------------------------------------------------
    println!("\n=== 3. 篡改 value 的一个字节 ===");
    let mut broken = frame.clone();
    broken[16] ^= 0xFF; // 把 'm' 改掉
    println!("原字节 {:02x} → 现字节 {:02x}", frame[16], broken[16]);
    match decode_frame(&broken) {
        Ok(_) => println!("  ⚠️ 居然解出来了（不应该）"),
        Err(e) => println!("  ✅ 被检出：{e}"),
    }
    assert!(decode_frame(&broken).is_err(), "篡改必须被 CRC 检出");

    // ---- 4. 半包 ---------------------------------------------------------
    println!("\n=== 4. 模拟断电：砍掉尾部 3 个字节 ===");
    let truncated = &frame[..frame.len() - 3];
    match decode_frame(truncated) {
        Ok(_) => println!("  ⚠️ 居然解出来了（不应该）"),
        Err(e) => println!("  ✅ 被检出：{e}"),
    }
    assert!(decode_frame(truncated).is_err());

    // ---- 5. 空 value 与墓碑的区别 ----------------------------------------
    println!("\n=== 5. 空 value ≠ 墓碑 ===");
    let empty = encode_frame("k", Some(b""));
    println!("空 value：val_len = {:02x?}  (= 0)", &empty[8..12]);
    println!("墓碑    ：val_len = {:02x?}  (= u32::MAX)", &encode_frame("k", None)[8..12]);
    assert_eq!(decode_frame(&empty).unwrap().1, Some(vec![]), "空 value 是 Some(空)");
    assert_eq!(decode_frame(&encode_frame("k", None)).unwrap().1, None, "墓碑是 None");

    println!("\n全部断言通过 ✓");
    println!("提示：真实数据文件可以用 `xxd <dir>/000000001.log` 看到同样的布局");
}
