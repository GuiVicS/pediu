# Whisper interno

Transcrição de áudio **dentro da stack da PediuLanchou**: o áudio dos clientes (WhatsApp) não sai para API de terceiros. É um serviço pequeno (FastAPI + [faster-whisper](https://github.com/SYSTRAN/faster-whisper), CPU, int8) com a **mesma API da OpenAI** (`POST /v1/audio/transcriptions`), por isso a API do app o trata como mais um provedor de transcrição ("Whisper interno").

## Como funciona na stack
- Serviço `whisper` nos arquivos de compose (`deploy/docker-compose.portainer.yml` e o compose local). **Não publica porta**: só a rede interna dos containers o alcança (`http://whisper:8000`).
- A API usa `INTERNAL_WHISPER_URL` (já definida nos compose). A tela **Inteligência artificial** do super admin pode trocar de provedor (OpenAI, Groq…) sem reiniciar; o ambiente é só o padrão.
- O modelo baixa na **primeira subida** (precisa de internet) e fica no volume `whisper_models`.

## Variáveis (serviço `whisper`)
| Variável | Padrão | Observação |
|---|---|---|
| `WHISPER_MODEL` | `small` | `tiny` (≈75 MB, fraco), `base` (≈145 MB), `small` (≈480 MB, **recomendado para português**), `medium` (≈1,5 GB, mais preciso e lento) |
| `WHISPER_COMPUTE` | `int8` | `int8` usa menos memória na CPU |
| `WHISPER_LANGUAGE` | `pt` | idioma padrão se o cliente não informar |
| `WHISPER_THREADS` | `0` | 0 = automático |
| `WHISPER_API_KEY` | vazio | se definida, exige `Authorization: Bearer`; defina também `INTERNAL_WHISPER_KEY` na API |
| `MAX_AUDIO_MB` / `QUEUE_TIMEOUT_S` | `25` / `60` | limite de arquivo e espera na fila |

Memória aproximada em uso: `base` ≈ 0,5 GB, `small` ≈ 1 GB, `medium` ≈ 2,5 GB. Uma transcrição por vez (CPU); as demais esperam na fila.

## Testar
```bash
docker compose exec api wget -qO- http://whisper:8000/health
docker compose exec whisper python - <<'PY'
import urllib.request
print(urllib.request.urlopen("http://127.0.0.1:8000/health").read())
PY
```
Para transcrever um arquivo (de dentro de qualquer container da rede): `curl -F file=@audio.ogg -F language=pt http://whisper:8000/v1/audio/transcriptions`.

## Limites
Sem GPU: áudios longos demoram (ordem de 0,5–1× o tempo do áudio no `small`). Não há diarização nem tradução. Qualidade em português depende do modelo: `tiny`/`base` erram bastante; use `small` ou maior em produção.
