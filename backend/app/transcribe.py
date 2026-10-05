"""Optional offline speech-to-text with faster-whisper. Not installed by default (large download).

English uses the small English-only model; Hindi uses the multilingual one. Both are loaded on first use and kept.
A short vocabulary prompt tells the model what kind of sentences to expect ("scroll down", "add to cart"), which makes it
much less likely to hear "paws" for "pause" or "cart" for "card".
"""
import os
import tempfile

_models: dict = {}

MODELS = {"en": os.getenv("VOICENAV_WHISPER", "base.en"), "hi": os.getenv("VOICENAV_WHISPER_HI", "base")}

# Phrases a user is likely to say; extend with VOICENAV_VOCAB="word one, word two"
VOCAB = (
    "VoiceNav commands: scroll down, scroll up a little, go to the top, go back, new tab, next tab, previous tab, "
    "click add to cart, open the second result, open the cheapest one, show numbers, click 5, search for headphones, "
    "type hello, send, pause, play, mute, undo, stop listening, what can I say, describe this page. "
    + os.getenv("VOICENAV_VOCAB", "")
)


class WhisperUnavailable(Exception):
    pass


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False


def load(lang: str = "en"):
    """Load (once) and return the model for a language."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise WhisperUnavailable("Install with: pip install -r requirements-whisper.txt") from e
    key = lang if lang in MODELS else "en"
    if key not in _models:
        _models[key] = WhisperModel(MODELS[key], device="cpu", compute_type="int8")
    return _models[key]


def transcribe(audio: bytes, lang: str = "en") -> str:
    lang = lang if lang in MODELS else "en"
    model = load(lang)
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(audio)
        path = f.name
    try:
        segments, _ = model.transcribe(
            path, language=lang, vad_filter=True, beam_size=1, initial_prompt=VOCAB if lang == "en" else None,
            condition_on_previous_text=False,
        )
        return " ".join(s.text.strip() for s in segments).strip()
    finally:
        os.unlink(path)
