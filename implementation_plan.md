# Implementation Plan: Fix Runtime Errors

**Date:** 2026-03-03  
**Status:** APPROVED  
**Approved by:** User ("KABUL EDIYORUM BASLA")

---

## Problem Summary

Four bugs blocking the application:

| # | Error | File |
|---|-------|------|
| 1 | `window.electronAPI?.setEngineType is not a function` (renderer crash) | `electron/preload.cjs` |
| 2 | `ImportError: cannot import name 'LiveTranscriptionEvents' from 'deepgram'` (Python crash) | `python/deepgram_engine.py` |
| 3 | `EBUSY Socket is blocked by a bind or unbind operation` (ZMQ race) | `electron/main.ts` |
| 4 | `update_keys` command never reaches Python engine (silent data loss) | `python/engine.py` |

---

## Fix 1 – Electron Preload API Parity

- **File:** `electron/preload.cjs`
- **Root cause:** Dev mode loads `preload.cjs` but it is missing `setEngineType` and `onEngineLog` which exist in `preload.ts`. React calls both at startup, causing a crash.
- **Change:** Add `setEngineType` (`ipcRenderer.send('set-engine-type', ...)`) and `onEngineLog` (listens on `engine-log`) to match `preload.ts` exactly.

## Fix 2 – ZMQ Publisher Bind Race

- **File:** `electron/main.ts` line 817
- **Root cause:** `startZmqPublisher()` is called *without* `await` inside `app.whenReady().then(async () => {...})`. IPC handlers (`set-streaming-mode`, `set-language`) can fire before bind completes, throwing `EBUSY`.
- **Change:** `await startZmqPublisher()` — the function is already `async` and the outer callback is already `async`.

## Fix 3 – Python `update_keys` Unreachable Branch

- **File:** `python/engine.py` `_command_loop` (~line 806)
- **Root cause:** `elif data.get('type') == 'update_keys':` is accidentally nested *inside* the `if data.get('type') == 'config':` block. It can never be true there since the outer guard already required type == 'config'. API key updates from `save-config` are silently dropped.
- **Change:** Dedent the `elif update_keys` branch to the same level as `if data.get('type') == 'config':`.

## Fix 4 – Deepgram SDK v6 Migration

- **File:** `python/deepgram_engine.py`
- **Root cause:** The file imports `LiveTranscriptionEvents`, `LiveOptions`, `DeepgramClientOptions` from `deepgram`. These symbols were removed in SDK v4+. Installed version is `deepgram-sdk==6.0.1` which uses a completely different WebSocket API.
- **Change:** Full rewrite targeting SDK v6:
  - `DeepgramClient(api_key=...)` for client construction
  - `client.listen.v1.connect(model="nova-3", language=..., ...)` as context manager (in a daemon thread)
  - `EventType` from `deepgram.core.events` for event registration
  - `connection.start_listening()` blocks — run in daemon thread via `_connection_loop()`
  - `connection.send_media(audio_bytes)` replaces `connection.send()`
  - `connection.finish()` for graceful shutdown
- **Model:** `nova-3` (unchanged from existing config)
- **API version:** Listen v1 (available in installed venv, confirmed by investigation)
- **Reference:** https://github.com/deepgram/deepgram-python-sdk (v6.0.1, Feb 2026)

---

## Verification

1. `npm test` — Jest unit tests (includes App.test.tsx which mocks `setEngineType`)
2. `python3 scripts/verify_all.py` — repo quality gate
3. Runtime smoke check: start app, confirm no preload errors, no EBUSY, Python engine starts

---

## Continuation Addendum – 2026-03-03

**Status:** APPROVED  
**Approved by:** User ("Lütfen kalanlarida tamamla.")

### Remaining Work

1. **True Pause / Resume**
   - Wire the UI listening toggle to Electron IPC and the Python engine command loop.
   - Ensure paused mode stops new audio ingestion/transcription instead of only changing button state.

2. **Local Latency Tuning**
   - Reduce local transcription delay without regressing stability.
   - Prioritise lower decode cost and faster segment finalization for real-time subtitle updates.

3. **Packaging Verification**
   - Run `npm run electron:build` in isolation.
   - Confirm whether the DMG packaging path completes or identify the exact blocker.

---

## UI/Cloud Fix Addendum – 2026-03-03

**Status:** APPROVED  
**Approved by:** User (API ayarlari ve cloud mode bug listesi)

### Scope

1. **API Settings Modal Visibility**
   - Fix clipped modal rendering by decoupling it from the bottom control bar layout.
   - Ensure the popup is fully visible and interactive.

2. **API Save Flow Verification**
   - Prevent the modal from closing before async validation/save completes.
   - Surface validation failures in the UI and only close on successful validation plus persisted config.

