# 📥 Installation Guide / Kurulum Rehberi

> For end users — no terminal required. / Terminal gerektirmez.

---

## 🇬🇧 English

### What you need
- **macOS** on an **Apple Silicon** Mac (M1/M2/M3/M4)
- **BlackHole 2ch** — a free virtual audio driver (we'll install it below)

### Step 1 — Install the app
1. Download the latest **.dmg** from the [Releases](https://github.com/senoldogann/Live-Translate/releases) page.
2. Double-click the DMG, drag **Stealth Subtitle Translator** into **Applications**.
3. Open the app from Launchpad or Applications.

### Step 2 — Install BlackHole (free, ~5 min)
BlackHole lets the app "hear" your computer's sound.

1. Go to **https://existential.audio/blackhole/** and download **BlackHole 2ch**.
2. Open the installer and follow the steps (enter your Mac password when asked).
3. If macOS asks to restart, restart your Mac.

### Step 3 — Route your sound to BlackHole
So the app can capture what you hear:

1. Open **System Settings → Sound → Output**.
2. Click the **+** button at the bottom, then **Create Multi-Output Device**.
3. Tick **BlackHole 2ch** and your speakers/headphones in that device.
4. Select the **Multi-Output Device** as your output.

> Alternatively: select **BlackHole 2ch** directly as output — you'll hear nothing, but the app captures audio. The Multi-Output Device lets you hear *and* capture.

### Step 4 — Grant microphone access
On first launch macOS asks: **"Stealth Subtitle Translator would like to access the microphone."**
Click **Allow**. (The app needs this to read system audio — your audio is never uploaded in Local mode.)

### Step 5 — First run
The in-app setup wizard guides you through the rest:
- Choose **Local** (private, on-device) or **Cloud** (Azure, faster).
- Pick a Whisper model size (recommended: **Small**).
- On first use, the model downloads automatically — stay online.

### Done! 🎉
Play any video or join a meeting — subtitles appear on screen. Toggle **🛡️ Stealth** to hide the overlay from screen sharing.

**Troubleshooting:** Subtitles not appearing? Check that your output is the **Multi-Output Device** and that you granted microphone access (System Settings → Privacy & Security → Microphone).

---

## 🇹🇷 Türkçe

### Gerekenler
- **Apple Silicon** (M1/M2/M3/M4) bir **Mac**
- **BlackHole 2ch** — ücretsiz sanal ses sürücüsü (aşağıda kuruyoruz)

### Adım 1 — Uygulamayı kurun
1. [Releases](https://github.com/senoldogann/Live-Translate/releases) sayfasından en son **.dmg** dosyasını indirin.
2. DMG'ye çift tıklayın, **Stealth Subtitle Translator**'ı **Uygulamalar** klasörüne sürükleyin.
3. Uygulamayı Launchpad'den veya Uygulamalar'dan açın.

### Adım 2 — BlackHole'u kurun (ücretsiz, ~5 dk)
BlackHole, uygulamanın bilgisayarınızın sesini "duymasını" sağlar.

1. **https://existential.audio/blackhole/** adresinden **BlackHole 2ch** sürümünü indirin.
2. Kurulumu açın ve adımları takip edin (istersen Mac şifrenizi girin).
3. macOS yeniden başlatma isterse bilgisayarı yeniden başlatın.

### Adım 3 — Sesi BlackHole'a yönlendirin
Uygulamanın duyduklarınızı yakalaması için:

1. **Sistem Ayarları → Ses → Çıkış** bölümünü açın.
2. Alttaki **+** butonuna tıklayın, **Çok Çıkışlı Aygıt Oluştur** seçeneğini seçin.
3. Bu aygıtta **BlackHole 2ch** ve hoparlörünüzü/kulaklığınızı işaretleyin.
4. Çıkış olarak **Çok Çıkışlı Aygıt**'ı seçin.

> Alternatif: çıkışı doğrudan **BlackHole 2ch** yapın — ses duymazsınız ama uygulama yakalar. Çok Çıkışlı Aygıt ile hem duyarsınız hem yakalar.

### Adım 4 — Mikrofon izni verin
İlk açılışta macOS sorar: **"Stealth Subtitle Translator mikrofonunuza erişmek istiyor."**
**İzin Ver** deyin. (Uygulama sistem sesini okumak için buna ihtiyaç duyar; Yerel modda sesiniz hiçbir yere gönderilmez.)

### Adım 5 — İlk çalıştırma
Kurulum sihirbazı gerisini adım adım anlatır:
- **Yerel** (gizlilik, cihazda) veya **Bulut** (Azure, daha hızlı) modunu seçin.
- Whisper model boyutunu seçin (önerilen: **Small**).
- İlk kullanımda model otomatik iner — internet bağlı kalsın.

### Tamamlandı! 🎉
Bir video açın veya toplantıya katılın — altyazı ekranda belirir. 🛡️ **Gizli Mod** ile altyazıyı ekran paylaşımından gizleyebilirsiniz.

**Sorun mu var?** Altyazı görünmüyorsa: Çıkışın **Çok Çıkışlı Aygıt** olduğundan ve mikrofon iznini verdiğinizden emin olun (Sistem Ayarları → Gizlilik ve Güvenlik → Mikrofon).
