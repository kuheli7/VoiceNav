import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from .interpreter import SYSTEM_PROMPT, build_schema, interpret
from .llm import LLMUnavailable, OllamaClient
from .schemas import Action, InterpretRequest
from . import transcribe as stt
from .transcribe import WhisperUnavailable

log = logging.getLogger("voicenav")
MAX_AUDIO_BYTES = 5_000_000


async def warm_up(llm: OllamaClient) -> None:
    """Load the model and prime its prompt cache now, so the user's first command isn't the slow one."""
    try:
        await llm.chat_json(SYSTEM_PROMPT, "Page: warm-up\nElements:\n[button] OK\nCommand: scroll", build_schema(["OK"]))
        log.info("model warmed up")
    except LLMUnavailable:
        log.warning("warm-up skipped: Ollama isn't reachable yet")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.llm = OllamaClient()
    warm = asyncio.create_task(warm_up(app.state.llm))  # runs in the background; the server is usable immediately
    # Offline speech: load the model now so the first spoken command isn't the slow one (opt in: it uses a few hundred MB)
    whisper = asyncio.create_task(asyncio.to_thread(stt.load)) if os.getenv("VOICENAV_PRELOAD_WHISPER") == "1" and stt.available() else None
    yield
    warm.cancel()
    if whisper:
        whisper.cancel()
    await app.state.llm.aclose()


# No CORS middleware on purpose: only the extension's service worker (via host_permissions) should call this.
app = FastAPI(title="VoiceNav backend", lifespan=lifespan)


@app.get("/health")
async def health(request: Request):
    return await request.app.state.llm.health()


@app.post("/interpret", response_model=Action)
async def interpret_endpoint(req: InterpretRequest, request: Request):
    action = await interpret(req, request.app.state.llm)
    log.info("%r -> %s id=%s via %s in %dms", req.command, action.action, action.id, action.source, action.latency_ms)
    return action


@app.get("/stt")
async def stt_status():
    """Is offline speech recognition installed? The extension asks before offering it."""
    return {"available": stt.available(), "models": stt.MODELS}


@app.post("/transcribe")
async def transcribe_endpoint(request: Request, lang: str = "en"):
    audio = await request.body()
    if not audio or len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(400, "Send 1 byte to 5 MB of audio as the request body")
    try:
        return {"text": await run_in_threadpool(stt.transcribe, audio, lang)}
    except WhisperUnavailable as e:
        raise HTTPException(501, str(e))
