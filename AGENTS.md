# 👑 AGENTS.md: Supreme Authority (SPAP v2.2)

> **WARNING:** This is the MASTER CONSTITUTION. All other rules (`GEMINI.md`, `SKILL.md`, etc.) are SUBORDINATE to this file.

## 🏗️ Görev Tanımı
**Adı:** Maestro Rules & Scripts
**Amacı:** Antigravity AI ajanları için kural setleri, yönetişim ve kalite güvencesi.
**Mimari:** Maestro Architecture (**SPAP v2.2 Compliant**)

---

## 📜 CONSTITUTIONAL PROTOCOLS (ABSOLUTE LAWS)

### 0. THE "READ-FIRST" MANDATE (AI Entry Points)
*   **MASTER ENTRY:** All agents MUST read `AGENTS.md` (Constitutions) → `.agent/SYSTEM.md` (System Map & Guide).
*   **Antigravity:** Read `.agent/rules/GEMINI.md` → `.agent/SYSTEM.md`.
*   **Codex:** Read `.codex/config.toml` (Managed via `.agents/skills`).
*   **OpenCode:** Read `opencode.json`.
*   **ALL:** **MUST** run `python3 scripts/sync_agents.py` after any rule change to ensure parity.

### 1. The "Single Source of Truth" Law
*   **Kural:** Sistemle ilgili her bilgi tek bir yerde durmalıdır.
*   **Uygulama:** Kök dizinde asla mükerrer döküman bulundurma. Tüm teknik detaylar `.agent/SYSTEM.md` içindedir.
*   **Kural:** Asla "tahmin" etme. Asla "ezbere" iş yapma.
*   **Uygulama:** Projeye başlarken veya yeni bir teknoloji seçerken, hafızandaki bilginin güncelliğini (2024+) sorgula.
*   **Ceza:** Eğer bir kütüphanenin eski sürümünü önerirsen, bu bir **KRİTİK HATA** sayılır.

### 2. The "Research First" Law (Tech Stack Integrity)
*   **Kural:** Bir teknoloji yığını (stack) önermeden önce MUTLAKA `web_search` veya `mcp_server` kullanarak en güncel "State of the Art" çözümleri tara.
*   **Yasak:** "React kullanıyorum çünkü popüler" demek yasaktır. "React 19, Server Components nedeniyle bu proje için en iyisi" demelisiniz.
*   **Kanıt:** Teknoloji seçimlerinde referans linki veya kaynak göstermek zorunludur.

### 3. The "No Verification, No Glory" Law (Quality Assurance)
*   **Kural:** Test edilmemiş kod, "taslak" bile sayılmaz; "çöp" hükmündedir.
*   **Zorunluluk:** Her PR (Pull Request) veya büyük değişiklik öncesi, `scripts/verify_all.py` çalıştırılmalı ve **YEŞİL** ışık alınmalıdır.
*   **Süreç:** Test yazmak, kod yazmaktan önce gelir (TDD Mindset).

### 4. The "Context Refresh" Law (Memory Safety)
*   **Sorun:** Uzun konuşmalarda AI saçmalamaya başlayabilir (Context Drift).
*   **Çözüm:** Her 5 adımda bir veya her yeni `/create` komutunda, `AGENTS.md` ve `SKILL_INDEX.md` dosyasını tekrar oku.
*   **Komut:** `view_file AGENTS.md` + `view_file .agent/skills/SKILL_INDEX.md` (Self-Correction Trigger).

### 5. The "Temporal Anchoring" Law (Time Awareness)
*   **Gerçek:** Şu anda **2026** yılındasın. (Prompt'taki `ADDITIONAL_METADATA` saati esastır).
*   **Yasak:** "Ekim 2023 itibariyle bilgim..." gibi cümleler kurmak yasaktır. Sen 2026 model bir mühendissin.
*   **Aksiyon:** Tarihsel bağlam gerektiren her işte (Copyright, Changelog, Sürüm seçimi) güncel tarihi kontrol et.

---

### 6. The "Cross-Verification" Law (Implicit Audit)
*   **Kural:** Herhangi bir görev "Complete" olarak işaretlenmeden önce, sistemin kendi kendini denetlemesi zorunludur.
*   **Zorunluluk:** `verify_all.py` başarısız olursa, her ne sebeple olursa olsun ajan görevi tamamlamış sayılmaz. Ajan hatayı raporlamalı ve kullanıcı "Waive" (Muaf) etmedikçe görevi **FAILED** olarak sürdürmelidir.
*   **DoD (Definition of Done):** Sadece kodun yazılması değil, sistemin geri kalanıyla olan uyumunun (Integration) ispatlanması gerekir.

## 🛠️ Tech Stack & Roles
- **Core:** Markdown (Rules & Docs)
- **Automation:** Python (Scripts)
- **AI Engine:** Antigravity (Agents, Skills, Workflows)

## 🚫 7 DEADLY SINS (KATİ YASAKLAR)
1.  **Skipping Tests:** "Testleri sonra yazarız" demek yasaktır.
2.  **Hardcoding:** PII, Secrets veya Magic Numbers hardcode edilemez.
3.  **Silent Failures:** Try-catch olmadan dış servis çağrısı yapılamaz.
4.  **Legacy Code:** 2 yıldan eski, bakımı durmuş paketleri kullanmak yasaktır.
5.  **Verbose Comments:** Kodu açıklayan değil, **nedenini** anlatan yorum yaz.
6.  **Guesswork:** Emin değilsen DUR ve `web_search` kullan veya kullanıcıya sor.
7.  **Unapproved Plans:** `implementation_plan.md` onayı almadan kod yazılamaz.

## 🔄 Lifecycle Protocol
1.  **Planning:** `/brainstorm` veya `/create-prd-v2`. (Araştırma Zorunlu)
2.  **Execution:** `/create` veya `/dev`. (Test Zorunlu)
3.  **Verification:** `/test` veya `verify_all.py`. (DoD Zorunlu)
