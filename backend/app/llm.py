import json
import os

import httpx

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
DEFAULT_MODEL = os.getenv("VOICENAV_MODEL", "qwen2.5:3b")


class LLMUnavailable(Exception):
    """Ollama isn't running, the model isn't pulled, or the request timed out."""


class OllamaClient:
    def __init__(self, model: str = DEFAULT_MODEL, base_url: str = OLLAMA_URL, timeout: float = 60.0):
        self.model = model
        self.base_url = base_url
        self._client = httpx.AsyncClient(base_url=base_url, timeout=timeout)

    async def chat_json(self, system: str, user: str, schema: dict) -> dict:
        """Ask for a reply constrained to `schema`, so the model can't wander off-format."""
        payload = {
            "model": self.model,
            "stream": False,
            "format": schema,
            "keep_alive": "30m",  # stay loaded; the first call pays a long load time
            "options": {"temperature": 0, "num_predict": 80},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
        try:
            res = await self._client.post("/api/chat", json=payload)
            res.raise_for_status()
            return json.loads(res.json()["message"]["content"])
        except (httpx.HTTPError, KeyError, json.JSONDecodeError) as e:
            raise LLMUnavailable(str(e)) from e

    async def health(self) -> dict:
        try:
            res = await self._client.get("/api/tags", timeout=3.0)
            res.raise_for_status()
            models = [m["name"] for m in res.json().get("models", [])]
            return {"ok": self.model in models, "model": self.model, "models": models}
        except httpx.HTTPError:
            return {"ok": False, "model": self.model, "models": []}

    async def aclose(self) -> None:
        await self._client.aclose()
