# -*- coding: utf-8 -*-
"""Cassandra 轨道批量校验脚本。

校验项：
1. track.json 与 15 个 md 文件一一对应，H1 与 page title 一字不差
2. 所有 md 内相对链接目标存在
3. 所有 `文件:行号` 引用：文件存在（cassandra 仓库 / rocksdb 仓库 / learning-hub 文档）、行号不越界
4. SVG 是合法 XML、viewBox 宽 1000、无未转义实体
5. 实验室 HTML：存在、JS 语法可解析（node --check 不可用则用简单配对检查）、labbar 接线、章节序号
6. 每篇行数 255~275
用法：python tools/check_cassandra.py（在 learning-hub 仓库根跑）
"""
import json, re, sys, io, os
from pathlib import Path
import xml.etree.ElementTree as ET

HUB = Path(r"D:\code\learning-hub")
CASS = Path(r"D:\code\github\cassandra")
ROCKS = Path(r"D:\code\github\rocksDB")
TRACK = HUB / "tracks" / "cassandra"
LAB = HUB / "site" / "public" / "cassandra-lab"

errors, warns, notes = [], [], []

def err(msg): errors.append(msg)
def warn(msg): warns.append(msg)

track = json.loads((TRACK / "track.json").read_text(encoding="utf-8"))

# ---------- 1. 页面清单与 H1 ----------
pages = []
for sec in track["sections"]:
    base = TRACK / sec["path"]
    for p in sec["pages"]:
        f = base / p["file"]
        pages.append((sec, p, f))
        if not f.exists():
            err(f"缺正文: {f}")
print(f"[1] track.json 声明 {len(pages)} 页")

md_h1_ok = 0
for sec, p, f in pages:
    if not f.exists():
        continue
    text = f.read_text(encoding="utf-8")
    lines = text.splitlines()
    if len(lines) < 255 or len(lines) > 275:
        warn(f"{f.name} 行数 {len(lines)} 不在 255~275")
    m = re.match(r"^# (.+)$", lines[0]) if lines else None
    if not m or m.group(1).strip() != p["title"]:
        err(f"{f.name} H1 与 track.json 不一致: {lines[0] if lines else '(空)'} != {p['title']}")
    else:
        md_h1_ok += 1
print(f"[1] H1 一致 {md_h1_ok}/{len(pages)}")

# ---------- 2. 相对链接 ----------
link_re = re.compile(r"\]\((\.\./[^)#]+?\.md)(#[^)]*)?\)")
for sec, p, f in pages:
    if not f.exists():
        continue
    for target in link_re.findall(f.read_text(encoding="utf-8")):
        t = (f.parent / target[0]).resolve()
        if not t.exists():
            err(f"{f.name} 链接目标不存在: {target[0]}")
print("[2] 相对链接检查完成")

# ---------- 3. 源码引用 ----------
ref_re = re.compile(r"`((?:[\w./-]+\.(?:java|yaml|md|adoc|txt|properties))(?::\d+(?:-\d+)?)(?:[、,，]\s*\d+(?:-\d+)?)*)`")
plain_ref_re = re.compile(r"`((?:src/java/org/)?[\w-]+/[\w/.-]+\.(?:java|yaml|adoc))`")

def resolve_repo(rel):
    """返回 (绝对路径或 None, 所属仓库标签)"""
    rel = rel.replace("\\", "/")
    cand = [
        (CASS / "src/java/org/apache/cassandra" / rel, "cassandra"),
        (CASS / rel, "cassandra-root"),
        (ROCKS / rel, "rocksdb"),
        (HUB / "tracks" / rel, "hub"),
    ]
    for path, label in cand:
        if path.exists():
            return path, label
    return None, None

def get_lines(path):
    try:
        return len(path.read_text(encoding="utf-8", errors="replace").splitlines())
    except OSError:
        return 0

checked, bad = set(), []
for sec, p, f in pages:
    if not f.exists():
        continue
    text = f.read_text(encoding="utf-8")
    for m in ref_re.finditer(text):
        whole = m.group(0)
        fname = m.group(1)
        # 行号列表（文件名后第一个 :d 或 :d-d 起）
        body = whole[1:-1]
        filepart, _, numspart = body.partition(":")
        nums = [int(x) for x in re.findall(r"\d+", numspart)]
        key = (filepart, tuple(nums))
        if key in checked:
            continue
        checked.add(key)
        path, label = resolve_repo(filepart)
        if path is None:
            err(f"{f.name} 引用文件不存在: {filepart}")
            continue
        n = get_lines(path)
        for v in nums:
            if v > n:
                err(f"{f.name} 行号越界: {filepart}:{v} (文件共 {n} 行, {label})")
print(f"[3] 引用检查：唯一引用 {len(checked)} 条")

# ---------- 4. SVG ----------
svg_files = sorted((TRACK / "assets").glob("*.svg"))
if len(svg_files) != 15:
    warn(f"SVG 数量 {len(svg_files)} != 15")
for f in svg_files:
    try:
        root = ET.parse(str(f)).getroot()
        vb = root.get("viewBox", "")
        if not vb.startswith("0 0 1000 "):
            warn(f"{f.name} viewBox 异常: {vb}")
    except ET.ParseError as e:
        err(f"{f.name} XML 解析失败: {e}")
print(f"[4] SVG {len(svg_files)} 张")

# ---------- 5. 实验室 HTML ----------
lab_chapters = []
expect = []
for sec, p in [(s, p) for s in track["sections"] for p in s["pages"]]:
    expect.append(p["slug"])
lab_files = sorted(LAB.glob("*.html")) if LAB.exists() else []
for f in lab_files:
    html = f.read_text(encoding="utf-8")
    if "lnkBack" not in html or "cassandra-lab" not in html:
        warn(f"{f.name} labbar 接线缺失")
    m = re.search(r"第 (\d+) / 15 章", html)
    if not m:
        warn(f"{f.name} 章节序号缺失")
    # 基本配对检查
    for tag in ["svg", "section", "script"]:
        if html.count(f"<{tag}") != html.count(f"</{tag}>"):
            err(f"{f.name} <{tag}> 标签不配对: {html.count('<'+tag)} vs {html.count('</'+tag)}> ")
    if "requestAnimationFrame" in html and html.count("requestAnimationFrame") > 2:
        warn(f"{f.name} requestAnimationFrame 出现 {html.count('requestAnimationFrame')} 次")
if len(lab_files) != 15:
    warn(f"实验室 HTML 数量 {len(lab_files)} != 15")
print(f"[5] 实验室 HTML {len(lab_files)} 个")

# ---------- 汇总 ----------
print("\n===== 结果 =====")
print(f"错误 {len(errors)} 条")
for e in errors:
    print("  [ERR]", e)
print(f"警告 {len(warns)} 条")
for w in warns:
    print("  [WARN]", w)
sys.exit(1 if errors else 0)
