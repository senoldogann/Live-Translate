# Hardened Runtime — Notlar

## Durum (Ağustos 2026)

Üretim DMG'si **Hardened Runtime açık** (`package.json` → `mac.hardenedRuntime: true`) ve
notarize edilmiş durumda. `spctl --assess --type execute` → `accepted, source=Notarized
Developer ID`.

## Yaşanan sorun ve çözümü

- Electron 33 ve 38'de, **Developer ID + Hardened Runtime** imzalı uygulama
  `v8::Isolate::Initialize` içinde şu hatayla çöküyordu:

  ```
  Fatal process out of memory: Failed to reserve virtual memory for CodeRange
  ```

- Aynı binary **adhoc (hardened'sız)** imzalıyken sorunsuz çalışıyordu.
- İlk denemede yalnızca `allow-unsigned-executable-memory`,
  `disable-executable-page-protection`, `disable-library-validation` entitlement'ları
  eklendi; crash sürdü.
- **Kök neden:** eksik `com.apple.security.cs.allow-jit` entitlement'ı. V8'in JIT ile
  executable bellek ayırması, hardened runtime altında bu izin olmadan reddediliyor.

**Kalıcı çözüm:** `build/entitlements.mac.plist` içine `com.apple.security.cs.allow-jit`
ve `com.apple.security.device.audio-input` eklendi. Hardened Runtime açık, uygulama
crash'siz çalışıyor ve notarization kabul ediliyor.

## Not

Bu not, ileride aynı crash'le karşılaşılırsa diye saklanır. Eğer yeni bir makinede
CodeRange hatası görülürse önce `allow-jit` entitlement'ının imzada olduğunu kontrol edin.
