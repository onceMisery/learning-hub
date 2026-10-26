# 文章转视频管线设计（article-to-video）

- 日期：2026-10-25
- 状态：已批准（用户确认 mp4 形态、agent 轨道首发、逐章改写口播稿、16:9 画幅）
- 首发范围：`tracks/agent`（11 篇教程 + 10+ 张 SVG 原理图）

## 目标

把轨道里的长文教程自动生成 1080p 讲解视频（mp4 + srt 字幕），可直接发布到 B 站等平台。

非目标：不做真人配音、不做动态动画（幻灯片式静帧 + 旁白）、不做竖屏版（模板留扩展位）。

## 总体架构

```
narration.json（逐章口播稿，人工/LLM 改写，进 git）
        │
        ▼
make_video.py ──► Playwright 截图 ──► frame-NN.png（断点续跑：已存在跳过）
        │
        ├──► edge-tts（zh-CN-YunxiNeural）──► seg-NN.mp3 + 词级时间轴
        │
        ├──► 汇总时间轴 ──► 章节字幕 .srt（外挂，不烧录）
        │
        └──► ffmpeg（静帧+音频逐段合成 → concat）──► dist/videos/<track>/<章>.mp4
```

## 目录布局

```
tools/video/
  templates/cover.html      # 封面版式：轨道名 + 章节标题 + 副标题
  templates/points.html     # 要点版式：小节标题 + 要点列表（可选 SVG 小图）
  templates/diagram.html    # 全图版式：标题 + SVG 原理图大幅展示
  templates/outro.html      # 结尾版式：总结要点 + 下集预告
  make_video.py             # 主管线
  README.md                 # 用法
tracks/agent/narration/01-意图识别.json … 11-高频23问.json   # 口播稿（进 git）
dist/videos/agent/01-意图识别.mp4 + .srt + cache/           # 产出（dist/ 已被 gitignore）
```

## 口播稿格式

每章一个 JSON，字段：

```json
{
  "track": "agent",
  "chapter": "01",
  "title": "意图识别：Agent 的第一道分诊台",
  "voice": "zh-CN-YunxiNeural",
  "slides": [
    { "layout": "cover",   "title": "…", "subtitle": "…", "speech": "开场白" },
    { "layout": "points",  "title": "小节标题", "points": ["要点 1", "要点 2"], "speech": "本节旁白" },
    { "layout": "diagram", "title": "…", "svg": "03-三层级联与置信度闸门.svg", "caption": "可选图注", "speech": "讲这张图" },
    { "layout": "outro",   "points": ["总结 1"], "speech": "收尾" }
  ]
}
```

口播稿改写规则（沿用仓库写作风格）：
- 大白话、有例子，删掉对视觉依赖强的内容（行号引用、表格、"如图/见下表"）
- 每篇 2000–3000 字旁白（约 10–15 分钟成片）
- 代码不念；代码所在小节改为"这里有一段示例代码，详细内容见图文版"式转述或直接跳过

## 管线行为（make_video.py）

用法：`python tools/video/make_video.py --track agent --chapter 01`（`--all` 批量）。

1. **帧渲染**：读 narration.json，逐张幻灯片填模板 → Playwright（Chromium）1920×1080 截图。帧按内容 hash 命名缓存，内容未变不重截。
2. **TTS**：每张幻灯片的 `speech` 用 edge-tts 合成 mp3（48k），记录 word boundary 时间偏移；网络失败指数退避重试（最多 5 次）。
3. **字幕**：段内按词边界分句（每条字幕 ≤ 18 字左右），累加幻灯片起始偏移生成整章 srt。
4. **合成**：每段 `ffmpeg -loop 1 -i frame.png -i seg.mp3` 出 ts 片段（段首尾各 0.4s 静音缓冲），concat 后封装 h264 + aac 的 mp4（yuv420p，faststart）。
5. **校验**：ffprobe 检查时长 = 各音频时长之和（允许 ±0.5s），失败即报错退出。

依赖：Python 3.13（edge-tts 已装 7.2.8）、Playwright（`pip install playwright && playwright install chromium`）、ffmpeg（`winget install ffmpeg`，缺失时报错并提示）。

## 错误处理与缓存

- 帧、音频、字幕、成片分目录缓存在 `dist/videos/<track>/cache/`；删除缓存可强制重生成
- TTS 限流：重试 + 已完成段不重跑
- narration.json 校验：缺 layout/speech 字段、svg 文件不存在时在启动阶段一次性报全部错误

## 验收标准

- 第 1 篇样片：抽帧（封面/要点/全图）人工检查版式与中文字体；srt 与音频对齐；ffprobe 时长正确
- 视觉 gate：样片关键帧由用户确认后，其余章节按同一模板批量产出
- 11 篇全部产出，无失败段

## 风险

| 风险 | 对策 |
| --- | --- |
| edge-tts 偶发限流/403 | 指数退避重试、段级缓存、失败清单汇总 |
| 11 篇口播稿约 3 万字生成量 | 并行子代理分批改写，逐篇人工抽查风格 |
| Chromium 安装约 150MB | 一次性安装，README 记录 |
| 视频文件不进 git | 产出在 dist/（已被 gitignore），只提交口播稿与管线 |
