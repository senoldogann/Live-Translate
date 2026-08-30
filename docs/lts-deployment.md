# LTS (Live Translation Server) — Dağıtım Rehberi

LTS, iOS yayın (broadcast) modunun arkasındaki WebSocket servisidir: cihaz sesi
→ transkript → çeviri → altyazı segmentleri. `python/lts_server.py` + paylaşılan
`engine.py` çekirdeğinden oluşur.

Üç dağıtım seviyesi vardır; ihtiyacına göre seç:

| Seviye | Ne zaman | Nasıl |
|---|---|---|
| **1. Yerel LAN (Mac)** | Cihaz testi, tek kullanıcı | Aşağıdaki adımlar |
| **2. Docker (VPS)** | Gerçek kullanıcılar, tek bölge | `docker compose` |
| **3. TLS + proxy** | Production, güvenli `wss://` | Caddy/nginx önünde |

---

## 1. Yerel LAN — hızlı cihaz testi

Mac'te (repo klonlu):

```bash
cd python
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-server.txt
python lts_server.py                # ws://0.0.0.0:8765
```

iPhone'da **Ayarlar → Bulut & Yayın → Sunucu adresi**: `ws://<Mac'in LAN IP'si>:8765`
(telefon ve Mac aynı Wi-Fi'da olmalı). Mac'in IP'si: `ipconfig getifaddr en0`.

API anahtarı eklemek istersen:

```bash
LTS_API_KEY=ornek-anahtar python lts_server.py
```

ve uygulamada aynı anahtarı **API anahtarı** alanına gir.

> LAN'da bile kimse anahtar paylaşma: anahtar, config mesajıyla düz metin gider;
> yalnızca güvendiğin ağlarda anahtarsız çalıştır.

## 2. Docker (VPS) — tek komutla

Sunucuda (Docker kurulu):

```bash
cd python
docker compose up -d --build        # ws://SUNUCU_IP:8765
```

Model önbelleği `lts-model-cache` volume'unda saklanır (restart'ta yeniden inmez).
Sağlık kontrolü yerleşik: `GET /health` → `200 ok` (Docker HEALTHCHECK kullanır).

Yapılandırma `.env` dosyasıyla:

```bash
LTS_API_KEY=uzun-rastgele-anahtar
LTS_WHISPER_MODEL=base          # base | small | medium ...
LTS_MAX_CONNECTIONS=32
```

## 3. Production — TLS ile `wss://`

iOS 17+ yalnızca `wss://` bağlantılara izin verir (kendi kendine imzalı sertifika
olmadan). Caddy ile otomatik Let's Encrypt:

```
# Caddyfile
lts.ornek.com {
    reverse_proxy lts:8765
}
```

Ve compose'a Caddy servisi ekle. Sonra uygulamada: `wss://lts.ornek.com`.

> **Güvenlik notu:** `LTS_API_KEY` set edilmişse bile, anahtar düz metin gider —
> üretimde MUTLAKA TLS kullan. Anahtar yalnızca izinsiz bağlantıları ayıklamak
> içindir, bir kimlik doğrulama protokolü değildir.

---

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `LTS_HOST` | `0.0.0.0` | Dinleme adresi |
| `LTS_PORT` | `8765` | Dinleme portu |
| `LTS_API_KEY` | (boş) | Set edilirse istemciler config'de sunmalı |
| `LTS_WHISPER_MODEL` | `base` | faster-whisper model adı (ilk bağlantıda indirilir) |
| `LTS_DEVICE` | `cpu` | `cpu` veya `cuda` |
| `LTS_COMPUTE_TYPE` | `int8` | `int8` / `float16` / `float32` |
| `LTS_SOURCE_LANG` | `auto` | Varsayılan kaynak dil |
| `LTS_TARGET_LANG` | `tr` | Varsayılan hedef dil |
| `LTS_LOAD_OFFLINE_TRANSLATOR` | `0` | `1` ise çevrimdışı Argos çevirmeni önceden yükle |
| `LTS_MAX_CONNECTIONS` | `32` | Eşzamanlı istemci tavanı (üstüne 1013) |

## Test

```bash
cd python && .venv/bin/python -m pytest test_lts_server.py -q   # 20 test
curl http://127.0.0.1:8765/health                                # ok
```
