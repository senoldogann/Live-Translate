# App Store İnceleme Ön Kontrol Listesi — iOS (v1.0)

Bu liste, iOS uygulamasını App Store'a göndermeden önce her sürümde taranması
gereken kuralları toplar. Üç yüksek riskli alan var: **Broadcast Extension**,
**PiP (video dışı içerik)** ve **Live Activity** — Apple bunları normalden daha
dikkatli inceler.

## 1. Zorunlu yapılandırma (reddedilmeden önce)

| Kontrol | Durum | Açıklama |
|---|---|---|
| `RPBroadcastProcessMode = RPBroadcastProcessModeSampleBuffer` | ✅ Info.plist'te | Broadcast extension'da; eksikse ITMS hatası |
| `NSExtensionPointIdentifier = com.apple.broadcast-services-upload` | ✅ | Extension noktası |
| App Group her iki target'ta | ✅ | `group.com.stealth.subtitle.translator` |
| `UIBackgroundModes: [audio]` | ✅ | PiP + canlı etkinlik için gerekli |
| `NSMicrophoneUsageDescription` | ✅ | Türkçe açıklama mevcut |
| **Privacy manifest** (app + extension) | ✅ | `PrivacyInfo.xcprivacy` — UserDefaults (CA92.1, 1C8F.1) + FileTimestamp (C617.1, DDA9.1); ses verisi beyanı |
| `NSSupportsLiveActivities` + FrequentUpdates | ✅ | Info.plist'te |

## 2. PiP — "video dışı içerik" riski (en kritik)

Apple, PiP'i yalnızca hareketli video ve gerçek zamanlı çağrılar için kabul
eder. Altyazı penceresi bu kategoriye girmiyor; canlı altyazı uygulamaları
(Minispeech, Transync) bu yoldan geçti ancak **her inceleme ayrı bir risk**.

İnceleme notuna (App Store Connect → App Review Notes) mutlaka yaz:

> "The Picture-in-Picture window displays real-time captions of the device's
> audio (e.g. a video playing in another app). The app is a live-caption tool;
> the PiP window shows the translated subtitles so the user can read them while
> using other apps. There is no overlay on other apps' UI; captions are visible
> in the system PiP window only."

Reddedilme durumunda: PiP'i kaldırıp yalnızca uygulama içi altyazı + Live
Activity ile devam etmek geri dönüş yolu olarak hazır.

## 3. Broadcast Extension — inceleme kuralları

- Extension **50 MB bellek sınırı**: video karelerine dokunmuyoruz, ses küçük
  tamponlarla işleniyor — aşırı bellek kullanımı reddedilme sebebidir.
- `broadcastFinished` içinde temiz kapanma (bağlantı kapat, bellek bırak) — iOS
  yavaş kapanan extension'ları işaretler.
- Kullanıcı izni olmadan mikrofon/kamera açılmıyor; yayın yalnızca sistem
  seçici (RPSystemBroadcastPickerView) ile başlıyor.

## 4. Live Activity — kurallar

- Live Activity içeriği canlı ve bilgilendirici olmalı — altyazı buna uygun.
- Dinleme durunca Activity hemen kapatılıyor (`end()`), canlı olmayan içerik
  kilit ekranında kalmamalı.
- Frequent updates (NSSupportsLiveActivitiesFrequentUpdates) yalnızca gerçekten
  sık güncelleme gerektiren içerik için — altyazı buna uygun.

## 5. Gizlilik beyanı (App Store Connect)

Uygulama sayfasında "Privacy Nutrition Labels" bölümü:

- **Kullanıcıya bağlı olmayan veriler**: Mikrofon sesi (yalnızca cihazda
  işlenir; bulut modunda STT için LTS sunucusuna iletilir)
- **İzleme (tracking)**: Yok (`NSPrivacyTracking = false`)
- Veri saklama süresi: cihazda geçici; kullanıcı silme hakkı — transcript
  geçmişi yalnızca cihazda.

## 6. Gönderim öncesi son kontroller

- [ ] Simulator + fiziksel cihazda temiz başlangıç (crash yok)
- [ ] Mikrofon izni reddedildiğinde dostça hata mesajı
- [ ] LTS sunucu kapalıyken yayın → kullanıcıya anlaşılır hata ("sunucuya
      bağlanılamadı") + lokal moda geçiş önerisi
- [ ] İnceleme videosu: mikrofon senaryosu (uygulama içi altyazı) + yayın
      senaryosu (PiP) — inceleme ekibinin çalışan akışı görmesi gerekir
- [ ] `privacy manifest`'in bundle içinde doğrulanması:
      `codesign` sonrası `MyApp.app/PrivacyInfo.xcprivacy` mevcut
- [ ] App icon + tüm ekran görüntüleri (6.7" ve 6.1" boyutları)
- [ ] Sürüm numarası + build numarası artırıldı
- [ ] TestFlight beta: TestFlight dışındaki API'lere erişim yok (App Store
      build'i aynı davranmalı)

## 7. Bilinen reddedilme senaryoları ve hazırlık

| Senaryo | Yanıt |
|---|---|
| "PiP non-video content" reddi | App Review Notes'ta canlı altyazı açıklaması; gerekirse PiP'i kaldır |
| "Background modes without usage" | `audio` gerçekten kullanılıyor (mikrofon + PiP) — açıklama notuna ekle |
| "Broadcast extension crash (jetsam)" | 50 MB disiplini; iPad Pro'da mutlaka test |
| Privacy manifest eksik (ITMS-91053/91061) | Bu kontrol listesindeki manifest her iki bundle'da |
