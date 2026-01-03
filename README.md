# Stealth Subtitle Translator
> **The Ultimate Privacy-First Live Translation Suite for macOS**

![Version](https://img.shields.io/badge/version-1.0.0-blue?style=for-the-badge&logo=none)
![Build](https://img.shields.io/badge/build-passing-success?style=for-the-badge&logo=github-actions)
![Platform](https://img.shields.io/badge/platform-macOS%20Silicon-black?style=for-the-badge&logo=apple)
![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)

**Stealth Subtitle Translator**, kurumsal toplantılar, gizli görüşmeler ve canlı yayınlar için tasarlanmış, **askeri düzeyde tespit edilemezlik** sağlayan yeni nesil bir altyazı aracıdır.

Ekran paylaşımı yaparken, kaydı alırken veya yayın yaparken; altyazılarınızı **SADECE SİZ** görürsünüz. Zoom, Teams, OBS veya QuickTime bu katmanı **göremez**.

---

## ✨ Neden Stealth?

### 🛡️ Ghost-Level Görünmezlik
macOS'un çekirdek seviyesindeki `NSWindowSharingNone` API'sini kullanarak pencereyi ekran yakalama motorlarından soyutlar.
- **Toplantı Güvenliği:** Sunum yaparken çeviriyi takip edin, katılımcılar sadece sunumu görsün.
- **Yayıncılar İçin:** Yayın sırasında chat'i veya notları takip edin, izleyiciler temiz ekran görsün.

### ⚡ Hybrid Core Architecture
Hibrit mimarimiz, Electron'un görsel gücünü Python'un yapay zeka kaslarıyla birleştirir.
- **Engine:** OpenAI `faster-whisper` (Medium Model) ile yüksek doğruluklu transkripsiyon.
- **Translation:** DeepL API (Öncelikli) + Google Translate (Fallback) + Argos Offline.
- **Anti-Hallucination:** "Loop" engelleme filtresi ve sıcaklık (temperature) fallback mekanizması.
- **IPC:** ZeroMQ (ZMQ) üzerinden <5ms gecikmeli veri akışı.

### 💎 Premium User Experience
- **Glassmorphism UI:** macOS Big Sur+ estetiğine uygun, şeffaf ve blurlu arayüz.
- **Interactive Zones:** Tıklanabilir alanları dinamik yöneten akıllı overlay.
- **Voice Activity Detection (VAD):** Silencio VAD motoru (0.4s hassasiyet) ile anlık cümle kesimi.

---

## 🏗️ Sistem Mimarisi

Detaylı teknik inceleme için [ARCHITECTURE.md](ARCHITECTURE.md) dosyasını inceleyin.

```mermaid
graph TD
    User["Kullanıcı Konuşması"] -->|BlackHole 2ch| PyCore["Python AI Core"]
    PyCore -->|VAD| Whisper["Faster-Whisper (Medium)"]
    Whisper -->|Loop Filter| PostProcess["Metin Temizleme"]
    PostProcess -->|Text| Router{"Dil Kontrolü"}
    Router -->|Fince| Google["Google Translate"]
    Router -->|Diğer| DeepL["DeepL API"]
    DeepL -->|Hata/Limit| Google
    Google -->|Sonuç| Electron["Electron Main Process"]
    Electron -->|IPC| React["React Renderer UI"]
```

---

## 🚀 Hızlı Kurulum

### Ön Gereksinimler
*   **Donanım:** Apple Silicon (M1/M2/M3/M4) önerilir. (Medium model için 8GB+ RAM).
*   **OS:** macOS Monterey (12.0) veya üstü.
*   **Sürücü:** [BlackHole 2ch](https://existential.audio/blackhole/) (Ses yakalama için zorunlu).
*   **API Key:** DeepL Free API Key (Opsiyonel ama önerilir).

```bash
brew install blackhole-2ch
brew install python@3.11
```

### Kurulum Adımları

1.  **Repo'yu Klonlayın:**
    ```bash
    git clone https://github.com/senoldogann/live-translate.git
    cd live-translate
    ```

2.  **Bağımlılıkları Yükleyin (Full Stack):**
    ```bash
    npm install
    npm run python:install
    ```

3.  **Çevresel Değişkenler (.env):**
    Proje ana dizininde `.env` dosyası oluşturun:
    ```env
    DEEPL_API_KEY=senin-deepl-api-anahtarin:fx
    ```

4.  **Uygulamayı Başlatın:**
    ```bash
    npm start
    ```

---

## 🎮 Kontroller & Kısayollar

Arayüz üzerindeki **Control Bar** sayesinde tüm deneyimi yönetebilirsiniz:

| İkon | Özellik | Açıklama |
| :--- | :--- | :--- |
| **🎤** | **Listening** | Transkripsiyonu başlatır/durdurur. |
| **🛡️** | **Stealth Mode** | Ekran paylaşımında gizliliği açar/kapatır. (Turuncu = Görünür) |
| **⚡** | **Hızlı Mod** | **Kelime Modu:** Anlık akar, gecikme yoktur (<1s). |
| **🐢** | **Stabil Mod** | **Cümle Modu:** Sadece cümle bitince gösterir, %100 temizdir (3-5s gecikmeli). |
| **👁️** | **Original** | Orijinal İngilizce metni gizler/gösterir. |
| **🔄** | **Restart** | AI motorunu takılırsa yeniden başlatır. |
| **📜** | **History** | Geçmiş konuşmaların dökümünü açar (zaman damgalı). |

---

## 🧪 Geliştirici & Test

Proje, endüstri standardı test ve lint araçları ile korunmaktadır.

```bash
# Unit Testleri Çalıştır (Vitest)
npm test

# Lint Kontrolü (ESLint)
npm run lint

# Production Build Al
npm run electron:build
```

---

## ⚠️ Yasal Uyarı

Bu yazılım **eğitim ve erişilebilirlik** amaçlı geliştirilmiştir. İzinsiz ses kaydı veya kurumsal gizlilik politikalarının ihlali durumunda sorumluluk kullanıcıya aittir. "Stealth Mode" özelliği, kullanıcı mahremiyeti içindir; kötü niyetli kullanımlar yasaktır.

---

<div align="center">
  <sub>Designed & Engineered by <a href="https://github.com/senoldogann">Senol Dogan</a> in Finland.</sub>
</div>
