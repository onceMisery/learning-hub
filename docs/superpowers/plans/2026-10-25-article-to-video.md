# 文章转视频管线（article-to-video）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `tracks/agent` 的 11 篇教程自动生成为 1080p 讲解视频（mp4 + srt 字幕），管线可复用于其他轨道。

**Architecture:** 口播稿 JSON（逐章人工改写，进 git）→ Playwright 渲染 HTML 模板截图成静帧 → edge-tts 合成旁白并取词级时间轴 → 生成整章 srt → ffmpeg 逐段合成并 concat 成 mp4。产物落在 `dist/videos/`（已被 gitignore）。

**Tech Stack:** Python 3.13（edge-tts 7.2.8 已装、playwright 待装）、Chromium、ffmpeg（待装）、pytest。

**Spec:** `docs/superpowers/specs/2026-10-25-article-to-video-design.md`

**约定：** 所有命令在仓库根 仓库根 下执行；`python` 即 Python 3.13。提交步骤统一推迟到 Task 12（由用户决定是否提交）。

---

### Task 1: 环境准备

**Files:** 无代码文件（仅安装与验证）

- [ ] **Step 1: 安装 ffmpeg**

Run: `winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements`
Expected: `Successfully installed`

- [ ] **Step 2: 新开 shell 验证 ffmpeg（PATH 刷新）**

Run: `ffmpeg -version | head -1`
Expected: `ffmpeg version 7.x ...`（若找不到，重开终端再试；仍失败则用绝对路径 `C:\Users\miracle\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg*\ffmpeg-x-x\bin\ffmpeg.exe` 加入 PATH）

- [ ] **Step 3: 安装 Playwright 与 pytest**

Run: `pip install playwright pytest && playwright install chromium`
Expected: `Successfully installed playwright-x.x.x pytest-x.x.x` 且 Chromium 下载完成

- [ ] **Step 4: 验证 Playwright 可截图**

Run:
```bash
python -c "from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width':1920,'height':1080})
    pg.set_content('<h1>ok</h1>')
    pg.screenshot(path='dist/videos/_probe.png')
    b.close()
print('probe ok')"
```
Expected: `probe ok`，`dist/videos/_probe.png` 存在

---

### Task 2: 口播稿加载与校验（make_video.py 第一部分）

**Files:**
- Create: `tools/video/make_video.py`
- Test: `tools/video/tests/test_narration.py`

- [ ] **Step 1: 写失败测试**

```python
# tools/video/tests/test_narration.py
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from make_video import load_narration, LAYOUTS


def _write(tmp_path, data):
    p = tmp_path / "n.json"
    p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return str(p)


VALID = {
    "track": "agent",
    "chapter": "01",
    "title": "意图识别",
    "voice": "zh-CN-YunxiNeural",
    "slides": [
        {"layout": "cover", "title": "t", "speech": "s"},
        {"layout": "points", "title": "t", "points": ["a"], "speech": "s"},
        {"layout": "outro", "speech": "s"},
    ],
}


def test_valid_passes(tmp_path):
    narr = load_narration(_write(tmp_path, VALID), assets_dir=tmp_path)
    assert narr["chapter"] == "01"
    assert len(narr["slides"]) == 3


def test_bad_layout_and_missing_speech_aggregated(tmp_path):
    bad = json.loads(json.dumps(VALID))
    bad["slides"][0]["layout"] = "nope"
    del bad["slides"][2]["speech"]
    try:
        load_narration(_write(tmp_path, bad), assets_dir=tmp_path)
        raise AssertionError("should fail")
    except ValueError as e:
        msg = str(e)
        assert "nope" in msg and "speech" in msg
        assert msg.count("slide") >= 2  # 两条错误一次报出


def test_diagram_requires_existing_svg(tmp_path):
    bad = json.loads(json.dumps(VALID))
    bad["slides"][1] = {"layout": "diagram", "title": "t", "svg": "缺.svg", "speech": "s"}
    try:
        load_narration(_write(tmp_path, bad), assets_dir=tmp_path)
        raise AssertionError("should fail")
    except ValueError as e:
        assert "缺.svg" in str(e)
```

- [ ] **Step 2: 运行确认失败**

Run: `python -m pytest tools/video/tests/test_narration.py -v`
Expected: FAIL（`No module named 'make_video'`）

- [ ] **Step 3: 实现模块头 + 校验**

