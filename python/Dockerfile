# LTS — Live Translation Server image.
# Build:  docker build -f python/Dockerfile -t live-translate-lts python
# Run:    docker run -p 8765:8765 live-translate-lts
#
# The Whisper model is downloaded at runtime (first connection) into
# /root/.cache — mount a volume there to avoid re-downloading on restart.

FROM python:3.12-slim

WORKDIR /app

# faster-whisper wheels bundle their native deps; no system packages needed.
COPY requirements-server.txt ./
RUN pip install --no-cache-dir -r requirements-server.txt

COPY engine.py lts_server.py azure_translation_engine.py deepgram_engine.py ./

ENV LTS_HOST=0.0.0.0 \
    LTS_PORT=8765 \
    LTS_WHISPER_MODEL=base \
    LTS_DEVICE=cpu \
    LTS_COMPUTE_TYPE=int8 \
    LTS_MAX_CONNECTIONS=32

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=3).status == 200 else 1)"

# -u: without it stdout is block-buffered in Docker and the server's logs
# (startup banner, Deepgram/DeepL lines, handler errors) never appear.
CMD ["python", "-u", "lts_server.py"]
