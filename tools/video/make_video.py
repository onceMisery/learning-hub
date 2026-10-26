"""文章转视频管线：narration.json -> 帧 -> TTS -> srt -> mp4。用法见 README.md。"""
import argparse
import asyncio
import hashlib
import html
import json
import os
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

    for field in ("track", "chapter", "title", "voice", "slides"):
        if field not in data:
            errors.append(f"缺少顶层字段 {field}")
    if errors:
        raise ValueError("\n".join(errors))

    for i, slide in enumerate(data["slides"], start=1):
        tag = f"slide {i}"
        layout = slide.get("layout")
        if layout not in LAYOUTS:
            errors.append(f"{tag}: layout '{layout}' 非法，可选 {LAYOUTS}")
        if not str(slide.get("speech", "")).strip():
            errors.append(f"{tag}: 缺少 speech")
        if layout == "diagram":
            svg = slide.get("svg", "")
            if not svg:
                errors.append(f"{tag}: diagram 缺少 svg")
            elif not (assets_dir / svg).is_file():
                errors.append(f"{tag}: svg 文件不存在 {assets_dir / svg}")

    if errors:
        raise ValueError("口播稿校验失败：\n" + "\n".join(errors))
    return data


def slide_hash(slide: dict) -> str:
    return hashlib.sha1(
        json.dumps(slide, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:10]


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
        "{{SVG}}": "",  # diagram 版式的 SVG 由 render_frames 内联注入
    }
    for k, v in repl.items():
        tpl = tpl.replace(k, v)
    return tpl


def render_frames(narr: dict, assets_dir: Path, frames_dir: Path) -> list:
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
                    content = content.replace(
                        '<div class="box"></div>', f'<div class="box">{svg}</div>')
                page.set_content(content, wait_until="networkidle")
                page.screenshot(path=str(out))
                print(f"  渲染 {out.name}")
            else:
                print(f"  跳过 {out.name}")
            results.append(out)
        browser.close()
    return results


async def _tts_once(text: str, voice: str, mp3_path: Path, meta_path: Path):
    import edge_tts

    words = []
    comm = edge_tts.Communicate(text, voice, boundary="WordBoundary")
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
                      meta_path: Path, retries: int = 5) -> list:
    """edge-tts 合成；指数退避重试。已合成段的跳过逻辑由调用方负责。"""
    for attempt in range(1, retries + 1):
        try:
            return asyncio.run(_tts_once(text, voice, mp3_path, meta_path))
        except Exception as e:  # edge-tts 偶发 403/超时
            if attempt == retries:
                raise
            wait = 2 ** attempt
            print(f"  TTS 第 {attempt} 次失败（{e}），{wait}s 后重试")
            time.sleep(wait)


