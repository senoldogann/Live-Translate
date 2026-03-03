"""
Deepgram Nova-2 WebSocket Streaming Client

Ayrı bir thread'de asyncio event loop çalıştırır.
Ses verisi float32 numpy array'den linear16 PCM byte'a dönüştürülerek
WebSocket üzerinden Deepgram'a gönderilir.

Transkript geldiğinde TranslationEngine aracılığıyla çevrilir
ve ZmqPublisher üzerinden Electron'a iletilir.
"""

import os
import json
import time
import threading
import asyncio
import websockets


class DeepgramWSClient:
    """
    Deepgram Nova-2 WebSocket streaming client.
    publisher  : ZmqPublisher — sonuçları Electron'a iletir
    translator : TranslationEngine — metni hedef dile çevirir
    """

    DEEPGRAM_URL = (
        "wss://api.deepgram.com/v1/listen"
        "?model=nova-2"
        "&encoding=linear16"
        "&sample_rate=16000"
        "&channels=1"
        "&interim_results=true"
        "&endpointing=500"
        "&punctuate=true"
    )

    def __init__(self, publisher, translator=None):
        self.api_key  = os.getenv("DEEPGRAM_API_KEY", "")
        self.publisher  = publisher
        self.translator = translator

        self._running = False
        self._loop:   asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._ws = None

    # ── Public API ──────────────────────────────────────────────────────────

    def start(self):
        if self._running:
            return
        if not self.api_key:
            print("[Deepgram] UYARI: DEEPGRAM_API_KEY ayarlanmamış — bulut modu devre dışı.")
            return
        self._running = True
        self._thread  = threading.Thread(target=self._run_loop, daemon=True, name="deepgram-ws")
        self._thread.start()

    def send_audio(self, audio_bytes: bytes):
        """float32 numpy array'den dönüştürülmüş PCM16 byte'ları gönder."""
        if self._ws and self._loop and self._running:
            asyncio.run_coroutine_threadsafe(self._ws.send(audio_bytes), self._loop)

    def stop(self):
        self._running = False
        if self._ws and self._loop:
            asyncio.run_coroutine_threadsafe(self._ws.close(), self._loop)
        if self._thread:
            self._thread.join(timeout=3)
        print("[Deepgram] Durduruldu.")

    # ── Internal ────────────────────────────────────────────────────────────

    def _run_loop(self):
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._ws_loop())
        finally:
            self._loop.close()
            self._loop = None

    async def _ws_loop(self):
        headers = {"Authorization": f"Token {self.api_key}"}
        try:
            async with websockets.connect(
                self.DEEPGRAM_URL,
                extra_headers=headers,
                ping_interval=20,
                ping_timeout=10,
            ) as ws:
                self._ws = ws
                print("[Deepgram] WebSocket bağlantısı kuruldu — gerçek zamanlı dinleme başladı.")
                try:
                    while self._running:
                        msg = await ws.recv()
                        self._handle_message(msg)
                except websockets.exceptions.ConnectionClosed as exc:
                    print(f"[Deepgram] Bağlantı kapandı: {exc.code} {exc.reason}")
        except Exception as exc:
            print(f"[Deepgram] Bağlantı hatası: {exc}")
        finally:
            self._ws = None

    def _handle_message(self, raw: str):
        try:
            data     = json.loads(raw)
            is_final = data.get("is_final", False)
            channel  = data.get("channel", {})
            alts     = channel.get("alternatives", [])

            if not alts:
                return

            transcript = alts[0].get("transcript", "").strip()
            confidence = alts[0].get("confidence", 0.99)

            if not transcript:
                return

            # Çeviri
            translated = transcript
            if self.translator:
                try:
                    translated = self.translator.translate(transcript) or transcript
                except Exception as exc:
                    print(f"[Deepgram] Çeviri hatası: {exc}")

            # Yayın
            if self.publisher:
                result = {
                    "original":   transcript,
                    "translated": translated.strip(),
                    "isFinal":    is_final,
                    "confidence": confidence,
                    "timestamp":  time.time(),
                }
                self.publisher.publish(result)

        except Exception as exc:
            print(f"[Deepgram] Mesaj işleme hatası: {exc}")
