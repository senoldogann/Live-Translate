# Stealth Subtitle Translator

Real-time transcription and translation for macOS — with an overlay that stays invisible
to screen sharing in Stealth mode.

[![Version](https://img.shields.io/badge/version-1.0.0-blue?style=for-the-badge)](https://github.com/senoldogann/Live-Translate/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20Silicon-black?style=for-the-badge&logo=apple)](https://github.com/senoldogann/Live-Translate)
[![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/senoldogann/live-translate/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/senoldogann/Live-Translate/actions)

Watching a meeting, a movie, or a stream? Stealth Subtitle Translator puts live, translated
subtitles on top of your screen. In **Local mode** your audio never leaves the machine; in
**Cloud mode** you can use Azure Speech or Deepgram for lower latency.

With **Stealth mode** enabled, the overlay is invisible to screen-capture tools (Zoom, Teams,
OBS, QuickTime). Your audience sees a clean desktop; you see the subtitles.

## Features

**Stealth overlay** — Hidden from screen capture while Stealth mode is on. Built for
meetings, presentations, and streaming.

**Hybrid engine** — Local speech-to-text with [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
(`small` model by default, selectable: tiny / base / small / medium), or cloud speech-to-text
with Azure Speech Translation (primary) and Deepgram (fallback). Translation via DeepL
(recommended) with an offline Argos fallback.

**Low latency** — Streaming mode shows subtitles word-by-word while the speaker talks, then
finalizes the sentence. Mid-sentence cuts are merged back together so subtitles stay clean.

**Interface** — Glassmorphism overlay, click-through so clicks pass to the app behind,
draggable control bar (opacity, font size, language, engine), transcript history window.

## Quick Start (from source)

```bash
git clone https://github.com/senoldogann/Live-Translate.git
cd Live-Translate
npm run oss:start
```

The launcher sets up `node_modules` and the Python environment automatically.

### Prerequisites

| Requirement | Notes |
|---|---|
| macOS 12+ | Apple Silicon (M1+) recommended |
| [BlackHole 2ch](https://existential.audio/blackhole/) | Virtual audio driver — captures system audio |
| Node.js 18+ | `brew install node` |
| Python 3.11+ | Runs the AI engine |

### First launch

1. Install **BlackHole 2ch** and set your system output to a **Multi-Output Device**
   (or BlackHole directly) in *System Settings → Sound*.
2. Allow **microphone access** when macOS asks (needed to read system audio).
3. In **Local mode** the Whisper model downloads on first use — stay online.

For cloud use, add your **Azure Speech** key (and optionally **DeepL**) in the API Settings
window. The in-app setup wizard guides you through everything.

## Install from DMG

Download the latest DMG from the [Releases](https://github.com/senoldogann/Live-Translate/releases)
page, open it, and drag the app into *Applications*. The app auto-updates when a new release
is published.

**First-time user?** Follow the [Installation Guide](docs/INSTALL.md) — no terminal needed
(also available in Türkçe).

## Development

```bash
npm test                 # unit tests (Vitest)
npm run test:e2e         # Electron smoke test (Playwright)
npm run electron:build   # production DMG (Developer ID signed)
bash scripts/notarize.sh # notarize + staple the DMG (requires Apple credentials)
```

Notarization can be done without a password using an App Store Connect API key — see the
[Notarization Guide](docs/NOTARIZATION.md). Technical details live in
[ARCHITECTURE.md](ARCHITECTURE.md).

## Security

- API keys are encrypted with the macOS Keychain (`safeStorage`) before hitting disk.
- ZMQ traffic is HMAC-signed and replay-protected.
- Found a vulnerability? See [SECURITY.md](SECURITY.md) — do **not** open a public issue.

## Legal Notice

Built for accessibility and language learning. Recording conversations or violating privacy
policies is the sole responsibility of the user. **Stealth mode** is meant to protect your
own privacy, not to deceive others.
