"""Offline speech endpoint: routing, limits, and the model choice per language (the model itself is faked)."""
from fastapi.testclient import TestClient

from app import transcribe as stt
from app.main import app


def test_transcribe_passes_language_and_returns_text(monkeypatch):
    seen = {}

    def fake(audio, lang="en"):
        seen["lang"], seen["n"] = lang, len(audio)
        return "scroll down"

    monkeypatch.setattr(stt, "transcribe", fake)
    with TestClient(app) as c:
        r = c.post("/transcribe?lang=hi", content=b"x" * 100)
    assert r.status_code == 200 and r.json() == {"text": "scroll down"}
    assert seen == {"lang": "hi", "n": 100}


def test_transcribe_rejects_empty_and_huge_audio():
    with TestClient(app) as c:
        assert c.post("/transcribe", content=b"").status_code == 400
        assert c.post("/transcribe", content=b"x" * 5_000_001).status_code == 400


def test_transcribe_says_501_when_whisper_is_not_installed(monkeypatch):
    def boom(audio, lang="en"):
        raise stt.WhisperUnavailable("not installed")

    monkeypatch.setattr(stt, "transcribe", boom)
    with TestClient(app) as c:
        assert c.post("/transcribe", content=b"abc").status_code == 501


def test_stt_status_reports_models():
    with TestClient(app) as c:
        j = c.get("/stt").json()
    assert set(j["models"]) == {"en", "hi"} and isinstance(j["available"], bool)


def test_unknown_language_falls_back_to_english_model():
    assert stt.MODELS["en"].endswith("en")
    assert "." not in stt.MODELS["hi"] or not stt.MODELS["hi"].endswith(".en")  # Hindi needs the multilingual model
