# iOS Subtitle Translation — Tasarım Dokümanı

Tarih: 2026-08-29
Durum: Onaya hazır (araştırma bulguları işlendi)

## Amaç

macOS "Stealth Subtitle Translator"ın canlı, çevirili altyazı deneyimini iOS'a taşımak.
iOS platform kısıtları göz önüne alınarak üç ana senaryo hedeflenir:

1. **Yüz yüze konuşma / ortam sesi** (mikrofon)
2. **Cihaz sesi** (YouTube, video, stream) — ReplayKit Broadcast Extension
3. **Video çağrıları** (Zoom/Meet/FaceTime) — Broadcast Extension + PiP

## Pazar & Rakip Araştırması (web, Ağu 2026)

**Kavram kanıtlanmış — ama iOS'ta herkes aynı kısıtla boğuşuyor:**

| Rakip | Platform | Yöntem | Öğrenilen |
|---|---|---|---|
| **Whisperr** | Android + iOS + web | MediaProjection (Android) ses yakalama + "display over other apps" overlay + 100+ dil çeviri | Android'de tam konsept çalışıyor; iOS'ta overlay yok → kendi içinde / PiP |
| **Transync AI** | iOS + macOS + Windows | **PiP** penceresinde yüzen çift dilli altyazı (60+ dil) | iOS'ta PiP = meşru overlay karşılığı — kanıtlanmış model |
| **Google Live Caption** | Android (sistem) | Aynı dil altyazı, **çeviri yok** | Farkımız çeviri katmanı |
| **Apple Live Captions** | iOS (sistem) | Sistem altyazı, çeviri yok; 3. parti API **yok** | Apple kapalı; kendi app'imizle rekabet değil, tamamlayıcı |
| **Apple Live Translation (iOS 26)** | iOS (sistem) | Apple Intelligence; yalnız kendi uygulamaları (Messages/Phone), API yok | 3. parti app'ler erişemiyor |
| **LiveCaptionN** | Android (OSS) | On-device ASR + sistem sesi | On-device + cihaz sesi Android'de mümkün |

**Çıkarımlar:**
- Android: `MediaProjection` (ses) + `TYPE_APPLICATION_OVERLAY` (üstte pencere) → konsept birebir çalışır (Whisperr kanıtı).
- iOS: üçüncü parti overlay **yasağı kesin** (App Store kuralı, 8 yıldır değişmedi). Meşru karşılıklar: **PiP** (Transync kanıtı) + **Live Activity** (kilit ekranı) + **uygulama içi**.
- On-device Whisper mobilde hazır: `whisper.cpp` (C/C++) → React Native (`whisper.rn`), Flutter (`whisper_cpp_flutter_plus`), Swift (SPM) binding'leri mevcut. Silero VAD de taşınabilir.

## Kritik Platform Gerçekleri

- iOS, üçüncü parti uygulamaların diğer uygulamaların **üzerine bindirme (overlay)** yapmasına
  izin vermez. Tek meşru karşılıklar: Picture-in-Picture (PiP) ve Apple'ın kendi Live Captions/Live
  Activity sistemleri.
- Cihaz sesini yakalamanın meşru yolu: **ReplayKit Broadcast Extension** — kullanıcı sistem
  picker'ına dokunur. Extension ayrı süreçte, ~50MB RAM limitli, Audio Units yasak — burada
  ağır on-device Whisper çalışamaz.
- **Mikrofon** tamamen açıktır → on-device whisper.cpp burada çalışır (offline, gizlilik).
- Uygulamanın "kötü amacı olmaması" Apple'ın API kısıtlarını değiştirmez; stealth (ekrandan
  gizleme) iOS'ta yoktur. Gizlilik vaadi yerine görünür, kullanıcı dostu altyazı odaklıyız.
- iOS 16.1+ **Live Activity** (ActivityKit) + iOS 15+ **PiP custom content source** mevcut;
  minimum hedef iOS 16.1.

## Genel Mimari (Yaklaşım A — "Üç Akış, Üç Ekran")

Tek uygulama, ses kaynağına göre çıktı katmanı değişir.

