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
        Whisper[Faster-Whisper]
        VAD[Silencio VAD]
        ZMQ_Pub[ZMQ Publisher]
    end

    Main -->|Spawns| Engine
    Engine -->|ZMQ TCP:5556| Main
    Main -->|Electron IPC| App
    App -->|Events| Main
```

---

## 🧠 1. AI Core (Python Engine)

Tüm yapay zeka işlemleri `python/engine.py` içinde, Electron ana sürecinden bağımsız bir *child process* olarak çalışır.

### Teknoloji Yığını
*   **STT Engine:** `faster-whisper` (CTranslate2 backend). OpenAI'nin Whisper modelinin optimize edilmiş halidir. Apple Silicon üzerinde `int8` quantization ile çalışarak ~%300 performans artışı sağlar.
*   **VAD (Voice Activity Detection):** `webrtcvad` tabanlı özel bir wrapper. Sessizlik anlarında Whisper'ı çalıştırmayarak CPU tasarrufu (Idle durumunda %1 kullanım) sağlar.
*   **Translation:** Hibrit Çeviri Sistemi.
    *   *Primary:* Google Translate (Private API wrapper).
    *   *Fallback:* Argos Translate (Offline NMT).

### Threading Model
UI bloklanmasını önlemek için Python tarafında **Producer-Consumer** modeli uygulanmıştır:
1.  `_audio_thread`: BlackHole'dan ham ses verisini (PCM) okur ve `queue`'ya atar.
2.  `_process_thread`: Kuyruktan veriyi alır, VAD kontrolü yapar ve Whisper'a gönderir.

---

## ⚡ 2. IPC & Communication (ZeroMQ)

Standart `stdio` (stdin/stdout) iletişimi yüksek frekanslı ses verisi akışı için yetersiz kalacağından, endüstri standardı **ZeroMQ (ZMQ)** tercih edilmiştir.

### Protocol
*   **Pattern:** Publisher-Subscriber (PUB/SUB)
*   **Adres:** `tcp://127.0.0.1:5556`
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
`electron/main.ts` dosyasında şu satır sihirli dokunuşu yapar:

```typescript
win.setContentProtection(true);
```

Bu Electron API'si, arkaplanda macOS'un native `NSWindow.setSharingType(NSWindowSharingNone)` metodunu çağırır. Bu şu anlama gelir:
*   Pencere framebuffer'a çizilir (Kullanıcı görür).
*   Ancak `CGWindowListCreateImage` gibi ekran yakalama API'leri bu pencereyi **render etmeyi reddeder** (Şeffaf veya yok sayılır).
*   Sonuç: Zoom, Teams, OBS, QuickTime, Screenshot araçları pencereyi göremez.

---

## 👆 4. Interactive Click-Through (Smart Overlay)

Pencere tam ekran (`fullscreen`) olsa da, kullanıcı arkadaki uygulamalara (örn. Browser, IDE) tıklayabilmelidir. Ancak altyazı metnini seçebilmesi veya butonlara basabilmesi de gerekir.

Bu paradoks `useInteractiveZones` hook'u ile çözülmüştür:

1.  **Polling:** React tarafı her 200ms'de bir butonların ve metinlerin koordinatlarını (`rect`) hesaplar.
2.  **IPC Sync:** Bu koordinatları Main process'e gönderir.
3.  **Hole Punching:** Main process, bu koordinatlar **dışındaki** her yeri `setIgnoreMouseEvents(true, { forward: true })` yapar.

Böylece; butonun üzerine gelince mouse olaylarını Electron yakalar, boşluğa gelince tıklama arkadaki pencereye "düşer" (pass-through).

---

## 🧪 Testing Strategy

*   **Unit Tests:** Vitest + JSDOM (`src/__tests__`). UI bileşenlerinin ve mantığının testi.
*   **E2E (Planned):** Playwright Electron desteği ile tam entegrasyon testi.
*   **Security Audit:** OWASP standartlarına göre `webSecurity`, `contextIsolation` kontrolleri.
