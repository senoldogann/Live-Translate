# Hardened Runtime — Durum Notu

## Özet
Üretim DMG şu an **Hardened Runtime kapalı** (`package.json` → `mac.hardenedRuntime: false`).
Bu, notarization için **engel değildir** (Apple, Developer ID imzası + notarization'ı hardened
olmadan da kabul eder). Ancak dağıtım güvenliği için hardened tercih edilir — aşağıdaki
araştırma notu saklanır.

## Gözlem (bu geliştirme makinesinde, Ağustos 2026)
- Electron 33 ve 38'de, **Developer ID + Hardened Runtime** imzalı app,
  `v8::Isolate::Initialize` içinde şu hatayla çöküyordu:
  ```
  Fatal process out of memory: Failed to reserve virtual memory for CodeRange
  ```
- Aynı binary **adhoc (hardened'sız)** imzalıyken sorunsuz çalışıyordu.
- JIT entitlement'ları (`allow-unsigned-executable-memory`,
  `disable-executable-page-protection`, `disable-library-validation`) ana exe'ye
  imzalandı ve `codesign --verify --deep --strict` temizdi; buna rağmen hardened'ta crash devam etti.
- `--js-flags=--jitless` hardened'ta app'i açtı → sorun, V8 JIT'in executable bellek
  ayırmasıyla hardened runtime'ın macOS tarafındaki etkileşimine özgü.

## Karar
- **Şimdilik:** `hardenedRuntime: false` ile yayın. Notarization + stapler bu imzayla yapılabilir.
- **Başka bir M-serisi makinede** hardened'ı tekrar deneyin (`hardenedRuntime: true` +
  mevcut entitlements). Sorun bu makineye özel ise hardened'ı kalıcı açın.
- Notarization sırasında hardened'sız imzanın Gatekeeper'ı geçtiğini `spctl` ile doğrulayın.

## Kaynaklar
- `build/entitlements.mac.plist` — mevcut izin seti (JIT + native libs için hazır).
- `scripts/notarize.sh` — notarization akışı.