3. **Cloud Stable Mode**
   - Make cloud transcription honor sentence/stable mode by suppressing Deepgram interim transcripts when streaming mode is off.

4. **Regression Coverage**
   - Add tests for the modal save lifecycle so save failures do not silently dismiss the dialog.

---

## Click-Through Fix Addendum – 2026-03-03

**Status:** APPROVED  
**Approved by:** User (modal aciliyor ama butonlar tiklanmiyor)

### Scope

1. **Modal Hit Testing**
   - Stop the control-bar interactive zone polling from overwriting modal-wide hit targets.
   - Keep the whole window interactive while modal is open so close/save buttons can receive clicks.

2. **Runtime Noise Reduction**
   - Suppress the known `webrtcvad` `pkg_resources` deprecation warning at import time so stderr is not flooded with non-actionable noise.

---

## History/UI Addendum – 2026-03-03

**Status:** APPROVED  
**Approved by:** User (real-time history + modal top placement)

### Scope

1. **Real-Time Transcript History**
   - Stop using a static snapshot-only native history window for the primary history flow.
   - Reuse the in-app React history overlay so it updates live with new transcript entries.

2. **Top-Aligned API Modal**
   - Move the API modal visual anchor toward the top of the overlay instead of center/bottom bias.

3. **Provider Visibility**
   - Make it clearer in logs and UI behavior which provider path is active so “usage 0” confusion can be diagnosed from the app’s actual execution path.

---

## Real-Time Translation Quality Addendum – 2026-03-03

**Status:** APPROVED  
**Approved by:** User ("O HALDE TÜM Bu yanlislari düzelt ve sistemimizi kusursuz hale getir.")

### Scope

1. **Deepgram Segment Stabilization**
   - Stop treating every `Results.is_final` frame as a full sentence.
   - Buffer finalized Deepgram segments and only commit a final translation on `speech_final` or `UtteranceEnd`.

2. **Non-Blocking Cloud Translation**
   - Remove blocking translation calls from the Deepgram WebSocket callback thread.
   - Push cloud translation work onto a background queue and drop stale preview jobs when newer segments arrive.

3. **Context-Aware DeepL Translation**
   - Pass recent committed source text as translation context for final sentence quality.
   - Use DeepL model selection intentionally: faster preview path, higher-quality final path.

4. **Preview vs Final Behavior**
   - Streaming mode should publish fewer, more stable preview updates based on finalized segments only.
   - Stable mode should publish only committed final utterances.

5. **Verification**
   - Add regression coverage for the new Deepgram buffering behavior.
   - Re-run unit tests, build, and `scripts/verify_all.py`.

---

## Low-Latency Readability Addendum – 2026-03-03

**Status:** APPROVED  
**Approved by:** User (large paragraph complaint + live history window request)

### Scope

1. **Earlier Stable Commits**
   - Reduce cloud chunk size so finalized text is committed sooner instead of waiting for oversized utterance buffers.
   - Keep enough stabilization to avoid flicker, but optimize for readable follow-along chunks.

2. **Live Native History Window**
   - Stop sending final-only history data to the native transcript window.
   - Include the current live partial line while the window is open so the user can follow in real time.

3. **Regression Coverage**
   - Update buffering tests for the new soft-commit policy.
   - Add renderer coverage for live history window updates from partial transcripts.

---

## Word-Reveal UX Addendum – 2026-03-03

**Status:** APPROVED  
**Approved by:** User (word-by-word subtitles + faster follow-along request)

### Scope

1. **Word-by-Word Subtitle Reveal**
   - Add a renderer-side word-reveal mode so translated subtitles can appear in fast incremental word bursts instead of popping in all at once.
   - Keep this as a UI behavior toggle so the backend transcription/translation pipeline remains stable.

2. **User-Controlled Toggle**
   - Expose a dedicated control-bar toggle so the user can turn the word-reveal effect on or off without changing engine selection.
   - Persist the preference in the existing config store.

3. **Low-Risk Latency Improvements**
   - Reduce avoidable translation overhead without changing providers or destabilizing the current cloud path.
   - Prioritize connection reuse and background preloading over invasive pipeline changes.

4. **Verification**
   - Add focused renderer tests for the new reveal behavior.
   - Re-run unit tests, build, and `scripts/verify_all.py`.

---

## Open-Source Launch Addendum – 2026-03-03

**Status:** APPROVED  
**Approved by:** User (open-source script launch + final polish request)

### Scope

1. **Single-Command OSS Launch**
   - Add a small bootstrap script that prepares Node dependencies and the Python virtual environment, then starts the app without requiring DMG packaging.
   - Remove reliance on a machine-specific Python path for the common open-source setup flow.

