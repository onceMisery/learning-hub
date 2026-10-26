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
