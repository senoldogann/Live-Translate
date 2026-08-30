# iOS — Stealth Translate (Faz 1–3: Mikrofon + On-device STT + Live Activity + Yayın/PiP)

macOS "Stealth Subtitle Translator" konseptinin iOS sürümü. Tamamlanan dikey dilimler:

```
Mikrofon → VAD → whisper.cpp (cihazda, offline) → cümle birleştirme → canlı altyazı        (Faz 1)
Aynı altyazı, kilit ekranı + Dynamic Island'da (Live Activity)                                (Faz 2)
Cihaz sesi (YouTube/video/çağrı) → Broadcast Extension → LTS bulut sunucusu → PiP penceresi    (Faz 3)
```

- ✅ **Faz 1** — Konuşma tanıma tamamen cihazda (whisper.cpp, offline); ses cihazdan çıkmaz.
- ✅ **Faz 2** — Live Activity: kilit ekranı + Dynamic Island'da canlı çeviri; `UIBackgroundModes: audio`
  ile arka planda da devam eder.
- ✅ **Faz 4** — Transcript geçmişi (TXT/SRT export, tarih gruplama), yayın hata mesajları,
  Privacy manifest (app + extension), App Store inceleme kontrol listesi
  (`docs/app-store-review-checklist.md`).
- ✅ **Faz 3** — Cihaz sesi senaryosu:
  - **LTS Server** (`python/lts_server.py`): macOS `engine.py` çekirdeğini WebSocket servisi olarak
    sunar — istemci 16 kHz mono int16 PCM akıtır, partial/final + çeviri segmentleri geri alır.
    Auth (API key) destekli, 14 birim testi + WS e2e testi.
  - **Broadcast Extension** (`Sources/BroadcastExtension/`): ReplayKit `RPBroadcastSampleHandler`,
    `.audioApp` (cihaz sesi) akışını 16 kHz mono int16'ya çevirir (AVAudioConverter — Audio Units
    yasak) ve **doğrudan LTS'e** WebSocket açar; ana uygulama askıya alınsa bile çalışır.
  - **App Group + SegmentRelay**: segmentler JSONL dosyasıyla uygulamaya iletilir (Darwin
    notification ile anında uyandırma). `SharedLTSConfig` (sunucu adresi, API anahtarı, dil çifti)
    uzantıyla paylaşılır.
  - **PiP penceresi** (`PipSubtitleController`): `AVPictureInPictureController.ContentSource(
    sampleBufferDisplayLayer:)` ile altyazı metni düşük kare hızında PiP'e çizilir — arka planda
    yüzen çeviri penceresi.
  - **Tetikleyici**: `RPSystemBroadcastPickerView` (iOS 18+'da tek desteklenen yol), ayarlardan
    sunucu adresi + API anahtarı girilir.

## Repo yapısı

```
ios/
├── Core/                        # Saf Swift çekirdek (platform bağımsız, test edilebilir)
│   ├── Sources/LiveTranslateCore/
│   │   ├── SentenceAssembler.swift    # engine.py'den port edilen cümle birleştirme mantığı
│   │   ├── LiveSubtitleModel.swift    # saf altyazı durum modeli
│   │   ├── PCMUtils.swift             # mono mix / resample / RMS / int16→float
│   │   ├── VoiceActivityDetector.swift# enerji tabanlı VAD (engine.py fallback portu)
│   │   ├── AdaptiveVoiceActivityDetector.swift # gürültü tabanını izleyen uyarlamalı VAD
│   │   ├── TranscriptionScheduler.swift # akış zamanlama kararları (partial/final, min-yeni-ses)
│   ├── PipelineDependencies.swift  # STT/audio/model/LiveActivity protokolleri (test için injectable)
│   ├── Tests/SubtitlePipelineTests.swift # cihazsız pipeline testleri (8 test, fake'lerle)
│   │   ├── LTSClient.swift            # WS istemcisi (app + extension ortak kullanır)
│   │   ├── SharedLTSConfig.swift      # app group üzerinden paylaşılan sunucu ayarları
│   │   └── SegmentRelay.swift         # extension→app JSONL segment köprüsü
│   └── Tests/LiveTranslateCoreTests/  # 40 birim testi
├── App/                          # SwiftUI app (XcodeGen)
│   ├── project.yml               # proje tanımı — xcodegen generate
│   ├── Sources/
│   │   ├── StealthTranslateApp.swift
│   │   ├── ContentView.swift           # ana ekran + kontroller + yayın düğmesi
│   │   ├── SubtitleOverlayView.swift   # glassmorphism + karaoke
│   │   ├── SettingsView.swift          # model indirme, dil, görünüm, bulut ayarları
│   │   ├── SubtitlePipeline.swift      # orkestratör (VAD→STT→assembler→model)
│   │   ├── STTEngine.swift             # whisper.cpp C API wrapper
│   │   ├── AudioSessionManager.swift   # mikrofon izni + 16kHz mono yakalama
│   │   ├── ModelManager.swift          # HF model indirme/önbellek
│   │   ├── BroadcastMonitor.swift      # yayın durumu + segment köprüsü okuma
│   │   ├── PipSubtitleController.swift # PiP altyazı penceresi
│   │   ├── SubtitleViewModel.swift     # SwiftUI köprüsü
│   │   ├── TranslationProvider.swift   # çeviri protokolü (passthrough)
│   │   └── BroadcastExtension/         # ReplayKit broadcast uzantısı (ayrı target)
│   └── Resources/
└── Vendor/                       # (gitignore) whisper.cpp + whisper.xcframework
```

## Kurulum & Çalıştırma

**Gereksinimler:** Xcode 16+ · [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`) · CMake (`brew install cmake`)

```bash
# 1. whisper.xcframework'ü üret (iOS simulator + cihaz, statik, ~3-5 dk)
bash scripts/build-whisper-ios-xcframework.sh

# 2. Xcode projesini üret
cd ios/App && xcodegen generate

# 3. Aç ve çalıştır
open ios/App/StealthSubtitleTranslator.xcodeproj
```

**Mikrofon senaryosu (Faz 1):** İlk çalıştırmada: Ayarlar → modeli indir (Tiny önerilir) →
ana ekranda **başlat**'a dokun → mikrofon iznine izin ver.

**Cihaz sesi senaryosu (Faz 3):**
1. LTS sunucusunu çalıştır: `python python/lts_server.py` (veya kendi sunucunu dağıt).
2. Ayarlar → **Bulut & Yayın** → sunucu adresi (`ws://host:8765`) + API anahtarı (opsiyonel).
3. Ana ekranda yayın düğmesine dokun → sistem yayın seçicide "Live Translate" → başlat.
4. YouTube/videoyu oynat — altyazılar uygulama içinde ve **PiP penceresinde** görünür.

**Komut satırından simulator build:**
```bash
cd ios/App
xcodebuild -project StealthSubtitleTranslator.xcodeproj \
  -scheme StealthSubtitleTranslator \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO build
```

**Çekirdek birim testleri (Xcode gerekmez):**
```bash
cd ios/Core && swift test   # 40 test
```

**Python test suite (LTS dahil):**
```bash
cd python && .venv/bin/python -m pytest test_lts_server.py -q
```

## Önemli notlar

- **`whisper.spm` kullanmıyoruz** — arşivlendi; resmi yol whisper.cpp'den XCFramework üretmek.
  Çalışan upstream sürümü `scripts/build-whisper-ios-xcframework.sh` ile yeniden üretilebilir.
- `ios/Vendor/` ve üretilen `.xcodeproj` gitignore'da. Projeyi açmadan önce iki build adımını çalıştır.
- Ggml model dosyaları repoya asla girmez — uygulama içinden indirilir.
- **App Group** (`group.com.stealth.subtitle.translator`) hem app hem broadcast uzantısında etkin;
  gerçek cihazda çalışması için imzalama (Signing & Capabilities) gereklidir. Simulator'da app group
  yoktur — yayın/PiP senaryosu **fiziksel cihazda** test edilir.
- **Broadcast uzantısı 50 MB bellek sınırıyla** çalışır: video karelerine hiç dokunmuyoruz, ses
  dönüşümü `autoreleasepool` içinde küçük tamponlarla yapılıyor.
- **App Store riski:** PiP "video dışı içerik" için incelemede reddedilebilir (canlı altyazı
  uygulamaları — Minispeech vb. — bu yoldan geçti ama risk gerçek). Yayın senaryosu görünür
  altyazıdır, gizli/stealth değil.
- Faz 4 (çağrılar + App Store) için tasarım ve plan:
  `docs/superpowers/specs/2026-08-29-ios-subtitle-translation-design.md` ve
  `docs/superpowers/plans/2026-08-29-ios-subtitle-translation.md`.

## iOS platform gerçekleri (kısaca)

- iOS, üçüncü parti uygulamaların diğer uygulamaların üstüne **overlay** bindirmesine izin vermez.
  Bu yüzden: mikrofon senaryosu uygulama içi altyazı; cihaz sesi senaryosu kilit ekranı (Live
  Activity) + PiP penceresi — Transync ve Minispeech'in kanıtladığı model.
- Cihaz sesi (YouTube/video) ve çağrı senaryoları ReplayKit Broadcast Extension + LTS bulut
  sunucusu gerektirir (Faz 3 tamamlandı; sunucu dağıtımı kullanıcıya kalmış).
