"""Servidor Whisper interno da PediuLanchou.

Transcrição de áudio local (sem enviar o áudio para terceiros), com a mesma API da OpenAI:
    POST /v1/audio/transcriptions   (multipart: file, model, language, response_format)
    GET  /health

Motor: faster-whisper (CTranslate2, CPU, int8). O modelo é baixado na primeira subida e fica no volume /models.
Variáveis:
    WHISPER_MODEL      tiny | base | small | medium | large-v3 ... (padrão: small)
    WHISPER_COMPUTE    int8 (padrão) | int8_float32 | float32
    WHISPER_LANGUAGE   idioma padrão quando o cliente não informa (padrão: pt)
    WHISPER_THREADS    threads de CPU (0 = automático)
    WHISPER_API_KEY    se definida, exige "Authorization: Bearer <chave>"
    MAX_AUDIO_MB       tamanho máximo do arquivo (padrão: 25)
    QUEUE_TIMEOUT_S    quanto esperar por vaga na fila antes de responder 503 (padrão: 60)
"""
import asyncio
import hmac
import logging
import os
import tempfile
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, PlainTextResponse
from faster_whisper import WhisperModel

log = logging.getLogger("whisper")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
COMPUTE = os.getenv("WHISPER_COMPUTE", "int8")
DEFAULT_LANG = os.getenv("WHISPER_LANGUAGE", "pt") or None
THREADS = int(os.getenv("WHISPER_THREADS", "0"))
API_KEY = os.getenv("WHISPER_API_KEY", "")
MAX_BYTES = int(float(os.getenv("MAX_AUDIO_MB", "25")) * 1024 * 1024)
QUEUE_TIMEOUT = float(os.getenv("QUEUE_TIMEOUT_S", "60"))
MODEL_DIR = os.getenv("MODEL_DIR", "/models")

state: dict = {"model": None, "ready": False, "error": None, "loaded_at": None}
# CPU: uma transcrição por vez (várias ao mesmo tempo só deixam todas lentas); as demais esperam na fila
slot = asyncio.Semaphore(1)


def load_model() -> None:
    t0 = time.time()
    try:
        log.info("carregando modelo %s (%s)...", MODEL_NAME, COMPUTE)
        state["model"] = WhisperModel(MODEL_NAME, device="cpu", compute_type=COMPUTE, cpu_threads=THREADS, download_root=MODEL_DIR)
        state["ready"], state["loaded_at"] = True, time.time()
        log.info("modelo pronto em %.1f s", time.time() - t0)
    except Exception as e:  # noqa: BLE001 - qualquer falha de download/carga deve aparecer no /health
        state["error"] = str(e)[:300]
        log.exception("falha ao carregar o modelo")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # carrega em segundo plano: o servidor já responde /health ("ready": false) enquanto baixa o modelo na 1ª vez
    asyncio.get_running_loop().run_in_executor(None, load_model)
    yield


app = FastAPI(title="PediuLanchou Whisper", lifespan=lifespan)


def auth(authorization: str | None = Header(default=None)) -> None:
    if not API_KEY:
        return
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(token, API_KEY):
        raise HTTPException(status_code=401, detail="Chave inválida.")


@app.get("/health")
def health() -> dict:
    return {"ok": state["ready"], "ready": state["ready"], "model": MODEL_NAME, "compute": COMPUTE, "error": state["error"]}


@app.post("/v1/audio/transcriptions", dependencies=[Depends(auth)])
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form(default=""),  # aceito por compatibilidade com a OpenAI; quem manda é WHISPER_MODEL
    language: str | None = Form(default=None),
    prompt: str | None = Form(default=None),
    response_format: str = Form(default="json"),
):
    if not state["ready"]:
        raise HTTPException(status_code=503, detail="Modelo ainda carregando. Tente em instantes." if not state["error"] else f"Modelo indisponível: {state['error']}")
    data = await file.read(MAX_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="Arquivo de áudio vazio.")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"Áudio acima de {MAX_BYTES // (1024 * 1024)} MB.")
    try:
        await asyncio.wait_for(slot.acquire(), timeout=QUEUE_TIMEOUT)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="Servidor ocupado. Tente novamente.") from None
    try:
        text, info = await run_in_threadpool(_run, data, (language or DEFAULT_LANG), prompt)
    except Exception as e:  # noqa: BLE001
        log.warning("falha ao transcrever: %s", e)
        raise HTTPException(status_code=422, detail="Não foi possível ler este áudio.") from None
    finally:
        slot.release()
    if response_format == "text":
        return PlainTextResponse(text)
    body = {"text": text}
    if response_format == "verbose_json":
        body.update({"language": info.language, "duration": round(info.duration, 2)})
    return JSONResponse(body)


def _run(data: bytes, language: str | None, prompt: str | None):
    with tempfile.NamedTemporaryFile(suffix=".audio", delete=True) as f:
        f.write(data)
        f.flush()
        # vad_filter corta silêncios (áudios de WhatsApp têm muito); beam_size 1 = mais rápido na CPU
        segments, info = state["model"].transcribe(f.name, language=language, initial_prompt=prompt or None, beam_size=1, vad_filter=True)
        return " ".join(s.text.strip() for s in segments).strip(), info
