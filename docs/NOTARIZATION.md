# Notarization Rehberi

Notarization, Apple'a "bu uygulama güvenli" onayı aldırır ve Gatekeeper uyarısını kaldırır.
İki yöntem var — ikisi de tek seferlik kurulum gerektirir.

> Normal Apple şifreni **asla** kullanma ve kimseyle paylaşma. `notarytool` yalnızca
> aşağıdaki iki yöntemi kabul eder.

## Yöntem A — App Store Connect API Key (önerilen, şifre yok)

1. [developer.apple.com](https://developer.apple.com/account/resources/authkeys) adresine
   gidip **Certificates, Identifiers & Profiles → Keys → +** yolunu izle.
2. Adı `Notarization` koy, **"App Store Connect API"** kutusunu işaretle →
   **Continue → Download**. (`.p8` dosyası **yalnızca bir kez** indirilebilir; güvenli sakla.)
3. Key listesindeki **Key ID**'yi (örn. `ABC123DEFG`) kopyala.
4. Sayfanın üstündeki **Issuer ID**'yi (UUID formatında) kopyala.

Sonra notarize et (`.p8` yolunu, Key ID'yi ve Issuer ID'yi doldur):

```bash
xcrun notarytool submit "release/Stealth-Subtitle-Translator-1.0.0-arm64.dmg" \
  --key "/path/to/AuthKey_XXXXXXXXXX.p8" \
  --key-id "ABC123DEFG" \
  --issuer "11111111-2222-3333-4444-555555555555" \
  --wait

# Başarılıysa staple'la ve doğrula:
xcrun stapler staple "release/Stealth-Subtitle-Translator-1.0.0-arm64.dmg"
xcrun stapler validate "release/Stealth-Subtitle-Translator-1.0.0-arm64.dmg"
# → "The staple and validate action worked!" görmelisin
```

## Yöntem B — Uygulamaya özel parola (app-specific password)

1. [appleid.apple.com](https://appleid.apple.com) → **Giriş ve Güvenlik** →
   **Uygulamaya Özel Parolalar**.
2. `Live-Translate` adıyla yeni bir parola üret (16 haneli, `xxxx-xxxx-xxxx-xxxx`).
3. Parolayı bir kez Keychain'e kaydet:

```bash
xcrun notarytool store-credentials "notarytool" \
  --apple-id "senoldogan02@icloud.com" \
  --team-id "79DZ4AA4DW" \
  --password "XXXX-XXXX-XXXX-XXXX"
```

4. Ardından tek komutla notarize et:

```bash
bash scripts/notarize.sh
```

## SSS

- **"Invalid password" alıyorum?** → Normal Apple şifresi girilmiş olabilir. Sadece
  uygulamaya özel parola (Yöntem B) veya API key (Yöntem A) kabul edilir.
- **Team ID nereden?** → `79DZ4AA4DW` (Developer ID sertifikanla eşleşir).
- **Notarization şart mı?** → Hayır. DMG imzalı ve kurulabilir; kullanıcılar ilk açılışta
  sağ tık → Aç ile açar. Ama auto-update'in düzgün çalışması ve tam güvenilir görünüm
  için notarization önerilir.
- **Auto-update için ne gerekir?** → Notarize edilmiş DMG + GitHub Release'e
  `latest-mac.yml` (electron-builder otomatik üretir).
