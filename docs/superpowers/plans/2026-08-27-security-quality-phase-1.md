# Phase 1 Security Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Phase 1 health gates real by hardening Electron defaults, fixing known test and dependency failures, adding renderer state safety, and making CI block actual failures.

**Architecture:** Keep the existing Electron/React/Python architecture. Introduce focused modules for shared IPC validation, add lifecycle guards in the existing main process, cap in-memory history with dated persistence unchanged, and upgrade direct tooling versions without changing the AI runtime protocol.

**Tech Stack:** Electron 43, Vite 7, Vitest 4.1, TypeScript 5, React 18, Ruff 0.13.

**Spec:** Review report from this conversation: P0 fixes for dependency audits, non-blocking CI, Electron security settings, failing API-settings contract test; selected P1 improvements for transcript memory growth and IPC input validation.

## Global Constraints

- Comments remain Turkish.
- Match existing functional style and avoid unrelated refactors.
- Never return values by silently swallowing failures.
- Do not modify the user-owned untracked `data/` directory.
- No new unit tests except where an existing behavior contract changes.
- Verification commands must exit zero before a task is marked complete.

---

### Task 1: Isolate Work

**Files:**
- Create: `.worktrees/codex-security-quality-phase-1`

**Interfaces:**
- Consumes: current `main` commit `4140b1b`.
- Produces: branch `codex/security-quality-phase-1`.

- [ ] **Step 1: Verify current branch**

Run: `git status --short && git branch --show-current`
Expected: only untracked `data/`; current branch `main`.

- [ ] **Step 2: Add worktree ignore entry**

Modify `.gitignore` to include:

```gitignore
.worktrees/
```

Commit with `chore(repo): ignore local worktrees`.

- [ ] **Step 3: Create isolated worktree**

Run:

```bash
git worktree add .worktrees/codex-security-quality-phase-1 -b codex/security-quality-phase-1
```

Expected: branch is created and checked out at `.worktrees/codex-security-quality-phase-1`.

- [ ] **Step 4: Install Node dependencies**

Run: `npm ci`
Expected: exit code 0.

### Task 2: Repair Renderer Settings Contract

**Files:**
- Modify: `src/__tests__/App.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: API settings draft includes Azure, Deepgram, DeepL and Ollama fields through `ElectronAPI.openApiSettingsWindow`.

- [ ] **Step 1: Run the existing failing test**

Run: `npm test -- --run src/__tests__/App.test.tsx`
Expected: fail because expected draft omits Ollama fields.

- [ ] **Step 2: Update the regression expectation**

Update both calls in the native utility windows test to expect the full seven-field `ApiSettingsDraft`. Use empty Ollama values initially and `"http://127.0.0.1:11434"` for endpoint.

Run: `npm test -- --run src/__tests__/App.test.tsx`
Expected: PASS.

### Task 3: Bound In-Memory Transcript History

**Files:**
- Modify: `src/App.tsx`
- Test: `src/__tests__/App.test.tsx`

**Interfaces:**
- Produces: constant `MAX_TRANSCRIPT_HISTORY = 200`, used by both live overlay list and complete in-memory history.

- [ ] **Step 1: Assert capped history receives each update when history window is open**

Extend the duplicate final transcript test to send 210 distinct finals and assert last payload has length 200 while oldest entries are removed. This verifies rolling bounded memory across repeated updates rather than duplicating a stale row.

Run: `npm test -- --run src/__tests__/App.test.tsx`
Expected: PASS after implementing clipping.

### Task 4: Harden Window Lifecycle

**Files:**
- Modify: `electron/main.ts`
- Test: existing renderer tests plus production build.

**Interfaces:**
- Consumes: existing safe URL helper `isSafeExternalUrl(urlString: string): boolean`.
- Produces: every BrowserWindow enables sandbox and denies popups unless navigation is same-origin file/dev-server content.

- [ ] **Step 1: Extract and apply web preferences**

Create pure helper functions in `electron/main.ts`:

```typescript
function getMainWebPreferences(): Electron.WebPreferences;
function getUtilityWebPreferences(): Electron.WebPreferences;
function getWindowOpenHandler(win: BrowserWindow): (details: Electron.HandlerDetails) => { action: 'deny' } | { action: 'allow', overrideBrowserWindowOptions?: Electron.BrowserWindowConstructorOptions };
```

Set `sandbox: true`, keep context isolation true, node integration false, retain dev-only `webSecurity: false` only for main. Apply the open-handler via a common `configureMainWindowLifecycle(win: BrowserWindow)` function.

- [ ] **Step 2: Reject unsafe popup URLs**

The handler returns `{ action: 'deny' }` for non-file/dev-server URLs. Trusted external domains continue to use explicit IPC + `shell.openExternal`.

Run: `npx tsc --noEmit`
Expected: PASS.

### Task 5: Upgrade Audit Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `python/pyproject.toml`

**Interfaces:**
- Produces: direct versions suitable for current build tools and deterministic Python lint/tool config.

- [ ] **Step 1: Upgrade direct npm packages**

Use `npm install -D electron@latest electron-builder@latest vite@latest vitest@4.1.0 concurrently@latest && npm audit fix`.

- [ ] **Step 2: Verify development dependency audits**

Run: `npm audit`
Expected: zero high/critical vulnerabilities. Warnings from transitive packages may remain only if no fixed version exists; record them explicitly if any.

- [ ] **Step 3: Add Python tooling configuration**

Add Python 3.11 metadata and Ruff target-version/tool configuration in `python/pyproject.toml`. Ruff targets modern typing style and defines import sorting/format rules for `python/`.

### Task 6: Make CI Gates Real

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `SECURITY.md`

**Interfaces:**
- Produces: typecheck, tests, build, Python lint/format check, npm audit high threshold and pip-audit all block merges.

- [ ] **Step 1: Remove failure suppression**

Delete `continue-on-error` from type checking and remove all trailing `|| true` commands from audit/lint steps.

- [ ] **Step 2: Correct documented sandbox state**

After implementation, SECURITY.md says sandbox is enabled and documents that primary overlays intentionally disable `webSecurity` only during development.

### Task 7: Full Verification

**Files:** no source edits beyond earlier tasks.

- [ ] **Step 1: Node checks**

Run:

```bash
npm test -- --run
npx tsc --noEmit
npm run build
npm audit --audit-level=high
```

Expected: all exit zero.

- [ ] **Step 2: Python checks**

Run:

```bash
uvx ruff check python --fix
uvx ruff format python
uvx ruff check python
uvx ruff format --check python
```

Then inspect the diff so mechanical formatting does not obscure intentional changes. Expected: both verification checks exit zero.

- [ ] **Step 3: Commit in focused units**

Commits follow Conventional Commits and contain completed, verified tasks only.
