# iOS Subtitle Translation — Uygulama Planı

Tarih: 2026-08-29
Kaynak spec: docs/superpowers/specs/2026-08-29-ios-subtitle-translation-design.md
Durum: Onaya hazır

## Genel Bakış

SwiftUI iOS uygulaması; üç ses kaynağı (mikrofon / cihaz sesi / çağrı), hibrit STT
(whisper.cpp lokal + bulut sunucu), üç çıktı katmanı (uygulama içi / Live Activity / PiP).
Mevcut macOS çekirdeği (engine.py) çok platformlu sunucuda yeniden kullanılır.

## Fazlar ve Görevler

### Faz 1 — SwiftUI İskelet + Mikrofon (2-3 hafta)

**Amaç:** Çalışan ilk dikey dilim: mikrofon → lokal whisper.cpp → uygulama içi canlı altyazı.

- [ ] **1.1** Xcode projesi + SwiftUI App + workspace kurulumu (minimum iOS 16.1)
- [ ] **1.2** `LiveSubtitleModel` (saf Swift, test edilebilir): partial/final durumu, cümle birleştirme
- [ ] **1.3** `SentenceAssembler`: macOS'tan taşınan cümle birleştirme mantığı (Swift port)
- [ ] **1.4** `AudioSessionManager`: mikrofon izni + AVAudioEngine PCM 16kHz mono yakalama
- [ ] **1.5** `STTEngine`: whisper.cpp SPM entegrasyonu + `tiny`/`base` model yönetimi
- [ ] **1.6** Altyazı UI: glassmorphism görünümü, karaoke kelime vurgusu, font/opaklık
- [ ] **1.7** Ayarlar ekranı: dil çifti, model boyutu, görünüm tercihleri
- [ ] **1.8** Birim testleri: LiveSubtitleModel + SentenceAssembler (sentetik PCM)
- [ ] **1.9** Gerçek cihaz doğrulama: mikrofonla canlı çeviri akışı

**Çıkış:** `TestFlight`'ta çalışan mikrofon çevirisi; gecikme < 3 sn.

### Faz 2 — Live Activity (1 hafta)

**Amaç:** Kilit ekranı + Dynamic Island'da canlı çeviri (arka planda iken).

- [ ] **2.1** ActivityKit widget + Attributes/ContentState modelleri
- [ ] **2.2** LiveSubtitleModel → Activity güncelleme köprüsü (Activity<...> push)
- [ ] **2.3** Kilit ekranı UI: son cümle + çeviri satırı
- [ ] **2.4** Arka plan davranışı: mikrofon devam ederken Activity günceller
- [ ] **2.5** Test: uygulama arka planda iken kilit ekranında canlı çeviri

### Faz 3 — Broadcast Extension + Bulut STT + PiP (2-3 hafta)

**Amaç:** Cihaz sesi (YouTube/video) ve çağrı senaryoları; PiP penceresinde altyazı.

- [ ] **3.1** Çok platformlu sunucu (LTS Server): engine.py çekirdeğini servis yap (WS)
  - `STT` uç noktası (faster-whisper) + `translate` uç noktası (DeepL/Argos)
  - Auth (API key) + kota sayacı
- [ ] **3.2** ReplayKit Broadcast Extension (app group, dairesel tampon)
- [ ] **3.3** Extension → ana app PCM akışı (App Group / UDP localhost)
- [ ] **3.4** `CloudSTTClient`: WS üzerinden sunucuya ses akışı + partial/final alımı
- [ ] **3.5** `TranslationClient`: sunucudan çeviri
- [ ] **3.6** PiP controller: `AVPictureInPictureController.customContentSource` + altyazı view
- [ ] **3.7** Entegrasyon testi: kısa YouTube klibi → PiP'te çevirili altyazı

**Çıkış:** Cihaz sesi senaryosu çalışıyor; uçtan uca gecikme 2-4 sn.

### Faz 4 — Çağrılar + Geçmiş + App Store (2 hafta)

**Amaç:** Video çağrısı senaryosu, transcript geçmişi/export, App Store hazırlığı.

- [ ] **4.1** Çağrı senaryosu: broadcast yakalama + PiP (karşı taraf sesi)
- [ ] **4.2** Transcript geçmişi (liste, tarih filtre, export: TXT/SRT)
- [ ] **4.3** Hata durumları: izin reddi, sunucu offline (lokal fallback), kota uyarısı
- [ ] **4.4** App Store inceleme ön kontrol listesi (PiP + extension + Live Activity kuralları)
- [ ] **4.5** App icon, screenshots, privacy manifest (gerekliyse)
- [ ] **4.6** TestFlight beta + inceleme gönderimi

**Çıkış:** App Store'a gönderilebilir v1.0.

## Bağımlılıklar

```
Faz 1 → Faz 2 (Live Activity, mikrofon üzerinde)
Faz 1 → Faz 3 (server, mikrofon çekirdeği önce çalışmalı)
Faz 3 → Faz 4 (çağrı senaryosu broadcast üzerinde)
```

## Teknik Kararlar (özet)

- **whisper.cpp**: SPM package (github.com/ggerganov/whisper.cpp) — model `tiny`/`base` cihazda,
  `small`/`medium` isteğe bağlı indirme
- **Sunucu**: FastAPI (Python) + WebSocket; engine.py çekirdeği import edilir; Docker image
- **PiP**: `AVPictureInPictureController` + `customContentSource` (iOS 15+)
- **Live Activity**: ActivityKit (iOS 16.1+); arka plan güncellemeleri için BGTask + push takviyesi
- **App Group**: `group.com.stealth.subtitle.translator` — extension veri paylaşımı

## Test Matrisi

| Katman | Araç | Kapsam |
|---|---|---|
| Swift birim | XCTest | LiveSubtitleModel, SentenceAssembler, PCM normalize |
| Python sunucu | pytest | engine.py portu (mevcut 34 test korunur + WS uç noktaları) |
| Entegrasyon | XCUITest | mikrofon→altyazı, extension→app akışı |
| E2E (cihaz) | Manuel + XCUITest | kısa video klibi, çağrı senaryosu |
| App Store | Kontrol listesi | PiP, extension, Live Activity, gizlilik |

## Risk Karşılıkları (spec'ten)

- App Store reddi → Faz 4 kontrol listesi, user-initiated uyumu
- 50MB limit → extension yalnız yakalar, iş ana app/sunucuda
- Sunucu maliyeti → mikrofon lokal (ücretsiz), bulut kota uyarıları