def srt_time(sec: float) -> str:
    ms = int(round(sec * 1000))
    h, ms = divmod(ms, 3600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_srt(segments: list, max_chars: int = 18) -> str:
    """segments: [{start(段视频起点), dur(音频时长), words:[{w,t}]}]，
    t 为相对音频文件的秒偏移；字幕绝对时间 = start + GAP_HEAD + t。"""
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


def ffmpeg_exe() -> str:
    """优先 PATH 里的 ffmpeg；否则用 imageio-ffmpeg 自带的二进制。"""
    found = shutil.which("ffmpeg")
    if found:
        return found
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def run(cmd: list, **kw) -> subprocess.CompletedProcess:
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", **kw)
    if proc.returncode != 0:
        raise RuntimeError(f"命令失败：{' '.join(map(str, cmd))}\n{proc.stderr[-2000:]}")
    return proc


def mp3_duration(path: Path) -> float:
    """无 ffprobe 时从 `ffmpeg -i` 的 stderr 解析 Duration 行。"""
    proc = subprocess.run([ffmpeg_exe(), "-i", str(path)],
                          capture_output=True, text=True, encoding="utf-8",
                          errors="replace")
    for line in proc.stderr.splitlines():
        if "Duration:" in line:
            ts = line.split("Duration:")[1].split(",")[0].strip()
            h, m, s = ts.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    raise RuntimeError(f"无法解析时长：{path}")


def part_ok(ts_out: Path, expect: float, tol: float = 0.2) -> bool:
    try:
        return abs(mp3_duration(ts_out) - expect) <= tol
    except Exception:
        return False


def render_segment(frame: Path, mp3: Path, ts_out: Path, gap: float = 0.4) -> float:
    """静帧 + 音频（首尾各 gap 秒静音）-> mpegts 段，返回段时长。"""
    dur = mp3_duration(mp3)
    ms = int(gap * 1000)
    run([ffmpeg_exe(), "-y", "-loop", "1", "-framerate", "30", "-i", str(frame),
         "-i", str(mp3),
         "-af", f"adelay={ms}:all=1,apad=pad_dur={gap}",
         "-t", f"{dur + gap * 2:.3f}",
         "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
         "-ar", "44100", "-ac", "2", "-f", "mpegts", str(ts_out)])
    return dur + gap * 2


def concat_segments(ts_files: list, out_mp4: Path):
    list_file = out_mp4.with_suffix(".concat.txt")
    list_file.write_text(
        "\n".join(f"file '{f.resolve().as_posix()}'" for f in ts_files),
        encoding="utf-8")
    run([ffmpeg_exe(), "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
         "-c", "copy", "-movflags", "+faststart", str(out_mp4)])
    list_file.unlink()


def verify_duration(out_mp4: Path, expect: float, n_segments: int = 1):
    """mpegts concat 每段有 ~0.03s 时间基取整偏差，容差按段数放宽。"""
    got = mp3_duration(out_mp4)
    tol = max(0.5, 0.05 * n_segments)
    if abs(got - expect) > tol:
        raise RuntimeError(f"成片时长 {got:.2f}s 与预期 {expect:.2f}s 相差超过 {tol:.2f}s")


def extract_frame_at(out_mp4: Path, sec: float, png: Path):
    run([ffmpeg_exe(), "-y", "-ss", f"{sec:.2f}", "-i", str(out_mp4),
         "-frames:v", "1", str(png)])


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
        segs.append({"mp3": mp3,
                     "words": json.loads(meta.read_text(encoding="utf-8"))})

    print("[3/4] 字幕与分段")
    gap = 0.4
    start = 0.0
    srt_segments = []
    for seg in segs:
        seg["dur"] = mp3_duration(seg["mp3"])
        srt_segments.append({"start": start, "dur": seg["dur"],
                             "words": seg["words"]})
        start += seg["dur"] + gap * 2
    srt_path = out_mp4.with_suffix(".srt")
    srt_path.parent.mkdir(parents=True, exist_ok=True)
    srt_path.write_text(build_srt(srt_segments), encoding="utf-8")

    print("[4/4] ffmpeg 合成")
    ts_files = []
    for i, (seg, frame) in enumerate(zip(segs, frames), start=1):
        ts = work_dir / f"part-{i:02d}.ts"
        expect = seg["dur"] + gap * 2
        if ts.exists() and not part_ok(ts, expect):
            print(f"  丢弃损坏分段 {ts.name}")
            ts.unlink()
        if not ts.exists():
            render_segment(frame, seg["mp3"], ts)
        ts_files.append(ts)
    concat_segments(ts_files, out_mp4)
    verify_duration(out_mp4, start, n_segments=len(ts_files))
    print(f"完成：{out_mp4}")
    print(f"字幕：{srt_path}")


def acquire_instance_lock():
    """单实例锁：同一时间只允许一个出片进程写 dist/videos。"""
    lock_path = REPO / "dist" / "videos" / ".make_video.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.touch(exist_ok=True)
    try:
        fh = open(lock_path, "r+b")
        if lock_path.stat().st_size == 0:
            fh.write(b"1")
            fh.flush()
        fh.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("另一个出片实例正在运行，已退出", file=sys.stderr)
        raise SystemExit(1)
    return fh


def main(argv=None):
    ap = argparse.ArgumentParser(description="文章转视频管线")
    ap.add_argument("--track", default="agent")
    ap.add_argument("--chapter", help="如 01；与 --all 二选一")
    ap.add_argument("--all", action="store_true", help="批量处理该轨道全部口播稿")
    args = ap.parse_args(argv)
    _lock = acquire_instance_lock()

    narr_dir = REPO / "tracks" / args.track / "narration"
    assets_dir = REPO / "tracks" / args.track / "assets"
    if args.all:
        files = sorted(narr_dir.glob("*.json"))
    else:
        files = [next(narr_dir.glob(f"{args.chapter}-*.json"))]

    for narr_path in files:
        out_dir = REPO / "dist" / "videos" / args.track
        out_mp4 = out_dir / (narr_path.stem + ".mp4")
        work = out_dir / "cache" / narr_path.stem
        print(f"=== {narr_path.stem} ===")
        build_video(narr_path, assets_dir, work, out_mp4)


if __name__ == "__main__":
    main()
