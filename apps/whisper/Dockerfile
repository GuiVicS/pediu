# Servidor Whisper interno (faster-whisper, CPU). Build: docker build -t pediu-whisper apps/whisper
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 MODEL_DIR=/models HF_HOME=/models/hf
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY server.py .

# o modelo (centenas de MB) fica no volume /models, para não baixar de novo a cada atualização da imagem
RUN useradd -m -u 10001 whisper && mkdir -p /models && chown -R whisper /models /app
USER whisper
VOLUME /models
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD python -c "import urllib.request,sys,json; sys.exit(0 if json.load(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)).get('ready') else 1)"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
