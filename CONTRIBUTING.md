# Contributing to Stealth Subtitle Translator

Thanks for taking the time to contribute! 🎉

This guide explains how to get involved and what we expect from contributors.

## 🤝 Code of Conduct

Please be respectful and professional in all interactions. We have zero tolerance for discrimination, harassment, or toxic behavior.

## 🛠️ Development Workflow

1.  **Fork & Clone:** Fork the project to your account and clone it locally.
2.  **Branching:** Create a new branch for each feature or bug fix.
    *   `feature/amazing-feature`
    *   `fix/critical-bug`
    *   `chore/cleanup`
3.  **Dependencies:**
    ```bash
    npm run python:install
    ```
4.  **Environment:**
    *   Cloud testing için uygulama içindeki `API Ayarlari` ekranından `Azure Speech Key` + `Region` gir.
    *   `Deepgram` ve `DeepL` tamamen isteğe bağlıdır; fallback / kalite katmanı olarak kullanılabilir.
5.  **Coding:**
    *   **TypeScript:** Strict mode is active. Avoid using `any`.
    *   **React:** Use functional components and Hooks.
    *   **Style:** Adhere to the Glassmorphism design language.

## ✅ Pull Request (PR) Checklist

Before opening a PR, please ensure you have completed the following steps:

- [ ] **Unit Tests:** Does `npm test` run without errors? (Did you write tests for new features?)
- [ ] **Linting:** Does `npm run lint` pass?
- [ ] **Type Check:** Does the TypeScript compiler report no errors?
- [ ] **Documentation:** Does `README.md` or `ARCHITECTURE.md` need updating?
- [ ] **Commit Messages:** Do they follow the Conventional Commits standard? (e.g., `feat: add new streaming mode toggler`)

## 🐛 Bug Reporting

If you found a bug, please open a new issue in the Issues section and include:

1.  **Description:** What happened?
2.  **Expected Behavior:** What should have happened?
3.  **Steps to Reproduce:** How can we replicate the bug?
4.  **Logs:** Terminal output or screenshots.

---

Thank you for making the project better with your contributions! 🚀