```python
# tools/video/make_video.py
"""文章转视频管线：narration.json -> 帧 -> TTS -> srt -> mp4。用法见 README.md。"""
import argparse
import asyncio
import hashlib
import html
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LAYOUTS = ("cover", "points", "diagram", "outro")


def load_narration(json_path: str, assets_dir: Path) -> dict:
    """加载并整体校验口播稿；所有错误一次性聚合报出。"""
    data = json.loads(Path(json_path).read_text(encoding="utf-8"))
    errors = []

    def err(msg):
        errors.append(msg)

    for field in ("track", "chapter", "title", "voice", "slides"):
        if field not in data:
            err(f"缺少顶层字段 {field}")
    if errors:
        raise ValueError("\n".join(errors))

    for i, slide in enumerate(data["slides"], start=1):
        tag = f"slide {i}"
        layout = slide.get("layout")
        if layout not in LAYOUTS:
            err(f"{tag}: layout '{layout}' 非法，可选 {LAYOUTS}")
        if not str(slide.get("speech", "")).strip():
            err(f"{tag}: 缺少 speech")
        if layout == "diagram":
            svg = slide.get("svg", "")
            if not svg:
                err(f"{tag}: diagram 缺少 svg")
            elif not (assets_dir / svg).is_file():
                err(f"{tag}: svg 文件不存在 {assets_dir / svg}")

    if errors:
        raise ValueError("口播稿校验失败：\n" + "\n".join(errors))
    return data


def slide_hash(slide: dict) -> str:
    return hashlib.sha1(
        json.dumps(slide, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:10]
```

- [ ] **Step 4: 运行测试通过**

Run: `python -m pytest tools/video/tests/test_narration.py -v`
Expected: 3 passed

---

### Task 3: HTML 模板（4 版式）

**Files:**
- Create: `tools/video/templates/cover.html`
- Create: `tools/video/templates/points.html`
- Create: `tools/video/templates/diagram.html`
- Create: `tools/video/templates/outro.html`

设计约束：浅色底 `#F8FAFC`（与 SVG 原理图的 Tailwind 配色协调），正文用微软雅黑，accent 色由口播稿轨道决定（agent 为青 `#0891B2`，通过 `{{ACCENT}}` 注入）。统一 1920×1080，四模板共享同一段 base CSS。

