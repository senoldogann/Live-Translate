# Contributing to Stealth Subtitle Translator

Thanks for taking the time to contribute! 🎉

This guide explains how to get involved and what we expect from contributors.

## 🤝 Code of Conduct

Lütfen tüm etkileşimlerde saygılı ve profesyonel olun. Ayrımcılığa, tacize veya toksik davranışlara toleransımız yoktur.

## 🛠️ Development Workflow

1.  **Fork & Clone:** Projeyi kendi hesabınıza fork'layın ve klonlayın.
2.  **Branching:** Her özellik veya bug fix için yeni bir branch açın.
    *   `feature/amazing-feature`
    *   `fix/critical-bug`
    *   `chore/cleanup`
3.  **Dependencies:**
    ```bash
    npm install
    npm run python:install
    ```
4.  **Environment:**
    *   `.env` dosyasını oluşturun ve `DEEPL_API_KEY` ekleyin (Varsa).
5.  **Coding:**
    *   **TypeScript:** Strict mode aktiftir. `any` kullanmaktan kaçının.
    *   **React:** Functional component ve Hook kullanın.
    *   **Style:** Glassmorphism tasarım diline sadık kalın.

## ✅ Pull Request (PR) Checklist

Bir PR açmadan önce lütfen aşağıdaki adımları tamamladığınızdan emin olun:

- [ ] **Unit Tests:** `npm test` komutu hatasız çalışıyor mu? (Yeni özellik eklediyseniz testini yazdınız mı?)
- [ ] **Linting:** `npm run lint` komutu hata vermiyor mu?
- [ ] **Type Check:** TypeScript derleyicisi hata vermiyor mu?
- [ ] **Documentation:** `README.md` veya `ARCHITECTURE.md` güncellenmesi gerekiyor mu?
- [ ] **Commit Messages:** Conventional Commits standardına uygun mu? (Örn: `feat: add new streaming mode toggler`)

## 🐛 Bug Reporting

Bir hata bulduysanız, lütfen Issues bölümünden yeni bir kayıt açın ve şunları ekleyin:

1.  **Hatanın Tanımı:** Ne oldu?
2.  **Beklenen Davranış:** Ne olmalıydı?
3.  **Adımlar:** Hatayı tekrar etmek için ne yapmalıyız?
4.  **Loglar:** Terminal çıktısı veya ekran görüntüsü.

---

Katkılarınızla projeyi daha iyi hale getirdiğiniz için teşekkürler! 🚀