```
                    ┌─────────────────────────────────────────────┐
                    │            SwiftUI iOS Uygulaması           │
  ┌─────────┐       │  ┌──────────────┐   ┌──────────────────┐   │
  │ Multi-  │       │  │  Ses Katmanı │   │  Çıktı Katmanı    │   │
  │ Platform│  WS   │  │              │   │                  │   │
  │  Server │◄─────►│  │ · Mikrofon    │──►│ · Uygulama içi    │   │
  │ (STT +  │       │  │ · Broadcast   │   │ · Live Activity   │   │
  │  DeepL) │       │  │   Ext (cihaz) │   │ · PiP penceresi   │   │
  └─────────┘       │  └──────┬───────┘   └──────────────────┘   │
                     │         │                                 │
                     │  ┌──────▼────────┐                        │
                     │  │  Hibrit STT   │                        │
                     │  │ whisper.cpp   │                        │
                     │  │ (lokal) · Bulut│                       │
                     │  └───────────────┘                        │
                     └─────────────────────────────────────────────┘
```

## Mimari Kararlar (kullanıcı onaylı)

| Karar | Seçim | Gerekçe |
|---|---|---|
| Senaryo | 3 senaryonun tamamı (mikrofon + cihaz + çağrı) | Kullanıcı talebi |
| STT stratejisi | Hibrit (lokal whisper.cpp + bulut) | Mikrofon offline; cihaz sesi 50MB limit → bulut |
| Kapsam | Tam kapsam (karaoke, geçmiş, ayarlar) | Kullanıcı talebi |
| Teknik yığın | SwiftUI + native modüller | Broadcast ext/Live Activity/PiP native zorunlu |
| Yaklaşım | A — "Üç Akış, Üç Ekran" | Her senaryoya iOS'un izin verdiği en iyi çıktı |

## Mevcut Kodun Taşınabilirlik Envanteri (context-manager + dosya analizi)

| macOS parçası | Taşınır mı? | Nasıl |
|---|---|---|
| `python/engine.py` — TranscriptionEngine, TranslationEngine, SentenceAssembler mantığı | ✅ Çekirdek mantık | Sunucuda yeniden kullanılır (LTS Server); Swift'e port gerekmez |
| `python/azure_translation_engine.py`, `deepgram_engine.py` | ✅ | Sunucuda kalır |
| VAD (webrtcvad) | ✅ | Sunucuda; mobilde Silero VAD |
| ZMQ IPC (engine ↔ Electron) | ⚠️ | Sunucu tarafında WebSocket'e çevrilir |
| React UI (karaoke, cümle akışı, glassmorphism) | ⚠️ Kavramsal | SwiftUI'da yeniden yazılır; UX mantığı birebir taşınır |
| Electron main (BlackHole, setContentProtection, globalShortcut) | ❌ | iOS'ta yok; Broadcast ext + mikrofon ile değişir |

**Sonuç:** Kodun ~%30'u (çekirdek STT/çeviri/VAD) sunucuda yeniden kullanılır; UI tamamen SwiftUI'da yeniden yazılır.

## Ses Akışı ve Broadcast Extension

```
 ┌─ MİKROFON ──────────────► AVAudioSession + AVAudioEngine
 │                           (her zaman açık, izin: mikrofon)      ─┐
 │                                                                │ PCM 16kHz mono
 │ ┌─ CİHAZ SESİ ──────────► ReplayKit Broadcast Extension          │
 │ │  (YouTube/video)         · kullanıcı sistem picker'a dokunur   │  ┌──────────────┐
 │ │  · 50MB limit            · ekran+ses yakalanır                ├─►│ Normalize     │
 │ │  · Audio Units YASAK     · app group üzerinden ana app'e akıt │  │  ses akışı   │
 │ └───────────────────────────────────────────────────────────────┘  └──────┬───────┘
 │ ┌─ ÇAĞRILAR ────────────► aynı broadcast yakalama                        │
 │ └────────────────────────  (karşı taraf sesi → PiP)                       ▼
 └─────────────────────────────────────────────────────────────────► Hibrit STT seçici
```

- **Bir seferde tek kaynak** modeli: mikrofon + cihaz sesi aynı anda alınırsa hoparlör feed'i
  mikrofona karışır.
- Broadcast Extension → ana uygulama: **App Group + dairesel tampon** (append-only log veya
  localhost UDP socket). Gecikme hedefi: **2-4 sn uçtan uca** (macOS ile benzer).

