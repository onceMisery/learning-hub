import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from make_video import build_srt, srt_time


def test_srt_time_format():
    assert srt_time(0) == "00:00:00,000"
    assert srt_time(3661.5) == "01:01:01,500"


def test_build_srt_offsets_and_split():
    # 一段：段视频起点 S=10s，音频前有 0.4s 静音；词偏移相对音频文件
    seg = {"start": 10.0, "dur": 4.0,
           "words": [{"w": "意图识别", "t": 0.0}, {"w": "是第一道", "t": 1.0},
                     {"w": "分诊台", "t": 2.0}, {"w": "分诊台", "t": 3.0}]}
    srt = build_srt([seg], max_chars=10)
    # 第一条字幕起点 = 10 + 0.4 + 0.0
    assert "00:00:10,400 -->" in srt
    # 第二条字幕起点 = 10 + 0.4 + 3.0（前 9 字合并为第一条，第 4 词起新行）
    assert "00:00:13,400 -->" in srt
    # 最后一条字幕结束时间不超过音频结束（10+0.4+4.0=14.4）
    lines = srt.strip().splitlines()
    assert lines[-2] == "00:00:13,400 --> 00:00:14,400"


def test_two_segments_cumulative():
    segs = [
        {"start": 0.0, "dur": 3.0,
         "words": [{"w": "第一段", "t": 0.0}]},
        {"start": 3.8, "dur": 2.0,
         "words": [{"w": "第二段", "t": 0.0}]},
    ]
    srt = build_srt(segs)
    assert "00:00:00,400" in srt
    assert "00:00:04,200" in srt   # 3.8 + 0.4 + 0