2. **Runtime Provider Visibility**
   - Expose which translation provider actually produced each subtitle (`DeepL`, `Google`, `Argos`, or passthrough).
   - Keep this lightweight and diagnostic-first so the active pipeline can be verified from logs without changing subtitle behavior.

3. **Verification**
   - Add a non-destructive smoke check for the launcher script.
   - Re-run tests, build, and `scripts/verify_all.py`.

4. **Git Hygiene**
   - Ignore generated release artifacts and interpreter caches that should never be committed in the open-source workflow.
   - Push the verified repository state to GitHub after the ignore rules are in place.

---

## ZMQ Startup Recovery Addendum – 2026-03-04

**Status:** APPROVED  
**Approved by:** User (`Address already in use` startup failure report)

### Scope

1. **Stale Python Engine Recovery**
   - Detect and clean up lingering `python/engine.py` processes before launching a new engine instance.
   - Prefer graceful shutdown over hard kills, but force recovery if an older orphan process is still holding the data socket.

2. **Port Availability Guard**
   - Wait for the ZMQ data port to become free before spawning the next engine instance.
   - If a bind conflict still happens, trigger a single self-healing restart path instead of failing silently.

3. **Graceful Engine Shutdown Command**
   - Add an explicit command path so Electron can tell an already-running Python engine to stop cleanly during startup recovery.

---

## History De-Dupe Addendum – 2026-03-04

**Status:** APPROVED  
**Approved by:** User (duplicate transcript history report)

### Scope

1. **StrictMode-Safe History Commits**
   - Remove nested history writes from inside React state updater callbacks.
   - Commit finalized subtitles to transcript history in a side-effect-safe path so dev-mode double invokes do not duplicate entries.

2. **Live Entry De-Duplication**
   - Stop showing the live partial row in the native history window when it is identical to the most recent committed final entry.

3. **Regression Coverage**
   - Add a focused renderer test that repeated identical final updates do not create duplicate history rows.

---

## Preview Catch-Up Addendum – 2026-03-04

**Status:** APPROVED  
**Approved by:** User (preview still trailing one sentence behind)

### Scope

1. **Replace Debounce With Leading Throttle**
   - Stop resetting preview visibility on every partial transcript update.
   - Show the first preview immediately, then rate-limit follow-up updates so continuous speech still advances in near real time.

2. **Regression Coverage**
   - Update renderer tests so the preview path proves the new clause is visible immediately rather than only after a pause.

---

## Clause Commit Addendum – 2026-03-04

**Status:** APPROVED  
**Approved by:** User (plan the most sensible next upgrade and finish in one session)

### Scope

1. **Clause-Based Early Commit**
   - Stop treating every long finalized buffer as a single all-or-nothing commit.
   - Commit punctuation-bounded clauses early when there is enough trailing context left to avoid chopping the sentence too aggressively.

2. **Rolling Tail Holdback**
   - When no punctuation boundary exists, commit only the stable prefix of a long running utterance and keep a short tail buffered for upcoming context.
   - Preserve final flush behavior on `speech_final` and `UtteranceEnd`.

3. **Streaming Preview Continuity**
   - After an early commit, keep the buffered tail eligible for preview updates so subtitles do not visually pause until the next finalized chunk arrives.

4. **Regression Coverage**
   - Add focused Python tests for clause splitting and rolling tail holdback behavior.

---

## Gap Commit UX Addendum – 2026-03-04

**Status:** APPROVED  
**Approved by:** User (apply the next best improvements now)

### Scope

1. **Single-Line Overlay**
   - Remove the separate on-screen `Stabil` translation row from the live overlay so users only read one Turkish line at a time.
   - Keep the preview/final pipeline intact; simplify presentation only.

2. **Word-Gap Commit Heuristic**
   - Use finalized word timings from Deepgram results to detect natural pauses between words.
   - Prefer those pauses over blunt word-count splitting when emitting early finalized clauses.

3. **Regression Coverage**
   - Update React tests for the single-line overlay behavior.
   - Add Python coverage for word-gap-based early commit.

---

## Term Stabilization Addendum – 2026-03-04

**Status:** APPROVED  
**Approved by:** User (apply the most realistic next upgrade in one session)

### Scope

1. **Deepgram Keyterm Prompting**
   - Inject a curated technical keyterm list into the cloud STT connection.
   - Allow environment override so open-source users can tune the prompt without code edits.

2. **Local Glossary-Like Protection**
   - Protect critical technical terms with placeholders before sending text to translation providers.
   - Restore those exact terms after translation so product names and acronyms stay stable without requiring a paid glossary API.

3. **Regression Coverage**
   - Add focused Python tests for keyterm selection and protected-term restoration.
