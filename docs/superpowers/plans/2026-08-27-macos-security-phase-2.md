# macOS Security Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect stored credentials and local engine traffic on the macOS-only deployment target.

**Architecture:** Move credential serialization behind asynchronous Electron `safeStorage` helpers so plaintext API keys never reach disk. Replace fixed localhost TCP ZMQ channels with a unique per-session Unix-domain IPC pair on macOS. Wrap transcript and command payloads in versioned HMAC-SHA256 envelopes verified before parsing.

**Tech Stack:** Electron 44, Node crypto, Python 3.11, PyZMQ 26, Ruff, Vitest.

**Spec:** Continuation of the Phase 1 review: OS-keychain credential storage, ZMQ authentication, removal of predictable local-port attack surface.

## Global Constraints

- Comments remain Turkish.
- Explicit errors are required; do not silently accept missing authentication material.
- Never log credentials, auth tokens, signatures or full decrypted secrets.
- Keep TCP behavior only as a non-macOS compatibility path; prioritize the Darwin path.
- Runtime migration may convert legacy plaintext keys once, but every write must store ciphertext.

---

### Task 1: Encrypt Setup Credentials

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/package.json` if Electron types require an import.

**Interfaces:**
- Produces: `readSetupConfig(): Promise<SetupConfig>`, `writeSetupConfig(config: SetupConfig): Promise<void>`.
- Produces: `publicSetupSnapshot(): { isSetupComplete: boolean }` for synchronous window sizing.
- Produces: async update paths for Python launch and auxiliary windows.

**Steps**

- [x] Use `safeStorage.encryptStringAsync` and `decryptStringAsync`.
- [x] Store encrypted fields as `v1-safe-storage` objects with base64 ciphertext.
- [x] Refuse save/read operations when safeStorage is unavailable rather than writing plaintext.
- [x] Make all credential consumers await config reads; retain a sync public preferences helper only for window dimensions.
- [x] Exclude credential fields from renderer-facing `get-config`; auxiliary native settings remain main-process owned.

### Task 2: Scope Engine Traffic to Local IPC

**Files:**
- Modify: `electron/main.ts`
- Modify: `python/engine.py`

**Interfaces:**
- Consumes: existing `EngineConfig.zmq_address`.
- Produces: environment variables `TRANSCRIPT_ZMQ_ADDRESS`, `COMMAND_ZMQ_ADDRESS`, `ZMQ_AUTH_TOKEN`.
- Produces: `ipc:///...sock` endpoints on macOS under `userData/ipc/<session-id>/`.

**Steps**

- [x] Generate one UUID session id per Electron process.
- [x] Pass both endpoint addresses from main to Python through spawn env.
- [x] Bind the transcript publisher in Python and connect subscriber in Electron using that address.
- [x] Bind the command publisher in Electron and connect subscriber in Python using the paired endpoint.
- [x] Remove port-squatting recovery for Darwin while retaining stale-child termination.

### Task 3: Authenticate Messages

**Files:**
- Modify: `electron/main.ts`
- Modify: `python/engine.py`

**Interfaces:**
- Produces envelope type `{v:1,payload:string,sig:string}` where `sig=HMAC_SHA256(token,payload)`.
- Consumes: one cryptographically random per-session token shared only by parent and child via spawn environment.

**Steps**

- [x] Add canonical JSON-string signing on Python transcripts/audio levels.
- [x] Verify transcripts in Electron before `JSON.parse` and reject bad signatures with structured logs.
- [x] Sign commands in Electron and verify commands in Python.
- [x] Reject unsigned, malformed, replayed token or version mismatches without accepting payload data.

### Task 4: Verification

**Files:** no production changes beyond earlier tasks.

**Steps**

- [x] Run `npx tsc --noEmit`, `npm test -- --run`, `npm run build`, `npm audit --audit-level=high`.
- [x] Run Python compile, pip-audit and configured Ruff checks.
- [x] Inspect persisted config with a test fixture containing only non-secret values; do not commit real credentials.
- [x] Report any unverified runtime surface explicitly.