## Bileşenler (izolasyon ilkesi)

1. **`STTEngine`** — Swift `whisper.cpp` wrapper; mikrofon için cihazda. PCM→metin.
2. **`CloudSTTClient`** — sunucuya PCM akışı; cihaz sesi/çağrılar. WebSocket.
3. **`TranslationClient`** — sunucudan çeviri iste.
4. **`SentenceAssembler`** — taşınan mantık: cümle birleştirme, streaming partial/final.
5. **`LiveSubtitleModel`** — UI/servis bağımsız saf altyazı durum modeli (kolay test).

## Çıktı Katmanları

| Çıktı | API | Senaryo | Not |
|---|---|---|---|
| Uygulama içi altyazı | SwiftUI | Mikrofon (ortam dinle) | Ayarlar/geçmiş/teker |
| Live Activity | ActivityKit (iOS 16.1+) | Mikrofon, arka planda | Kilit ekranı + Dynamic Island |
| PiP penceresi | AVPictureInPictureController.customContentSource | Cihaz sesi + çağrılar | Overlay'in meşru karşılığı |
| Geçmiş / export | SwiftUI liste | Tüm senaryolar | macOS transcript history karşılığı |

## Veri Akışı

1. Kullanıcı kaynak seçer (mikrofon / cihaz / çağrı).
2. Ses yakalanır, normalize edilir, PCM 16kHz mono.
3. STT seçici: mikrofon→lokal whisper.cpp; cihaz/çağrı→bulut.
4. Metin → SentenceAssembler → (gerekirse) çeviri → LiveSubtitleModel.
5. LiveSubtitleModel → seçili çıktı katmanı (uygulama içi / Live Activity / PiP).

## Hata Yönetimi & Yaşam Döngüsü

- **İzinler**: mikrofon (her zaman), ReplayKit broadcast (kullanıcı picker), Live Activity (onay).
- **App Store şartları**: Broadcast Extension yalnızca user-initiated; sessiz arka plan kaydı yok.
- **Hata kategorileri**: izin reddi (yönlendirme), sunucu offline (lokal fallback), STT boş (VAD),
  bulut kota aşımı (uyarı).
- **Arka plan**: aktif dinleme + Live Activity güncellemesi; iOS kısıtlarına uyar.

## Riskler ve Azaltma

| Risk | Olasılık | Etki | Azaltma |
|---|---|---|---|
| App Store inceleme reddi (PiP/extension kuralları) | Orta | Yüksek | Faz 4'te inceleme ön kontrol listesi; user-initiated şartına sıkı uyum |
| Broadcast Extension 50MB limit aşımı | Orta | Yüksek | Extension'da yalnız hafif yakalama; tüm STT ana app/sunucu |
| Live Activity arka plan güncelleme limitleri (spor/bilet kategorisi dışı) | Orta | Orta | Uygulama içi + Live Activity karması; kilit ekranı metni statik tut |
| Sunucu maliyeti (bulut STT) | Yüksek | Orta | Çift mod: mikrofon lokal (ücretsiz); cihaz/çağrı bulut; kota uyarıları |
| Ses karışması (hoparlör + mikrofon) | Yüksek | Orta | Tek kaynak modeli; kullanıcı seçimi |
| Apple API değişikliği (iOS 27+) | Düşük | Orta | API soyutlama katmanı (AudioSource protokolü) |

## Test Stratejisi

- **Birim**: whisper.cpp wrapper (sentetik PCM), SentenceAssembler (cümle birleştirme),
  LiveSubtitleModel (saf mantık).
- **Entegrasyon**: Broadcast Extension ↔ App Group akışı, sunucu WS.
- **E2E**: gerçek cihaz — mikrofon + kısa video klibi (XCUITest).
- **Manuel**: App Store inceleme hazırlığı (Live Activity, PiP, extension kuralları).

## Yol Haritası (ileri)

- Faz 1: SwiftUI iskelet + mikrofon + lokal whisper.cpp + uygulama içi altyazı
- Faz 2: Live Activity (kilit ekranı)
- Faz 3: Broadcast Extension + bulut STT + PiP (cihaz sesi)
- Faz 4: Çağrı senaryosu + geçmiş/export + App Store hazırlığı
