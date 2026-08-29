# iOS Subtitle Translation — Tasarım Dokümanı

Tarih: 2026-08-29
Durum: Draft (onay bekliyor)

## Amaç

macOS "Stealth Subtitle Translator"ın canlı, çevirili altyazı deneyimini iOS'a taşımak.
iOS platform kısıtları göz önüne alınarak üç ana senaryo hedeflenir:

1. **Yüz yüze konuşma / ortam sesi** (mikrofon)
2. **Cihaz sesi** (YouTube, video, stream) — ReplayKit Broadcast Extension
3. **Video çağrıları** (Zoom/Meet/FaceTime) — Broadcast Extension + PiP

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
  localhost UDP socket). Gecikme hedefi: **2-4 sn uçtan uca**.

## Bileşenler (izolasyon ilkesi)

1. **`STTEngine`** — Swift `whisper.cpp` wrapper; mikrofon için cihazda. (ne yapar: PCM→metin;
   nasıl kullanılır: ses akışı ver; bağımlılık: whisper.cpp kütüphanesi)
2. **`CloudSTTClient`** — sunucuya PCM akışı; cihaz sesi/çağrılar. WebSocket.
3. **`TranslationClient`** — sunucudan çeviri iste.
4. **`SentenceAssembler`** — taşınan mantık: cümle birleştirme, streaming partial/final.
5. **`LiveSubtitleModel`** — UI/servis bağımlı olmayan saf altyazı durum modeli (kolay test).

## Çıktı Katmanları

| Çıktı | API | Senaryo | Not |
|---|---|---|---|
| Uygulama içi altyazı | SwiftUI | Mikrofon (ortam dinle) | Ayarlar/geçmiş/teker |
| Live Activity | ActivityKit (iOS 16.1+) | Mikrofon, arka planda | Kilit ekranı + Dynamic Island |
| PiP penceresi | AVPictureInPictureController. customContentSource | Cihaz sesi + çağrılar | Overlay'in meşru karşılığı |
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
