# Stealth Subtitle Translator

> Real-time AI transcription + translation for macOS — **invisible to screen sharing** in Stealth mode.

[![Version](https://img.shields.io/badge/version-1.0.0-blue?style=for-the-badge)](https://github.com/senoldogann/Live-Translate/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20Silicon-black?style=for-the-badge&logo=apple)](https://github.com/senoldogann/Live-Translate)
[![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/senoldogann/live-translate/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/senoldogann/Live-Translate/actions)

Stealth Subtitle Translator adds **live subtitles with translation** on top of your screen while you watch meetings, movies, or streams. When **Stealth mode** is enabled, the overlay is invisible to screen-capture tools (Zoom, Teams, OBS, QuickTime) — your audience sees a clean desktop, you see the subtitles.

Privacy-first: in **Local mode**, audio never leaves your machine.

---

## ✨ Features

### 🛡️ Ghost-Level Invisibility
- Overlay window hidden from screen capture engines while Stealth mode is on
- Great for meetings, presentations, and streaming

### ⚡ Hybrid AI Engine
- **Local STT:** [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (`small` model, int8, Apple Silicon optimized) — selectable size: tiny / base / small / medium
- **Cloud STT:** Azure Speech Translation (primary), Deepgram (optional fallback)
- **Translation:** DeepL API (optional, best quality) → Google → offline Argos fallback
- **Anti-hallucination:** 3-gram loop filter + temperature fallback
- **Low-latency IPC:** ZeroMQ with HMAC-signed messages between Python and Electron

### 💎 UX
- Glassmorphism overlay with SiriWave animation when silent
- Click-through: clicks outside the subtitle pass to the app behind
- Draggable control bar (opacity, font size, language, streaming mode)
- Transcript history window

---

## 🚀 Quick Start (from source)

```bash
git clone https://github.com/senoldogann/Live-Translate.git
cd Live-Translate
npm run oss:start
```

The launcher bootstraps `node_modules` and the Python environment automatically.

### Prerequisites

| Requirement | Notes |
|---|---|
| macOS Monterey 12+ | Apple Silicon (M1+) recommended |
| [BlackHole 2ch](https://existential.audio/blackhole/) | Virtual audio driver — required to capture system audio |
| Node.js 18+ | `brew install node` |
| Python 3.11+ | used for the AI engine |

### First launch
1. Install **BlackHole 2ch** and set your system output to a **Multi-Output Device** (or BlackHole directly) in *System Settings → Sound*.
2. Grant **microphone access** when macOS asks (needed to read system audio).
3. In **Local mode** the Whisper model auto-downloads on first use (stay online).

For the best cloud experience, add your **Azure Speech** key (and optionally **DeepL**) under *API Ayarları*.

---

## 📦 Install from DMG (release)

Download the latest DMG from the [Releases](https://github.com/senoldogann/Live-Translate/releases) page, open it, and drag the app into *Applications*. The app auto-updates when a new release is published.

**First-time user?** Follow the simple [Installation Guide](docs/INSTALL.md) — no terminal needed (also available in Türkçe).

---

## 🎮 Control Bar

| Button | Feature |
|:--|:--|
| 🟢 | Status (green = listening) |
| 🎤 | Start / pause listening |
| ≡ | Streaming mode (word-by-word vs sentence) |
| 🛡️ | Stealth (screen-capture invisibility) |
| 👁️ | Show / hide source text |
| 🌐 | Source language |
| 🔄 | Restart AI engine |
| 📜 | Transcript history |
| ✕ | Quit |

---

## 🧪 Development

```bash
npm test                # unit tests (Vitest)
npm run test:e2e        # Electron smoke test (Playwright)
npm run electron:build  # production DMG (signed with Developer ID)
bash scripts/notarize.sh # notarize + staple the DMG (requires Apple credentials)
```

Notarization can be done **without any password** using an App Store Connect API Key — see the [Notarization Guide](docs/NOTARIZATION.md).

### Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for a technical deep dive, and [docs/superpowers/plans/](docs/superpowers/plans/) for engineering plans.

---

## 🔒 Security

- API keys are encrypted with the macOS Keychain (`safeStorage`) before hitting disk.
- ZMQ traffic is HMAC-signed and replay-protected.
- Found a vulnerability? See [SECURITY.md](SECURITY.md) — do **not** open a public issue.

---

## ⚠️ Legal Notice

Built for **accessibility and language learning**. Recording conversations or violating privacy policies is the sole responsibility of the user. **Stealth mode** is meant to protect your own privacy, not to deceive others.

---

<div align="center">
  <sub>Designed & Engineered by <a href="https://github.com/senoldogann">Senol Dogan</a> in Finland.</sub>
</div>