- [ ] **Step 1: cover.html**

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1920px; height: 1080px; background: #F8FAFC;
         font-family: "Microsoft YaHei", sans-serif; color: #1E293B;
         display: flex; flex-direction: column; justify-content: center;
         padding: 0 160px; }
  .track { color: {{ACCENT}}; font-size: 40px; font-weight: 600;
           letter-spacing: 8px; margin-bottom: 36px; }
  .no { font-size: 30px; color: #94A3B8; margin-bottom: 20px; }
  h1 { font-size: 92px; font-weight: 800; line-height: 1.25; }
  .sub { font-size: 40px; color: #475569; margin-top: 40px; line-height: 1.6; }
  .rule { width: 160px; height: 8px; background: {{ACCENT}};
          border-radius: 4px; margin-top: 56px; }
</style></head>
<body>
  <div class="track">{{TRACK_TITLE}}</div>
  <div class="no">第 {{CHAPTER_NO}} 章</div>
  <h1>{{TITLE}}</h1>
  <div class="sub">{{SUBTITLE}}</div>
  <div class="rule"></div>
</body></html>
```

- [ ] **Step 2: points.html**

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1920px; height: 1080px; background: #F8FAFC;
         font-family: "Microsoft YaHei", sans-serif; color: #1E293B;
         display: flex; flex-direction: column; justify-content: center;
         padding: 0 180px; }
  .kicker { color: {{ACCENT}}; font-size: 30px; font-weight: 600;
            letter-spacing: 4px; margin-bottom: 22px; }
  h1 { font-size: 68px; font-weight: 800; margin-bottom: 64px; line-height: 1.3; }
  ul { list-style: none; }
  li { font-size: 44px; line-height: 1.55; color: #334155;
       margin-bottom: 40px; padding-left: 52px; position: relative; }
  li::before { content: ""; position: absolute; left: 0; top: 22px;
               width: 20px; height: 20px; border-radius: 6px;
               background: {{ACCENT}}; }
  code { font-family: Consolas, "Cascadia Mono", monospace; font-size: 0.9em;
         background: #E2E8F0; border-radius: 8px; padding: 2px 12px; }
</style></head>
<body>
  <div class="kicker">{{KICKER}}</div>
  <h1>{{TITLE}}</h1>
  <ul>{{POINTS_HTML}}</ul>
</body></html>
```

- [ ] **Step 3: diagram.html**

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1920px; height: 1080px; background: #F8FAFC;
         font-family: "Microsoft YaHei", sans-serif; color: #1E293B;
         display: flex; flex-direction: column; padding: 56px 100px 48px; }
  .head { display: flex; align-items: baseline; gap: 28px; margin-bottom: 28px; }
  h1 { font-size: 54px; font-weight: 800; }
  .cap { font-size: 32px; color: #64748B; }
  .box { flex: 1; display: flex; align-items: center; justify-content: center; }
  .box svg { max-width: 100%; max-height: 100%; }
</style></head>
<body>
  <div class="head"><h1>{{TITLE}}</h1><div class="cap">{{CAPTION}}</div></div>
  <div class="box">{{SVG}}</div>
</body></html>
```

- [ ] **Step 4: outro.html**

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1920px; height: 1080px; background: #0F172A;
         font-family: "Microsoft YaHei", sans-serif; color: #F1F5F9;
         display: flex; flex-direction: column; justify-content: center;
         padding: 0 180px; }
  .kicker { color: {{ACCENT}}; font-size: 30px; font-weight: 600;
            letter-spacing: 4px; margin-bottom: 28px; }
  h1 { font-size: 68px; font-weight: 800; margin-bottom: 60px; }
  li { font-size: 42px; line-height: 1.55; color: #CBD5E1;
       margin-bottom: 36px; padding-left: 52px; position: relative;
       list-style: none; }
  li::before { content: ""; position: absolute; left: 0; top: 22px;
               width: 20px; height: 20px; border-radius: 6px;
               background: {{ACCENT}}; }
  .next { margin-top: 72px; font-size: 34px; color: #94A3B8; }
</style></head>
<body>
  <div class="kicker">本章小结</div>
  <h1>{{TITLE}}</h1>
  <ul>{{POINTS_HTML}}</ul>
  <div class="next">{{NEXT}}</div>
</body></html>
```

- [ ] **Step 5: 冒烟验证渲染**

Run: `python - <<'EOF'
from pathlib import Path
tpl = Path('tools/video/templates/cover.html').read_text(encoding='utf-8')
out = tpl.replace('{{ACCENT}}','#0891B2').replace('{{TRACK_TITLE}}','Agent 开发 · 工程实践').replace('{{CHAPTER_NO}}','1').replace('{{TITLE}}','意图识别：Agent 的第一道分诊台').replace('{{SUBTITLE}}','为什么第一道关不是调模型，而是分诊')
Path('dist/videos/_tpl_probe.html').write_text(out, encoding='utf-8')
print('tpl ok')
EOF`
Expected: `tpl ok`（浏览器截图验证在 Task 4 串联后进行）

---

### Task 4: Playwright 帧渲染

**Files:**
- Modify: `tools/video/make_video.py`（追加）

- [ ] **Step 1: 追加渲染代码**

```python
TEMPLATE_DIR = Path(__file__).resolve().parent / "templates"
TRACK_META = {  # 轨道名与 accent 色，新增轨道在此登记
    "agent": ("Agent 开发 · 工程实践", "#0891B2"),
}


def esc(text: str) -> str:
    return html.escape(str(text), quote=False)


def fill_template(slide: dict, track: str, chapter: str) -> str:
    track_title, accent = TRACK_META[track]
    tpl = (TEMPLATE_DIR / f"{slide['layout']}.html").read_text(encoding="utf-8")
    repl = {
        "{{ACCENT}}": accent,
        "{{TRACK_TITLE}}": esc(track_title),
        "{{CHAPTER_NO}}": esc(chapter),
        "{{TITLE}}": esc(slide.get("title", "")),
        "{{SUBTITLE}}": esc(slide.get("subtitle", "")),
        "{{KICKER}}": esc(slide.get("kicker", f"第 {chapter} 章")),
        "{{CAPTION}}": esc(slide.get("caption", "")),
        "{{NEXT}}": esc(slide.get("next", "")),
        "{{POINTS_HTML}}": "".join(
            f"<li>{p}</li>" for p in slide.get("points", [])
        ),
        "{{SVG}}": "",  # 由 render_frame 单独注入
    }
    for k, v in repl.items():
        tpl = tpl.replace(k, v)
    return tpl


def render_frames(narr: dict, assets_dir: Path, frames_dir: Path) -> list[Path]:
    """逐张渲染幻灯片截图；文件名带内容 hash，未变化自动跳过。"""
    from playwright.sync_api import sync_playwright

    frames_dir.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        for i, slide in enumerate(narr["slides"], start=1):
            h = slide_hash(slide)
            out = frames_dir / f"frame-{i:02d}-{h}.png"
            if not out.exists():
                content = fill_template(slide, narr["track"], narr["chapter"])
                if slide["layout"] == "diagram":
                    svg = (assets_dir / slide["svg"]).read_text(encoding="utf-8")
                    content = content.replace("<div class=\"box\"></div>",
                                              f'<div class="box">{svg}</div>')
                page.set_content(content, wait_until="networkidle")
                page.screenshot(path=str(out))
                print(f"  渲染 {out.name}")
            else:
                print(f"  跳过 {out.name}")
            results.append(out)
        browser.close()
    return results
```

注意：`fill_template` 里 `{{SVG}}` 占位被替换为空串，diagram 版式通过把 SVG 内联进 `.box` div 注入（Step 1 中 `replace` 的目标是模板里已被替换成空的 `<div class="box"></div>`）。

- [ ] **Step 2: 手工冒烟（用临时最小口播稿）**

Run: `python - <<'EOF'
import sys, json
from pathlib import Path
sys.path.insert(0, 'tools/video')
from make_video import render_frames
narr = {"track": "agent", "chapter": "00", "slides": [
    {"layout": "cover", "title": "冒烟测试", "subtitle": "版式验证", "speech": "x"},
]}
frames = render_frames(narr, Path('tracks/agent/assets'), Path('dist/videos/_smoke/frames'))
print([f.name for f in frames])
EOF`
Expected: 输出一个 PNG 文件名；用图片查看器打开确认中文字体正常、无乱码

---

### Task 5: edge-tts 合成 + 词级时间轴

**Files:**
- Modify: `tools/video/make_video.py`（追加）

- [ ] **Step 1: 追加 TTS 代码**

```python
async def _tts_once(text: str, voice: str, mp3_path: Path, meta_path: Path):
    import edge_tts

    words = []
    comm = edge_tts.Communicate(text, voice)
    with open(mp3_path, "wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append({
                    "w": chunk["text"],
                    "t": round(chunk["offset"] / 1e7, 2),   # 100ns -> 秒
                    "d": round(chunk["duration"] / 1e7, 2),
                })
    meta_path.write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")
    return words


def synthesize_speech(text: str, voice: str, mp3_path: Path,
                      meta_path: Path, retries: int = 5) -> list[dict]:
    """edge-tts 合成；指数退避重试；成功后缓存文件即跳过的逻辑由调用方负责。"""
    for attempt in range(1, retries + 1):
        try:
            return asyncio.run(_tts_once(text, voice, mp3_path, meta_path))
        except Exception as e:  # edge-tts 偶发 403/超时
            if attempt == retries:
                raise
            wait = 2 ** attempt
            print(f"  TTS 第 {attempt} 次失败（{e}），{wait}s 后重试")
            time.sleep(wait)
```

- [ ] **Step 2: 冒烟验证**

Run: `python - <<'EOF'
import sys
from pathlib import Path
sys.path.insert(0, 'tools/video')
from make_video import synthesize_speech
ws = synthesize_speech("你好，这是意图识别章节的开场白。", "zh-CN-YunxiNeural",
                       Path('dist/videos/_smoke/probe.mp3'), Path('dist/videos/_smoke/probe.json'))
print(len(ws), ws[:3])
EOF`
Expected: 词数 > 0，且前几项形如 `{'w': '你好', 't': 0.xx, ...}`；`probe.mp3` 可播放

---

### Task 6: SRT 生成

**Files:**
- Modify: `tools/video/make_video.py`（追加）
- Test: `tools/video/tests/test_srt.py`

- [ ] **Step 1: 写失败测试**

```python
# tools/video/tests/test_srt.py
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from make_video import build_srt, srt_time


def test_srt_time_format():
    assert srt_time(0) == "00:00:00,000"
    assert srt_time(3661.5) == "01:01:01,500"


def test_build_srt_splits_by_char_limit_and_offsets():
    # 一段：起始 S=0，音频前 0.4s 静音；词偏移 0.0/1.0/2.0
    seg = {"start": 0.0, "dur": 4.0,
           "words": [{"w": "意图识别", "t": 0.0}, {"w": "是第一道", "t": 1.0},
                     {"w": "分诊台", "t": 2.0}]}
    srt = build_srt([seg], max_chars=10)
    lines = [l for l in srt.strip().splitlines()]
    # 第一条字幕：00:00:00,400 起（段起始 + 头部静音）
    assert "00:00:00,400 -->" in srt
    # 18 字内会合并为一条（10 字限制下 9 字合为一条）
    assert srt.count("\n\n") + 1 == 1
```

- [ ] **Step 2: 运行确认失败**

Run: `python -m pytest tools/video/tests/test_srt.py -v`
Expected: FAIL（`cannot import name 'build_srt'`）

- [ ] **Step 3: 实现**

```python
def srt_time(sec: float) -> str:
    ms = int(round(sec * 1000))
    h, ms = divmod(ms, 3600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_srt(segments: list[dict], max_chars: int = 18) -> str:
    """segments: [{start(段视频起点), dur(音频时长), words:[{w,t}]}]，
    t 为相对音频文件的秒偏移；字幕绝对时间 = start + 0.4 + t。"""
    GAP_HEAD = 0.4
    entries = []
    for seg in segments:
        words = seg["words"]
        if not words:
            continue
        base = seg["start"] + GAP_HEAD
        audio_end = seg["start"] + GAP_HEAD + seg["dur"]
        # 累积成不超过 max_chars 的字幕行
        rows = []
        cur, cur_t = [], None
        for w in words:
            if cur_t is None:
                cur_t = w["t"]
            cur.append(w)
            text = "".join(x["w"] for x in cur)
            if len(text) >= max_chars:
                rows.append((cur_t, text))
                cur, cur_t = [], None
        if cur:
            rows.append((cur_t, "".join(x["w"] for x in cur)))
        # 行的结束时间取下一行起始或音频结束
        for i, (t0, text) in enumerate(rows):
            t1 = rows[i + 1][0] if i + 1 < len(rows) else audio_end
            entries.append((base + t0, min(base + t1, audio_end), text))
    out = []
    for i, (t0, t1, text) in enumerate(entries, start=1):
        out.append(f"{i}\n{srt_time(t0)} --> {srt_time(t1)}\n{text}\n")
    return "\n".join(out)
```

- [ ] **Step 4: 运行测试通过**

Run: `python -m pytest tools/video/tests/test_srt.py -v`
Expected: 2 passed

---

### Task 7: ffmpeg 段合成 + concat + 时长校验

**Files:**
- Modify: `tools/video/make_video.py`（追加）

- [ ] **Step 1: 追加合成代码**

```python
def run(cmd: list[str], **kw):
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", **kw)
    if proc.returncode != 0:
        raise RuntimeError(f"命令失败：{' '.join(cmd)}\n{proc.stderr[-2000:]}")
    return proc


def mp3_duration(path: Path) -> float:
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
               "-of", "json", str(path)]).stdout
    return float(json.loads(out)["format"]["duration"])


def render_segment(frame: Path, mp3: Path, ts_out: Path, gap: float = 0.4):
    """静帧 + 音频（首尾各 gap 秒静音）-> mpegts 段。"""
    dur = mp3_duration(mp3)
    ms = int(gap * 1000)
    run(["ffmpeg", "-y", "-loop", "1", "-framerate", "30", "-i", str(frame),
         "-i", str(mp3),
         "-af", f"adelay={ms}:all=1,apad=pad_dur={gap}",
         "-t", f"{dur + gap * 2:.3f}",
         "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
         "-ar", "44100", "-ac", "2", "-f", "mpegts", str(ts_out)])
    return dur + gap * 2


def concat_segments(ts_files: list[Path], out_mp4: Path):
    list_file = out_mp4.with_suffix(".concat.txt")
    list_file.write_text(
        "\n".join(f"file '{f.as_posix()}'" for f in ts_files), encoding="utf-8")
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
         "-c", "copy", "-movflags", "+faststart", str(out_mp4)])
    list_file.unlink()


def verify_duration(out_mp4: Path, expect: float, tol: float = 0.5):
    got = mp3_duration(out_mp4)
    if abs(got - expect) > tol:
        raise RuntimeError(f"成片时长 {got:.2f}s 与预期 {expect:.2f}s 相差超过 {tol}s")


def extract_frame_at(out_mp4: Path, sec: float, png: Path):
    run(["ffmpeg", "-y", "-ss", f"{sec:.2f}", "-i", str(out_mp4),
         "-frames:v", "1", str(png)])
```

- [ ] **Step 2: 冒烟验证（Task 4/5 的产物拼一个 2 秒小片）**

Run: `python - <<'EOF'
import sys
from pathlib import Path
sys.path.insert(0, 'tools/video')
from make_video import render_segment, concat_segments, verify_duration, mp3_duration
d = Path('dist/videos/_smoke')
frame = next((d / 'frames').glob('*.png'))
mp3 = d / 'probe.mp3'
seg_len = render_segment(frame, mp3, d / 'seg1.ts')
concat_segments([d / 'seg1.ts', d / 'seg1.ts'], d / 'mini.mp4')
verify_duration(d / 'mini.mp4', seg_len * 2)
print('ffmpeg pipeline ok', mp3_duration(d / 'mini.mp4'))
EOF`
Expected: `ffmpeg pipeline ok ~9.x`（2 段 × (音频时长+0.8s)）

---

### Task 8: CLI 串联（main）

**Files:**
- Modify: `tools/video/make_video.py`（追加 main）
- Create: `tracks/agent/narration/00-冒烟.json`（Task 9 起用真实稿，此为管线自测临时件，验收后删除）

- [ ] **Step 1: 追加 main**

```python
ACCENT_VOICE_DEFAULT = "zh-CN-YunxiNeural"


def build_video(narr_path: Path, assets_dir: Path, work_dir: Path, out_mp4: Path):
    narr = load_narration(str(narr_path), assets_dir=assets_dir)
    frames_dir = work_dir / "frames"
    audio_dir = work_dir / "audio"
    frames_dir.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(parents=True, exist_ok=True)

    print("[1/4] 渲染帧")
    frames = render_frames(narr, assets_dir, frames_dir)

    print("[2/4] 合成旁白")
    segs = []
    for i, slide in enumerate(narr["slides"], start=1):
        mp3 = audio_dir / f"seg-{i:02d}.mp3"
        meta = audio_dir / f"seg-{i:02d}.json"
        if not (mp3.exists() and meta.exists()):
            synthesize_speech(slide["speech"], narr["voice"], mp3, meta)
            print(f"  合成 seg-{i:02d}")
        else:
            print(f"  跳过 seg-{i:02d}")
        segs.append({"mp3": mp3, "words": json.loads(meta.read_text(encoding="utf-8"))})

    print("[3/4] 字幕与分段")
    gap = 0.4
    start = 0.0
    srt_segments = []
    for seg in segs:
        seg["dur"] = mp3_duration(seg["mp3"])
        srt_segments.append({"start": start, "dur": seg["dur"], "words": seg["words"]})
        start += seg["dur"] + gap * 2
    srt_path = out_mp4.with_suffix(".srt")
    srt_path.parent.mkdir(parents=True, exist_ok=True)
    srt_path.write_text(build_srt(srt_segments), encoding="utf-8")

    print("[4/4] ffmpeg 合成")
    ts_files = []
    for i, (seg, frame) in enumerate(zip(segs, frames), start=1):
        ts = work_dir / f"part-{i:02d}.ts"
        if not ts.exists():
            render_segment(frame, seg["mp3"], ts)
        ts_files.append(ts)
    concat_segments(ts_files, out_mp4)
    verify_duration(out_mp4, start)
    print(f"完成：{out_mp4}")
    print(f"字幕：{srt_path}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="文章转视频管线")
    ap.add_argument("--track", default="agent")
    ap.add_argument("--chapter", help="如 01；与 --all 二选一")
    ap.add_argument("--all", action="store_true", help="批量处理该轨道全部口播稿")
    args = ap.parse_args(argv)

    narr_dir = REPO / "tracks" / args.track / "narration"
    assets_dir = REPO / "tracks" / args.track / "assets"
    files = sorted(narr_dir.glob("*.json")) if args.all else [
        next(narr_dir.glob(f"{args.chapter}-*.json"))]

    for narr_path in files:
        out_dir = REPO / "dist" / "videos" / args.track
        out_mp4 = out_dir / (narr_path.stem + ".mp4")
        work = out_dir / "cache" / narr_path.stem
        print(f"=== {narr_path.stem} ===")
        build_video(narr_path, assets_dir, work, out_mp4)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 写最小冒烟口播稿并跑通**

`tracks/agent/narration/00-冒烟.json`：
```json
{
  "track": "agent", "chapter": "00", "title": "冒烟", "voice": "zh-CN-YunxiNeural",
  "slides": [
    {"layout": "cover", "title": "管线冒烟测试", "subtitle": "四版式串联验证", "speech": "这是管线冒烟测试的封面。"},
    {"layout": "outro", "title": "冒烟完成", "points": ["四版式渲染正常", "旁白与字幕对齐"], "speech": "冒烟测试完成。"}
  ]
}
```

Run: `python tools/video/make_video.py --track agent --chapter 00`
Expected: 四步全部打印，`dist/videos/agent/00-冒烟.mp4` 与 `.srt` 生成，无异常

- [ ] **Step 3: 抽帧自检**

Run: `python - <<'EOF'
import sys; from pathlib import Path
sys.path.insert(0, 'tools/video')
from make_video import extract_frame_at
d = Path('dist/videos/agent')
extract_frame_at(d / '00-冒烟.mp4', 1.0, d / 'check-1s.png')
print('ok')
EOF`
Expected: 打开 `check-1s.png` 确认画面正确；删除 `00-冒烟.json` 与其产物

- [ ] **Step 4: 回归全部单测**

Run: `python -m pytest tools/video/tests/ -v`
Expected: 全部 passed

---

### Task 9: 第 1 篇口播稿（意图识别）

**Files:**
- Create: `tracks/agent/narration/01-意图识别.json`

改写规则（来自 spec 与仓库写作风格）：
- 逐节读 `tracks/agent/tutorial/01-意图识别.md`，按小节 → 幻灯片映射：开头故事进 `cover`；每个 `##` 小节 1–3 张 `points`；文章引用的每张 SVG 出一张 `diagram`（`svg` 字段用 assets 目录内文件名，正文中 `![…](../assets/XX.svg)` 的文件名）；章末总结进 `outro`
- speech 为大白话口播，删除行号引用/表格/"如图"类视觉依赖；代码不念，用一句"详细代码见图文版"带过或直接略
- 全篇 speech 合计 2000–3000 字；单条 speech ≤ 400 字（TTS 单次合成上限友好）
- `kicker` 用小节编号（如"第 1 节"），`next` 写下一篇标题

- [ ] **Step 1: 通读原文并生成口播稿 JSON**（结构示意，内容以原文为准）

```json
{
  "track": "agent", "chapter": "01",
  "title": "意图识别：Agent 的第一道分诊台",
  "voice": "zh-CN-YunxiNeural",
  "slides": [
    {"layout": "cover", "title": "意图识别：Agent 的第一道分诊台",
     "subtitle": "为什么第一道关不是调模型，而是分诊", "speech": "（开场白：以原文开头的故事改写，约 120 字）"},
    {"layout": "points", "kicker": "第 1 节", "title": "（小节标题）",
     "points": ["（要点 1）", "（要点 2）"], "speech": "（本节旁白 150–300 字）"},
    {"layout": "diagram", "title": "（图标题）", "svg": "03-三层级联与置信度闸门.svg",
     "caption": "（图注）", "speech": "（讲图旁白 150–250 字）"},
    {"layout": "outro", "title": "本章小结", "points": ["（总结要点）"],
     "next": "02 执行核心", "speech": "（收尾约 100 字）"}
  ]
}
```

- [ ] **Step 2: 校验通过**

Run: `python -c "import sys; sys.path.insert(0,'tools/video'); from make_video import load_narration; from pathlib import Path; load_narration('tracks/agent/narration/01-意图识别.json', Path('tracks/agent/assets')); print('ok')"`
Expected: `ok`

---

### Task 10: 第 1 篇样片验收

- [ ] **Step 1: 生成样片**

Run: `python tools/video/make_video.py --track agent --chapter 01`
Expected: `dist/videos/agent/01-意图识别.mp4` + `.srt` 生成

- [ ] **Step 2: 机器自检**

Run: `python - <<'EOF'
import sys; from pathlib import Path
sys.path.insert(0, 'tools/video')
from make_video import extract_frame_at, mp3_duration
mp4 = Path('dist/videos/agent/01-意图识别.mp4')
print('总时长(s):', round(mp3_duration(mp4), 1))
for s in (3, 60, 300):
    extract_frame_at(mp4, s, Path(f'dist/videos/agent/check-{s}s.png'))
EOF`
Expected: 时长 8–15 分钟区间；三张抽帧打开检查（封面/要点/全图各至少一张）

- [ ] **Step 3: 用户验收样片**

请用户观看 `dist/videos/agent/01-意图识别.mp4`（含 srt），确认：语音自然度、画面版式、信息密度。通过后进入批量；不通过则调模板/口播稿重跑（帧与音频有缓存，改动成本低）。

---

### Task 11: 批量生成剩余 10 篇

**Files:**
- Create: `tracks/agent/narration/02-执行核心.json` … `11-高频23问.json`

- [ ] **Step 1: 并行子代理改写**

分 3 批（3+3+4）派发 general-purpose 子代理，每个的 prompt 模板：

> 阅读 `tracks/agent/tutorial/NN-标题.md` 全文，改写为视频口播稿，写入 `tracks/agent/narration/NN-标题.json`。规则：JSON 结构为 {"track":"agent","chapter":"NN","title":"<章节标题>","voice":"zh-CN-YunxiNeural","slides":[…]}；slides 版式仅限 cover/points/diagram/outro（字段见 `tracks/agent/narration/01-意图识别.json` 样例）；cover 放开头故事，每个 ## 小节 1–3 张 points，正文引用的每张 SVG（`![…](../assets/XX.svg)`）出一张 diagram 且 svg 字段填文件名，章末 outro；speech 大白话、无行号/表格/"如图"依赖、代码不念，全篇合计 2000–3000 字、单条 ≤400 字；写完自检 JSON 可解析。第 11 篇（高频 23 问）改为：每 3–5 问一张 points，总字数放宽到 4000。

- [ ] **Step 2: 批量校验**

Run: `python - <<'EOF'
import sys, json
from pathlib import Path
sys.path.insert(0, 'tools/video')
from make_video import load_narration
ok, fail = 0, []
for p in sorted(Path('tracks/agent/narration').glob('*.json')):
    try:
        load_narration(str(p), Path('tracks/agent/assets'))
        ok += 1
    except Exception as e:
        fail.append(f"{p.name}: {e}")
print(f"通过 {ok}，失败 {len(fail)}")
print("\n".join(fail))
EOF`
Expected: 11 个文件全部通过；失败项修复后重跑

- [ ] **Step 3: 批量出片（可后台执行）**

Run: `python tools/video/make_video.py --track agent --all`
Expected: `dist/videos/agent/` 下 11 组 mp4+srt；抽查第 2、11 篇抽帧

---

### Task 12: README 与收尾

**Files:**
- Create: `tools/video/README.md`

- [ ] **Step 1: README**

```markdown
# 文章转视频管线

把 `tracks/<track>/tutorial/*.md` 的口播稿（`tracks/<track>/narration/*.json`）
生成为 1080p 讲解视频（mp4 + srt），产物在 `dist/videos/<track>/`（不入库）。

## 依赖
- Python 3.13 + `pip install playwright edge-tts pytest && playwright install chromium`
- ffmpeg：`winget install --id Gyan.FFmpeg -e`

## 用法
- 单章：`python tools/video/make_video.py --track agent --chapter 01`
- 全部：`python tools/video/make_video.py --track agent --all`
- 帧/音频/分段缓存在 `dist/videos/<track>/cache/`，删除即强制重生成
- 新轨道：在 `make_video.py` 的 `TRACK_META` 登记名称与 accent 色，提供 narration/

## 口播稿
见 `docs/superpowers/specs/2026-10-25-article-to-video-design.md` 的格式与改写规则。
```

- [ ] **Step 2: 询问用户是否提交**

向用户汇总：新增 `tools/video/`、`tracks/agent/narration/`、spec 与 plan 文档，
确认后 `git add` + commit（工作区还有用户未提交的 rocksdb 变更，注意只加自己的文件）。

---

## Self-Review 记录

- Spec 覆盖：校验（Task 2）、四版式（Task 3）、帧渲染+缓存（Task 4）、TTS+重试（Task 5）、srt（Task 6）、合成+校验（Task 7）、CLI（Task 8）、口播稿（Task 9/11）、验收（Task 10）、README（Task 12）、新增轨道登记（Task 12 README）——全覆盖；spec 中 points 版式"可选 SVG 小图"为可选能力，本期不做（YAGNI）
- 占位符：Task 9 的口播稿内容为创作物，给出结构骨架与字数规则，代码步骤均完整
- 类型一致性：`build_srt` 的 segments 字段（start/dur/words）与 Task 8 调用一致；`render_frames` 返回 `list[Path]` 与 `zip(segs, frames)` 对齐；`slide_hash` 在 Task 2 定义、Task 4 使用
