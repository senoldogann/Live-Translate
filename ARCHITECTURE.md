# 🏗️ System Architecture: Stealth Subtitle Translator

> **Technical Deep Dive & Internals**

Bu doküman, projenin iç yapısını, modüller arası haberleşmeyi (IPC), kullanılan AI modellerini ve "Stealth" mekanizmasının çalışma prensibini teknik detaylarıyla açıklar.

---

## 🧭 High-Level Overview

Proje, **Electron (Node.js)** ve **Python** olmak üzere iki ana process grubundan oluşan hibrit bir mimariye sahiptir.

```mermaid
graph TB
    subgraph "Main Process (Electron)"
        Main[main.ts]
        Window[BrowserWindow]
        IPC_M[ipcMain Handlers]
    end

    subgraph "Renderer Process (React)"
        App[App.tsx]
        Overlay[SubtitleOverlay]
        Hook[useInteractiveZones]
    end

    subgraph "AI Core (Python Sidecar)"
        Engine[engine.py]
        Azure[Azure Speech Translation]
        Deepgram[Deepgram Fallback]
        Whisper[Faster-Whisper]
        VAD[Silencio VAD]
        ZMQ_Pub[ZMQ Publisher]
    end

    Main -->|Spawns| Engine
    Engine -->|ZMQ TCP:5555| Main
    Main -->|Electron IPC| App
    App -->|Events| Main
```

---

## 🧠 1. AI Core (Python Engine)

Tüm yapay zeka işlemleri `python/engine.py` içinde, Electron ana sürecinden bağımsız bir *child process* olarak çalışır.

### Teknoloji Yığını
*   **Cloud Translation Engine:** `Azure Speech Translation` ana motor olarak kullanılır. Aynı stream içinde preview (`recognizing`) ve final (`recognized`) çeviri üretir.
*   **Cloud Fallback:** `Deepgram` yalnızca Azure kimlik bilgileri yoksa veya Azure unavailable ise devreye girer.
*   **Local STT Engine:** `faster-whisper` (CTranslate2 backend). `small` model varsayılan olarak seçilmiştir. Apple Silicon üzerinde `int8` quantization ile çalışır.
*   **VAD (Voice Activity Detection):** `webrtcvad`. Sessizlik eşiği 400ms'ye indirilerek daha tepkisel hale getirilmiştir.
*   **Translation Layer:**
    *   *Tier 1 (Premium):* DeepL API. Yerel modda daha iyi kalite sağlar; kullanilamazsa metin passthrough olarak yayinlanir.
*   **Logic Controllers:**
    *   *Anti-Loop Filter:* Whisper'ın halüsinasyonlarını (sonsuz döngüleri) tespit edip temizleyen 3-gram filtresi.
    *   *Latency Optimizer:* Buffer sürelerini dinamik yöneterek (Max 5s) gecikmeyi minimize eder.

### Modes & Threading
İki farklı çalışma modu mevcuttur:
1.  **Fast Mode (Streaming):** Preview akışı daha agresiftir; konuşmacıya yetişmek için erken parça yayınlar.
2.  **Stable Mode (Strict):** Final commit odaklıdır; daha az zıplar, daha rahat okunur.

Threading Model:
1.  `_audio_thread`: BlackHole'dan ham ses verisini okur.
2.  `_process_thread`: VAD, STT ve Çeviri işlemlerini yoğun işlemci gücüyle yönetir.


## ⚡ 2. IPC & Communication (ZeroMQ)

Standart `stdio` (stdin/stdout) iletişimi yüksek frekanslı ses verisi akışı için yetersiz kalacağından, endüstri standardı **ZeroMQ (ZMQ)** tercih edilmiştir.

### Protocol
*   **Pattern:** Publisher-Subscriber (PUB/SUB)
*   **Transcript Port:** `tcp://127.0.0.1:5555`
*   **Command Port:** `tcp://127.0.0.1:5556`
*   **Format:**
    ```text
    [TRANSCRIPT] {"original": "Hello", "translated": "Merhaba", "is_final": false}
    [AUDIO_LEVEL] 0.54
    ```

Electron Main process bu portu dinler (`zmq.SUB`) ve gelen veriyi parse edip `mainWindow.webContents.send()` ile React arayüzüne iletir.

---

## 🛡️ 3. Stealth Mechanism (The Ghost Protocol)

Uygulamanın en kritik özelliği olan "Görünmezlik", macOS Window Server seviyesindeki hook'lar ile sağlanır.

### `NSWindowSharingNone`
`electron/main.ts` dosyasında şu çağrı sihirli dokunuşu yapar:

```typescript
mainWindow.setContentProtection(true);
```

Bu Electron API'si, arkaplanda macOS'un native pencere paylaşım korumasını açar. Bu şu anlama gelir:
*   Pencere framebuffer'a çizilir (Kullanıcı görür).
*   Ancak `CGWindowListCreateImage` gibi ekran yakalama API'leri bu pencereyi **render etmeyi reddeder** (Şeffaf veya yok sayılır).
*   Sonuç: Zoom, Teams, OBS, QuickTime, Screenshot araçları pencereyi göremez.

Not: Varsayılan açılış modu artık görünürdür. Kullanıcı Stealth düğmesine basınca bu koruma açılır; screenshot almak için görünür modda kalmak gerekir.

---

## 👆 4. Interactive Click-Through (Smart Overlay)

Pencere tam ekran (`fullscreen`) olsa da, kullanıcı arkadaki uygulamalara (örn. Browser, IDE) tıklayabilmelidir. Ancak altyazı metnini seçebilmesi veya butonlara basabilmesi de gerekir.

Bu paradoks `useInteractiveZones` hook'u ile çözülmüştür:

1.  **Polling:** React tarafı düzenli aralıklarla butonların ve metinlerin koordinatlarını (`rect`) hesaplar.
2.  **IPC Sync:** Bu koordinatları Main process'e gönderir.
3.  **Hole Punching:** Main process, bu koordinatlar **dışındaki** her yeri `setIgnoreMouseEvents(true, { forward: true })` yapar.

Böylece; butonun üzerine gelince mouse olaylarını Electron yakalar, boşluğa gelince tıklama arkadaki pencereye "düşer" (pass-through).

---

## 🧪 Testing Strategy

*   **Unit Tests:** Vitest + JSDOM (`src/__tests__`). UI bileşenlerinin ve mantığının testi.
*   **E2E (Planned):** Playwright Electron desteği ile tam entegrasyon testi.
*   **Security Audit:** OWASP standartlarına göre `webSecurity`, `contextIsolation` kontrolleri.
