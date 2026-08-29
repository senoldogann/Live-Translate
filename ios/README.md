# iOS — Stealth Translate (Faz 1: Mikrofon + On-device STT)

macOS "Stealth Subtitle Translator" konseptinin iOS sürümü. **Faz 1** dikey dilimi:

```
Mikrofon → VAD → whisper.cpp (cihazda, offline) → cümle birleştirme → canlı altyazı
```

- ✅ Konuşma tanıma **tamamen cihazda** çalışır — ses cihazdan çıkmaz, internet gerekmez.
- ✅ Çeviri boru hattı mimarisi hazır (`TranslationProviding`); şu an *passthrough*
  (orijinal metin gösterilir). Bulut çevirisi (DeepL/Azure) Faz 3'te eklenir.
- ✅ Altyazı UI: glassmorphism panel, karaoke vurgusu (metin sadece büyür, silinip
  yeniden yazılmaz), ayarlardan yazı boyutu / arka plan opaklığı.
- ✅ Model yönetimi: `tiny` (~75 MB) ve `base` (~142 MB) HuggingFace'ten uygulama
  içinden indirilir, Application Support'da önbelleğe alınır.
- ✅ **Faz 2 — Live Activity**: dinlerken kilit ekranı + Dynamic Island'da canlı
  çeviri (`SubtitleLiveActivity` widget extension). Uygulama arka plana alınsa da
  mikrofon (`UIBackgroundModes: audio`) ve Activity güncellemeleri devam eder;
  partial güncellemeler 2 saniyede bir bütçeye uyumlu şekilde throttl'lanır.

## Repo yapısı

```
ios/
├── Core/                        # Saf Swift çekirdek (platform bağımsız, test edilebilir)
│   ├── Sources/LiveTranslateCore/
│   │   ├── SentenceAssembler.swift    # engine.py'den port edilen cümle birleştirme mantığı
│   │   ├── LiveSubtitleModel.swift    # saf altyazı durum modeli
│   │   ├── PCMUtils.swift             # mono mix / resample / RMS / int16→float
│   │   └── VoiceActivityDetector.swift# enerji tabanlı VAD (engine.py fallback portu)
│   └── Tests/LiveTranslateCoreTests/  # 35 birim testi
├── App/                          # SwiftUI app (XcodeGen)
│   ├── project.yml               # proje tanımı — xcodegen generate
│   ├── Sources/
│   │   ├── StealthTranslateApp.swift
│   │   ├── ContentView.swift           # ana ekran + kontroller
│   │   ├── SubtitleOverlayView.swift   # glassmorphism + karaoke
│   │   ├── SettingsView.swift          # model indirme, dil, görünüm
│   │   ├── SubtitlePipeline.swift      # orkestratör (VAD→STT→assembler→model)
│   │   ├── STTEngine.swift             # whisper.cpp C API wrapper
│   │   ├── AudioSessionManager.swift   # mikrofon izni + 16kHz mono yakalama
│   │   ├── ModelManager.swift          # HF model indirme/önbellek
│   │   ├── SubtitleViewModel.swift     # SwiftUI köprüsü
│   │   └── TranslationProvider.swift   # çeviri protokolü (passthrough)
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

İlk çalıştırmada: Ayarlar → modeli indir (Tiny önerilir) → ana ekranda **başlat**'a dokun
→ mikrofon iznine izin ver.

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
cd ios/Core && swift test   # 35 test
```

## Önemli notlar

- **`whisper.spm` kullanmıyoruz** — arşivlendi; resmi yol whisper.cpp'den XCFramework
  üretmek (`build-xcframework.sh`'in iOS'a indirgenmiş hali). Çalışan upstream sürümü
  `scripts/build-whisper-ios-xcframework.sh` ile yeniden üretilebilir.
- `ios/Vendor/` ve üretilen `.xcodeproj` gitignore'da. Projeyi açmadan önce iki build
  adımını çalıştır.
- Ggml model dosyaları repoya asla girmez — uygulama içinden indirilir.
- Faz 2 (Live Activity), Faz 3 (Broadcast Extension + bulut STT + PiP) ve Faz 4 (çağrılar +
  App Store) için tasarım ve plan: `docs/superpowers/specs/2026-08-29-ios-subtitle-translation-design.md`
  ve `docs/superpowers/plans/2026-08-29-ios-subtitle-translation.md`.

## iOS platform gerçekleri (kısaca)

- iOS, üçüncü parti uygulamaların diğer uygulamaların üstüne **overlay** bindirmesine izin
  vermez. Bu yüzden Faz 1 mikrofon senaryosunda altyazı **uygulama içinde**; ileride kilit
  ekranı (Live Activity) ve video üstü (PiP) katmanları eklenecek.
- Cihaz sesi (YouTube/video) ve çağrı senaryoları ReplayKit Broadcast Extension + bulut STT
  gerektirir (Faz 3).
