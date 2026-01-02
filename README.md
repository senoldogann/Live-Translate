# Stealth Subtitle Translator

> 🎯 **Gerçek zamanlı, gizlilik odaklı masaüstü altyazı çeviri uygulaması**

macOS için tasarlanmış, sistem sesini yakalayıp canlı olarak transkribe ve çeviri yapan, **ekran paylaşımına tamamen görünmez** bir overlay uygulaması.

![Platform](https://img.shields.io/badge/platform-macOS-blue)
![Apple Silicon](https://img.shields.io/badge/optimized-Apple%20Silicon-orange)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Özellikler

- **🔒 Stealth Mode**: Ekran paylaşımı ve ekran kaydına **%100 görünmez** (NSWindowSharingNone)
- **🎙️ Gerçek Zamanlı**: Sistem sesini yakalayıp anında transkribe
- **🌍 Çevrimdışı Çeviri**: İngilizce → Türkçe çeviri (tamamen yerel)
- **🖥️ Apple Silicon**: M1/M2/M3 için optimize edilmiş performans
- **💰 %100 Ücretsiz**: Ücretli API gerektirmez

## 🏗️ Mimari

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron App                             │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │   React UI      │◄───│   ZMQ SUB       │                │
│  │  (Glassmorphism)│    │   (IPC)         │                │
│  └─────────────────┘    └────────▲────────┘                │
│                                  │                          │
│         setContentProtection(true)                          │
│              (NSWindowSharingNone)                          │
└─────────────────────────────────┼───────────────────────────┘
                                  │
                           ZeroMQ PUB/SUB
                                  │
┌─────────────────────────────────▼───────────────────────────┐
│                    Python Sidecar                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ BlackHole   │─►│ Faster-     │─►│ ArgosTranslate      │ │
│  │ Audio       │  │ Whisper     │  │ EN → TR             │ │
│  │ Capture     │  │ (int8)      │  │                     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 📋 Gereksinimler

### Sistem
- macOS 12.0+ (Monterey veya üstü)
- Apple Silicon (M1/M2/M3) - Intel'de de çalışır ancak optimize değil

### BlackHole Audio Driver
Sistem sesini yakalamak için [BlackHole 2ch](https://existential.audio/blackhole/) kurulu olmalıdır:

```bash
brew install blackhole-2ch
```

Kurulumdan sonra:
1. **System Preferences > Sound > Output** → "BlackHole 2ch" seçin
2. **Audio MIDI Setup** → "Multi-Output Device" oluşturun (Built-in + BlackHole)

### Python 3.10+
```bash
brew install python@3.11
```

## 🚀 Kurulum

### 1. Repository'yi klonlayın
```bash
git clone <repo-url>
cd live-translate
```

### 2. Node bağımlılıklarını yükleyin
```bash
npm install
```

### 3. Python bağımlılıklarını yükleyin
```bash
cd python
pip install -r requirements.txt
cd ..
```

### 4. Uygulamayı başlatın
```bash
# Geliştirme modu (Electron + Vite + Python)
npm run start

# Sadece Electron
npm run electron:dev

# Sadece Python engine
npm run python:engine
```

## 🎛️ Kullanım

1. **BlackHole** audio device'ı konfigüre edin
2. Uygulamayı başlatın
3. Bir toplantı veya video oynatın
4. Altyazılar ekranın alt kısmında görünecek

### Kontroller
| Kontrol | Açıklama |
|---------|----------|
| 🎤 Mikrofon | Dinlemeyi başlat/durdur |
| 🛡️ Kalkan | Stealth mode aç/kapat |
| 👁️ Göz | Orijinal metni göster/gizle |
| Opaklık Slider | Altyazı şeffaflığı |
| Font Slider | Yazı boyutu |
| 🔄 Yenile | AI engine'i yeniden başlat |

## ⚙️ Konfigürasyon

Python engine konfigürasyonu `python/engine.py` içinde:

```python
@dataclass
class EngineConfig:
    # Whisper ayarları
    whisper_model: str = "small"      # tiny, base, small, medium, large-v3
    whisper_device: str = "cpu"       # cpu veya mps
    whisper_compute_type: str = "int8" # int8, float16, float32
    
    # Çeviri
    source_lang: str = "en"
    target_lang: str = "tr"
    
    # Audio device
    audio_device: str = "BlackHole 2ch"
```

### Model Seçimi

| Model | RAM | Hız | Kalite |
|-------|-----|-----|--------|
| tiny | ~1GB | ⚡⚡⚡ | ⭐⭐ |
| base | ~1GB | ⚡⚡⚡ | ⭐⭐⭐ |
| small | ~2GB | ⚡⚡ | ⭐⭐⭐⭐ |
| medium | ~5GB | ⚡ | ⭐⭐⭐⭐⭐ |
| large-v3 | ~10GB | 🐢 | ⭐⭐⭐⭐⭐ |

## 🔒 Stealth Mode Nasıl Çalışır?

```typescript
// Electron main.ts
stealthWindow.setContentProtection(true);
```

Bu tek satır macOS'un **NSWindow.sharingType** property'sini `NSWindowSharingNone` olarak ayarlar:

- ✅ Kullanıcı ekranında görünür
- ❌ Zoom/Teams/OBS tarafından yakalanamaz
- ❌ QuickTime ekran kaydında görünmez
- ❌ Screenshot'larda görünmez

## 🐛 Sorun Giderme

### "BlackHole not found" hatası
```bash
# Device listesini kontrol edin
python3 -c "import sounddevice; print(sounddevice.query_devices())"
```

### "faster-whisper" yüklenemiyor
```bash
# Apple Silicon için
pip install faster-whisper --no-cache-dir
```

### ZMQ bağlantı hatası
Port 5555'in kullanımda olmadığından emin olun:
```bash
lsof -i :5555
```

## 📁 Proje Yapısı

```
live-translate/
├── electron/
│   ├── main.ts           # Stealth window konfigürasyonu
│   └── preload.ts         # IPC bridge
├── src/
│   ├── App.tsx           # Ana React component
│   ├── index.css         # Glassmorphism styles
│   └── components/
│       ├── SubtitleOverlay.tsx
│       ├── ControlBar.tsx
│       └── SiriWave.tsx
├── python/
│   ├── engine.py         # AI engine
│   └── requirements.txt
├── package.json
├── vite.config.ts
└── README.md
```

## 📜 Lisans

MIT License - Detaylar için [LICENSE](LICENSE) dosyasına bakın.

---

**⚠️ Yasal Uyarı**: Bu uygulama eğitim amaçlıdır. Kurumsal toplantılarda veya gizli görüşmelerde izinsiz kullanımı yasalara aykırı olabilir.
