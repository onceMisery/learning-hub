# 文章转视频管线

把轨道教程的口播稿（`tracks/<track>/narration/*.json`）生成为 1080p 讲解视频
（mp4 + srt 字幕），产物在 `dist/videos/<track>/`（不入库）。

## 依赖

- Python 3.13
- `pip install playwright edge-tts imageio-ffmpeg pytest`，然后 `playwright install chromium`
- ffmpeg：优先用 PATH 里的；没有也可用（自动回退到 imageio-ffmpeg 自带的二进制）
- **edge-tts 必须 ≥ 7.3.1**：7.2.x 的鉴权算法已失效（连接返回 403）

## 用法

```bash
# 单章
python tools/video/make_video.py --track agent --chapter 01

# 该轨道全部口播稿
python tools/video/make_video.py --track agent --all
```

- 帧与音频缓存在 `dist/videos/<track>/cache/<章>/`，内容未变的幻灯片自动跳过；
  删除缓存即强制重生成
- TTS 失败自动指数退避重试（最多 5 次），已合成的段不会重跑
- 每段幻灯片画面首尾各留 0.4s 静音缓冲；字幕由 edge-tts 词级时间轴生成，
  外挂 srt（不烧录，方便平台上传）

## 口播稿

格式与改写规则见 `docs/superpowers/specs/2026-10-25-article-to-video-design.md`。
要点：`speech` 是 TTS 要念的大白话；不念代码、行号、表格；diagram 版式的
`svg` 字段填 `tracks/<track>/assets/` 内的文件名（启动时会校验存在性）。

## 新轨道接入

1. 在 `make_video.py` 的 `TRACK_META` 登记轨道显示名与 accent 色
2. 建 `tracks/<track>/narration/` 并放入口播稿
3. 跑 `python tools/video/make_video.py --track <track> --all`

## 测试

```bash
python -m pytest tools/video/tests/ -v
```
