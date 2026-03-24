/**
 * Electron Main Process
 * 
 * KRİTİK: Bu dosya "Stealth Mode" implementasyonunu içerir.
 * setContentProtection(true) -> macOS NSWindowSharingNone API'sini kullanır.
 * Bu sayede pencere ekran paylaşımı ve ekran kaydında GÖRÜNMEZ olur.
 */

import { app, BrowserWindow, ipcMain, screen, globalShortcut, shell } from 'electron';
import { spawn, ChildProcess, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import * as net from 'net';
import { promisify } from 'util';
import { URL } from 'url';

const execAsync = promisify(exec);
import { fileURLToPath } from 'url';

// Setup Config helper
function getSetupConfigPath() {
    return path.join(app.getPath('userData'), 'live-translate-setup.json');
}

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ZeroMQ import (dynamic to handle native module)
let zmq: typeof import('zeromq') | null = null;

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

interface InteractiveZone {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface SetupConfig {
    isSetupComplete: boolean;
    language?: string;
    engineType?: 'local' | 'cloud';
    wordByWord?: boolean;
    azureSpeechKey?: string;
    azureSpeechRegion?: string;
    deepgramKey?: string;
    deeplKey?: string;
    ollamaEndpoint?: string;
    ollamaApiKey?: string;
    ollamaModel?: string;
}

interface ApiKeyValidationStatus {
    ok: boolean;
    message: string;
}

interface ApiKeyValidationResult {
    ok: boolean;
    azureSpeech: ApiKeyValidationStatus;
    deepgram: ApiKeyValidationStatus;
    deepl: ApiKeyValidationStatus;
}

interface ApiSettingsDraft {
    azureSpeechKey: string;
    azureSpeechRegion: string;
    deepgramKey: string;
    deeplKey: string;
    ollamaEndpoint: string;
    ollamaApiKey: string;
    ollamaModel: string;
}

interface ApiSettingsSaveResult {
    ok: boolean;
    message: string;
    validation?: ApiKeyValidationResult;
    config?: SetupConfig;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECURITY: URL Whitelist for shell.openExternal
// ═══════════════════════════════════════════════════════════════════════════════

const ALLOWED_EXTERNAL_HOSTS = [
    'existential.audio',
    'azure.microsoft.com',
    'learn.microsoft.com',
    'portal.azure.com',
    'speech.microsoft.com',
    'console.deepgram.com',
    'www.deepl.com',
    'deepl.com',
    'github.com',
    'docs.github.com',
];

function isSafeExternalUrl(urlString: string): boolean {
    try {
        const url = new URL(urlString);
        return (
            (url.protocol === 'https:' || url.protocol === 'http:') &&
            ALLOWED_EXTERNAL_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))
        );
    } catch {
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECURITY: Config Schema Validation
// ═══════════════════════════════════════════════════════════════════════════════

const VALID_CONFIG_KEYS = new Set([
    'isSetupComplete',
    'setupComplete',
    'language',
    'engineType',
    'wordByWord',
    'azureSpeechKey',
    'azureSpeechRegion',
    'deepgramKey',
    'deeplKey',
    'ollamaEndpoint',
    'ollamaApiKey',
    'ollamaModel',
]);

function isValidConfig(config: unknown) {
    if (typeof config !== 'object' || config === null || Array.isArray(config)) return false;
    const obj = config as Record<string, unknown>;

    // Only allow known keys
    for (const key of Object.keys(obj)) {
        if (!VALID_CONFIG_KEYS.has(key)) return false;
    }

    return true;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }
}

async function readErrorMessage(response: Response, fallback: string) {
    try {
        const raw = await response.text();
        if (!raw) return fallback;

        try {
            const parsed = JSON.parse(raw);
            if (typeof parsed?.message === 'string') return parsed.message;
            if (typeof parsed?.err_msg === 'string') return parsed.err_msg;
            if (typeof parsed?.detail === 'string') return parsed.detail;
        } catch {
            // Non-JSON error body
        }

        return raw.slice(0, 180);
    } catch {
        return fallback;
    }
}

async function validateDeepgramKey(key?: string): Promise<ApiKeyValidationStatus> {
    if (!key?.trim()) {
        return {
            ok: true,
            message: 'Deepgram anahtari bos birakildi.',
        };
    }

    try {
        const response = await fetchWithTimeout('https://api.deepgram.com/v1/auth/token', {
            method: 'GET',
            headers: {
                Authorization: `Token ${key.trim()}`,
            },
        });

        if (!response.ok) {
            const message = await readErrorMessage(
                response,
                `Deepgram dogrulamasi basarisiz (${response.status})`,
            );
            return { ok: false, message };
        }

        return {
            ok: true,
            message: 'Deepgram anahtari dogrulandi.',
        };
    } catch (error) {
        return {
            ok: false,
            message: `Deepgram baglanti hatasi: ${error instanceof Error ? error.message : 'bilinmeyen hata'}`,
        };
    }
}

async function validateAzureSpeechCredentials(
    key?: string,
    region?: string,
): Promise<ApiKeyValidationStatus> {
    const trimmedKey = key?.trim() ?? '';
    const trimmedRegion = region?.trim().toLowerCase() ?? '';

    if (!trimmedKey && !trimmedRegion) {
        return {
            ok: true,
            message: 'Azure Speech anahtari bos birakildi.',
        };
    }

    if (!trimmedKey || !trimmedRegion) {
        return {
            ok: false,
            message: 'Azure Speech icin hem key hem region gerekli.',
        };
    }

    if (!/^[a-z0-9-]+$/.test(trimmedRegion)) {
        return {
            ok: false,
            message: 'Azure Speech region gecersiz gorunuyor.',
        };
    }

    try {
        const response = await fetchWithTimeout(
            `https://${trimmedRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
            {
                method: 'POST',
                headers: {
                    'Ocp-Apim-Subscription-Key': trimmedKey,
                    'Content-Length': '0',
                },
            },
        );

        if (!response.ok) {
            const message = await readErrorMessage(
                response,
                `Azure Speech dogrulamasi basarisiz (${response.status})`,
            );
            return { ok: false, message };
        }

        return {
            ok: true,
            message: 'Azure Speech anahtari dogrulandi.',
        };
    } catch (error) {
        return {
            ok: false,
            message: `Azure Speech baglanti hatasi: ${error instanceof Error ? error.message : 'bilinmeyen hata'}`,
        };
    }
}

async function validateDeepLKey(key?: string): Promise<ApiKeyValidationStatus> {
    if (!key?.trim()) {
        return {
            ok: true,
            message: 'DeepL anahtari bos birakildi.',
        };
    }

    const trimmedKey = key.trim();
    const baseUrl = trimmedKey.endsWith(':fx')
        ? 'https://api-free.deepl.com'
        : 'https://api.deepl.com';

    try {
        const response = await fetchWithTimeout(`${baseUrl}/v2/usage`, {
            method: 'GET',
            headers: {
                Authorization: `DeepL-Auth-Key ${trimmedKey}`,
            },
        });

        if (!response.ok) {
            const message = await readErrorMessage(
                response,
                `DeepL dogrulamasi basarisiz (${response.status})`,
            );
            return { ok: false, message };
        }

        return {
            ok: true,
            message: 'DeepL anahtari dogrulandi.',
        };
    } catch (error) {
        return {
            ok: false,
            message: `DeepL baglanti hatasi: ${error instanceof Error ? error.message : 'bilinmeyen hata'}`,
        };
    }
}

// Global references
let mainWindow: BrowserWindow | null = null;
let pythonProcess: ChildProcess | null = null;
let zmqSubscriber: any = null;
let commandSock: any = null; // ZMQ Publisher (Streaming komutları için)
let interactiveZones: InteractiveZone[] = [];
let interactionPollingInterval: NodeJS.Timeout | null = null;
let isInteractionEnabled = true;
let hasReceivedZones = false;
let historyWindow: BrowserWindow | null = null; // Transcript history window
let apiSettingsWindow: BrowserWindow | null = null;
let usageGuideWindow: BrowserWindow | null = null;
let latestHistoryTranscripts: unknown[] = [];
let latestApiSettingsDraft: ApiSettingsDraft = {
    azureSpeechKey: '',
    azureSpeechRegion: '',
    deepgramKey: '',
    deeplKey: '',
    ollamaEndpoint: 'http://127.0.0.1:11434',
    ollamaApiKey: '',
    ollamaModel: '',
};
let isQuitting = false;
let isStealthModeMain = false; // Tracks global stealth state for all windows
let pythonRecoveryInFlight = false;

const COMMAND_RETRY_COUNT = 3;
const COMMAND_RETRY_DELAY_MS = 100;
const STALE_ENGINE_SHUTDOWN_RETRIES = 5;
const STALE_ENGINE_SHUTDOWN_DELAY_MS = 150;
const PYTHON_PORT_RELEASE_TIMEOUT_MS = 2000;
const PYTHON_PORT_RELEASE_POLL_MS = 100;
const PYTHON_RECOVERY_RETRY_DELAY_MS = 500;

// Environment
const isDev = !app.isPackaged;
const VITE_DEV_SERVER_URL = 'http://localhost:5174';
const ZMQ_HOST = '127.0.0.1';
const ZMQ_PORT = 5555;
const ZMQ_COMMAND_PORT = 5556;
const ZMQ_ADDRESS = `tcp://${ZMQ_HOST}:${ZMQ_PORT}`;
const ZMQ_COMMAND_ADDRESS = `tcp://${ZMQ_HOST}:${ZMQ_COMMAND_PORT}`;

function getPreloadPath() {
    return isDev
        ? path.join(process.cwd(), 'electron', 'preload.cjs')
        : path.join(__dirname, 'preload.js');
}

function getPythonScriptPath() {
    return isDev
        ? path.join(process.cwd(), 'python', 'engine.py')
        : path.join(process.resourcesPath, 'python', 'engine.py');
}

function getPythonBinaryPath() {
    return isDev
        ? path.join(process.cwd(), 'python', '.venv', 'bin', 'python')
        : path.join(process.resourcesPath, 'python', '.venv', 'bin', 'python');
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeSetupConfig(raw: unknown): SetupConfig {
    if (!isValidConfig(raw)) {
        return { isSetupComplete: false };
    }

    const value = raw as Record<string, unknown>;
    const normalized: SetupConfig = {
        isSetupComplete: Boolean(value.isSetupComplete ?? value.setupComplete),
    };

    if (value.language === 'en' || value.language === 'fi' || value.language === 'tr') {
        normalized.language = value.language;
    }

    if (value.engineType === 'local' || value.engineType === 'cloud') {
        normalized.engineType = value.engineType;
    }

    if (typeof value.wordByWord === 'boolean') {
        normalized.wordByWord = value.wordByWord;
    }

    if (typeof value.azureSpeechKey === 'string') {
        normalized.azureSpeechKey = value.azureSpeechKey;
    }

    if (typeof value.azureSpeechRegion === 'string') {
        normalized.azureSpeechRegion = value.azureSpeechRegion;
    }

    if (typeof value.deepgramKey === 'string') {
        normalized.deepgramKey = value.deepgramKey;
    }

    if (typeof value.deeplKey === 'string') {
        normalized.deeplKey = value.deeplKey;
    }

    if (typeof value.ollamaEndpoint === 'string') {
        normalized.ollamaEndpoint = value.ollamaEndpoint;
    }

    if (typeof value.ollamaApiKey === 'string') {
        normalized.ollamaApiKey = value.ollamaApiKey;
    }

    if (typeof value.ollamaModel === 'string') {
        normalized.ollamaModel = value.ollamaModel;
    }

    return normalized;
}

function readSetupConfig(): SetupConfig {
    try {
        const data = fs.readFileSync(getSetupConfigPath(), 'utf8');
        return normalizeSetupConfig(JSON.parse(data));
    } catch {
        return { isSetupComplete: false };
    }
}

function writeSetupConfig(config: SetupConfig): boolean {
    if (!isValidConfig(config)) {
        return false;
    }

    try {
        const configPath = getSetupConfigPath();
        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return true;
    } catch (error) {
        console.error('[Main] Failed to write setup config:', error);
        return false;
    }
}

function buildApiSettingsDraft(config: SetupConfig): ApiSettingsDraft {
    return {
        azureSpeechKey: config.azureSpeechKey ?? '',
        azureSpeechRegion: (config.azureSpeechRegion ?? '').trim().toLowerCase(),
        deepgramKey: config.deepgramKey ?? '',
        deeplKey: config.deeplKey ?? '',
        ollamaEndpoint: config.ollamaEndpoint ?? 'http://127.0.0.1:11434',
        ollamaApiKey: config.ollamaApiKey ?? '',
        ollamaModel: config.ollamaModel ?? '',
    };
}

function sanitizeApiSettingsDraft(raw: unknown): ApiSettingsDraft {
    const value = (typeof raw === 'object' && raw !== null && !Array.isArray(raw))
        ? raw as Record<string, unknown>
        : {};

    return {
        azureSpeechKey: typeof value.azureSpeechKey === 'string' ? value.azureSpeechKey : '',
        azureSpeechRegion: typeof value.azureSpeechRegion === 'string'
            ? value.azureSpeechRegion.trim().toLowerCase()
            : '',
        deepgramKey: typeof value.deepgramKey === 'string' ? value.deepgramKey : '',
        deeplKey: typeof value.deeplKey === 'string' ? value.deeplKey : '',
        ollamaEndpoint: typeof value.ollamaEndpoint === 'string' ? value.ollamaEndpoint : 'http://127.0.0.1:11434',
        ollamaApiKey: typeof value.ollamaApiKey === 'string' ? value.ollamaApiKey : '',
        ollamaModel: typeof value.ollamaModel === 'string' ? value.ollamaModel : '',
    };
}

function sendHistoryWindowState(isOpen: boolean) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('history-window-state', isOpen);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Transcript History Persister
// ═══════════════════════════════════════════════════════════════════════════════
const TRANSCRIPTS_DIR = path.join(app.getPath('userData'), 'transcripts');
if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
}

function saveFinalizedTranscript(data: any) {
    if (!data.isFinal) return;
    try {
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        
        const filePath = path.join(TRANSCRIPTS_DIR, `${dateStr}.json`);
        let history: any[] = [];
        if (fs.existsSync(filePath)) {
            history = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        
        history.push({
            timestamp: data.timestamp || Date.now(),
            original: data.original || '',
            translated: data.translated || '',
            source: data.source || 'unknown',
            provider: data.translationProvider || 'unknown',
            isFinal: true
        });
        
        fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
    } catch (e) {
        console.error('[Main] Failed to save transcript to history:', e);
    }
}

function notifyApiSettingsUpdated(config: SetupConfig) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('api-settings-updated', config);
    }
}

function isLocalPortInUse(port: number, host = ZMQ_HOST): Promise<boolean> {
    return new Promise(resolve => {
        const server = net.createServer();

        const finish = (inUse: boolean) => {
            server.removeAllListeners();
            resolve(inUse);
        };

        server.once('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'EADDRINUSE') {
                finish(true);
                return;
            }
            console.warn(`[Main] Port probe failed for ${host}:${port}:`, error.message);
            finish(false);
        });

        server.once('listening', () => {
            server.close(() => finish(false));
        });

        server.listen(port, host);
    });
}

async function waitForPortToBeFree(
    port: number,
    timeoutMs = PYTHON_PORT_RELEASE_TIMEOUT_MS,
    pollIntervalMs = PYTHON_PORT_RELEASE_POLL_MS,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (!(await isLocalPortInUse(port))) {
            return true;
        }
        await sleep(pollIntervalMs);
    }

    return !(await isLocalPortInUse(port));
}

function buildHistoryWindowHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>Transcript History</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body {
      background: #09090b;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      padding: 20px;
    }
    .shell {
      height: 100%;
      display: flex;
      flex-direction: column;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.08);
      background: linear-gradient(180deg, rgba(20,20,24,0.96), rgba(10,10,14,0.98));
      overflow: hidden;
      position: relative;
    }
    .header {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      flex-wrap: wrap;
      gap: 12px;
    }
    h1 { font-size: 20px; font-weight: 700; color: #fff; margin: 0; }
    .meta { font-size: 13px; color: rgba(255,255,255,0.55); white-space: nowrap; }
    .controls { display: flex; gap: 8px; align-items: center; }
    .action-btn { padding: 8px 14px; border: none; border-radius: 8px; color: #fff; cursor: pointer; font-weight: 600; font-size: 13px; transition: opacity 0.2s; }
    .action-btn:hover { opacity: 0.9; }
    .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    select { padding: 7px 12px; border-radius: 8px; background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); outline: none; font-size: 13px; cursor: pointer; }
    select option { background: #1a1a20; color: #fff; }
    
    #content {
      flex: 1;
      overflow-y: auto;
      padding: 18px 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .entry {
      display: flex;
      gap: 18px;
      padding: 16px 18px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.03);
      align-items: flex-start;
    }
    .entry.is-live { border-color: rgba(167,139,250,0.28); background: rgba(167,139,250,0.08); }
    .time { color: #a78bfa; font-size: 13px; min-width: 74px; font-variant-numeric: tabular-nums; font-weight: 700; padding-top: 2px; }
    .texts { flex: 1; min-width: 0; }
    .original { font-size: 14px; color: rgba(255,255,255,0.5); font-style: italic; margin-bottom: 6px; line-height: 1.45; word-break: break-word; display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .original-content { flex: 1; }
    .copy-btn { width: 20px; height: 20px; padding: 3px; border-radius: 4px; color: rgba(255, 255, 255, 0.4); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; border: 1px solid transparent; margin-top: -2px; background: transparent; }
    .copy-btn:hover { background: rgba(255,255,255,0.08); color: rgba(255, 255, 255, 0.9); border-color: rgba(255,255,255,0.1); }
    .copy-btn.copied { color: #22c55e; }
    .translated { font-size: 18px; color: #fff; font-weight: 600; line-height: 1.5; word-break: break-word; }
    .badge { display: inline-flex; align-items: center; justify-content: center; margin-left: 10px; padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #e9d5ff; background: rgba(167,139,250,0.16); border: 1px solid rgba(167,139,250,0.22); }
    .empty { margin: auto; color: rgba(255,255,255,0.35); text-align: center; font-size: 15px; padding: 40px; }
    
    #reportOverlay { display: none; position: absolute; top:0; left:0; right:0; bottom:0; background: rgba(9,9,11,0.98); z-index: 100; flex-direction: column; padding: 20px; }
    #reportOverlay .report-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 16px;}
    #reportOverlay textarea { flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #f4f4f5; padding: 16px; font-family: monospace; font-size: 14px; line-height: 1.6; resize: none; outline: none; }
    #reportOverlay textarea:focus { border-color: rgba(167,139,250,0.5); }
  </style>
</head>
<body>
  <div class="shell">
    <div class="header">
      <h1>Transcript History</h1>
      <div class="controls">
        <select id="dateSelect">
          <option value="current">Current Session</option>
        </select>
        <button id="reportBtn" class="action-btn" style="background: #8b5cf6;">Ollama ile Ozetle</button>
        <div id="meta" class="meta">0 entries</div>
      </div>
    </div>
    
    <div id="content"><div class="empty">No transcripts yet.</div></div>
    
    <div id="reportOverlay">
      <div class="report-header">
        <h2 style="font-size: 18px; margin: 0; color: #fff;">Toplanti Ozeti</h2>
        <div style="display: flex; gap: 8px;">
          <button id="saveReportBtn" class="action-btn" style="background: #10b981;">Masustune Kaydet</button>
          <button id="closeReportBtn" class="action-btn" style="background: rgba(255,255,255,0.1);">Kapat</button>
        </div>
      </div>
      <textarea id="reportText" readonly></textarea>
    </div>
  </div>
  <script>
    (() => {
      const content = document.getElementById('content');
      const meta = document.getElementById('meta');
      const dateSelect = document.getElementById('dateSelect');
      const reportBtn = document.getElementById('reportBtn');
      const reportOverlay = document.getElementById('reportOverlay');
      const saveReportBtn = document.getElementById('saveReportBtn');
      const closeReportBtn = document.getElementById('closeReportBtn');
      const reportText = document.getElementById('reportText');

      let currentSessionData = [];
      let loadedData = [];

      const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

      const formatTime = (timestamp) => {
        const normalized = timestamp > 1000000000000 ? timestamp : timestamp * 1000;
        const date = new Date(normalized);
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        const ss = String(date.getSeconds()).padStart(2, '0');
        return \`\${hh}:\${mm}:\${ss}\`;
      };

      const copyIcon = \`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>\`;
      const checkIcon = \`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>\`;

      document.addEventListener('click', (e) => {
        const btn = e.target.closest('.copy-btn');
        if (btn) {
          const text = btn.getAttribute('data-text');
          if (window.electronAPI?.copyToClipboard) {
            window.electronAPI.copyToClipboard(text);
            btn.classList.add('copied');
            btn.innerHTML = checkIcon;
            setTimeout(() => {
              btn.classList.remove('copied');
              btn.innerHTML = copyIcon;
            }, 1500);
          }
        }
      });

      const render = (entries) => {
        const list = Array.isArray(entries) ? [...entries].reverse() : [];
        meta.textContent = \`\${list.length} entries\`;

        if (!list.length) {
          content.innerHTML = '<div class="empty">Bu tarih icin gosterilecek kaydi bulunamadi.</div>';
          return;
        }

        content.innerHTML = list.map((item) => \`
          <div class="entry \${item.isFinal === false ? 'is-live' : ''}">
            <div class="time">\${formatTime(item.timestamp)}</div>
            <div class="texts">
              <div class="original">
                <span class="original-content">
                  \${escapeHtml(item.original)}
                  \${item.isFinal === false ? '<span class="badge">Live</span>' : ''}
                </span>
                <button class="copy-btn" data-text="\${escapeHtml(item.original)}" title="Copy Original">
                  \${copyIcon}
                </button>
              </div>
              <div class="translated">\${escapeHtml(item.translated)}</div>
            </div>
          </div>
        \`).join('');
      };

      // INIT
      if (window.electronAPI?.getHistoryDates) {
        window.electronAPI.getHistoryDates().then(dates => {
          dates.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = \`[\${d}] Arşivi\`;
            dateSelect.appendChild(opt);
          });
        });
      }

      dateSelect.addEventListener('change', async (e) => {
        const val = e.target.value;
        if (val === 'current') {
          loadedData = currentSessionData;
          render(loadedData);
        } else {
          if (window.electronAPI?.getHistoryByDate) {
            const data = await window.electronAPI.getHistoryByDate(val);
            loadedData = data;
            render(loadedData);
          }
        }
      });

      if (window.electronAPI?.onHistoryData) {
        window.electronAPI.onHistoryData((entries) => {
          currentSessionData = entries;
          if (dateSelect.value === 'current') {
            loadedData = currentSessionData;
            render(loadedData);
          }
        });
      }

      // REPORT
      reportBtn.addEventListener('click', async () => {
        if (!loadedData || loadedData.length === 0) {
          alert("Ozetlenecek kayit bulunamadi!");
          return;
        }
        reportBtn.disabled = true;
        reportBtn.textContent = 'Ozetleniyor...';
        try {
          const res = await window.electronAPI.generateOllamaReport(loadedData);
          if (res.ok) {
            reportText.value = res.report;
            reportOverlay.style.display = 'flex';
          } else {
            alert(res.message || 'Rapor olusturulurken hata olustu.');
          }
        } catch (e) {
          alert('Beklenmeyen bir hata olustu.');
        }
        reportBtn.disabled = false;
        reportBtn.textContent = 'Ollama ile Ozetle';
      });

      closeReportBtn.addEventListener('click', () => {
        reportOverlay.style.display = 'none';
      });

      saveReportBtn.addEventListener('click', async () => {
        const text = reportText.value;
        if (!text) return;
        saveReportBtn.disabled = true;
        saveReportBtn.textContent = 'Kaydediliyor...';
        
        try {
          const res = await window.electronAPI.saveReportToDesktop(text);
          if (res.ok) {
            saveReportBtn.textContent = 'Basarili!';
            setTimeout(() => { saveReportBtn.textContent = 'Masaustune Kaydet'; }, 2000);
          } else {
            alert(res.message || 'Kaydedilemedi');
            saveReportBtn.textContent = 'Masaustune Kaydet';
          }
        } catch(e) {
            saveReportBtn.textContent = 'Masaustune Kaydet';
        }
        saveReportBtn.disabled = false;
      });

    })();
  </script>
</body>
</html>`;
}

function buildApiSettingsWindowHtml() {
    return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>API Ayarlari</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body {
      background: #09090b;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      padding: 16px;
    }
    .shell {
      height: 100%;
      display: flex;
      flex-direction: column;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.08);
      background: linear-gradient(180deg, rgba(20,20,24,0.96), rgba(10,10,14,0.98));
      overflow: hidden;
    }
    .header {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 20px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    h1 { font-size: 21px; font-weight: 700; color: #fff; }
    .close {
      width: 36px;
      height: 36px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.72);
      font-size: 24px;
      line-height: 1;
      cursor: pointer;
    }
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 18px 20px 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .desc {
      color: rgba(255,255,255,0.68);
      font-size: 14px;
      line-height: 1.55;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    label {
      font-size: 14px;
      font-weight: 600;
      color: rgba(255,255,255,0.82);
    }
    input {
      width: 100%;
      padding: 14px 15px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.05);
      color: #fff;
      font-size: 15px;
      outline: none;
    }
    input:focus {
      border-color: rgba(96,165,250,0.4);
      box-shadow: 0 0 0 1px rgba(96,165,250,0.18);
    }
    .hint {
      font-size: 13px;
      color: rgba(255,255,255,0.52);
      line-height: 1.45;
    }
    .hint a {
      color: #60a5fa;
      text-decoration: none;
    }
    .status {
      display: none;
      padding: 12px 14px;
      border-radius: 14px;
      font-size: 13px;
      line-height: 1.45;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
    }
    .status.is-success {
      display: block;
      color: #d1fae5;
      border-color: rgba(16,185,129,0.24);
      background: rgba(16,185,129,0.12);
    }
    .status.is-error {
      display: block;
      color: #fecaca;
      border-color: rgba(248,113,113,0.24);
      background: rgba(248,113,113,0.12);
    }
    .footer {
      flex-shrink: 0;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 16px 20px 20px;
      border-top: 1px solid rgba(255,255,255,0.08);
    }
    .btn {
      min-width: 130px;
      padding: 12px 16px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.08);
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn.secondary {
      background: rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.88);
    }
    .btn.primary {
      background: #60a5fa;
      color: #fff;
      border-color: rgba(96,165,250,0.3);
    }
    .btn:disabled, .close:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="header">
      <h1>API Ayarlari</h1>
      <button id="close" class="close" aria-label="Kapat">&times;</button>
    </div>
    <div class="content">
      <p class="desc">
        Bulut modu icin Azure Speech ana motor olarak kullanilir. Deepgram yalnizca fallback, DeepL ise
        ek kalite katmani olarak kalir. Kaydet ve Uygula ile dogrulama anlik yapilir.
      </p>

      <div class="field">
        <label for="azureSpeechKey">Azure Speech Key (Onerilen)</label>
        <input id="azureSpeechKey" type="password" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
      </div>

      <div class="field">
        <label for="azureSpeechRegion">Azure Speech Region</label>
        <input id="azureSpeechRegion" type="text" placeholder="francecentral" />
        <div class="hint">
          <a href="#" data-url="https://portal.azure.com/">Azure Portal</a> veya
          <a href="#" data-url="https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-speech-translation">Kurulum Rehberi</a>
        </div>
      </div>

      <div class="field">
        <label for="deepgramKey">Deepgram API Key (Fallback)</label>
        <input id="deepgramKey" type="password" placeholder="dg_xxxxxxxxxxxxxxxxxxxxxxxxxxx" />
        <div class="hint">
          <a href="#" data-url="https://console.deepgram.com/">Anahtar Al</a>
        </div>
      </div>

      <div class="field">
        <label for="deeplKey">DeepL API Key (Ek Kalite / Yerel Fallback)</label>
        <input id="deeplKey" type="password" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx" />
        <div class="hint">
          <a href="#" data-url="https://www.deepl.com/pro-api">Anahtar Al</a>
        </div>
      </div>

      <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 8px 0;" />

      <div class="field">
        <label for="ollamaEndpoint">Ollama Endpoint URL</label>
        <input id="ollamaEndpoint" type="text" placeholder="http://127.0.0.1:11434" />
      </div>

      <div class="field">
        <label for="ollamaApiKey">Ollama API Key (Opsiyonel)</label>
        <input id="ollamaApiKey" type="password" placeholder="Bearer Token (varsa)" />
      </div>

      <div class="field">
        <label for="ollamaModel">Ollama Model</label>
        <div style="display: flex; gap: 8px;">
          <select id="ollamaModel" style="flex: 1; padding: 14px 15px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.05); color: #fff; font-size: 15px; outline: none;">
            <option value="">Seciniz</option>
          </select>
          <button id="fetchModelsBtn" class="btn secondary" style="min-width: 130px;">Modelleri Getir</button>
        </div>
      </div>

      <div id="status" class="status"></div>
    </div>
    <div class="footer">
      <button id="cancel" class="btn secondary">Vazgec</button>
      <button id="save" class="btn primary">Kaydet ve Uygula</button>
    </div>
  </div>
  <script>
    (() => {
      const fields = {
        azureSpeechKey: document.getElementById('azureSpeechKey'),
        azureSpeechRegion: document.getElementById('azureSpeechRegion'),
        deepgramKey: document.getElementById('deepgramKey'),
        deeplKey: document.getElementById('deeplKey'),
        ollamaEndpoint: document.getElementById('ollamaEndpoint'),
        ollamaApiKey: document.getElementById('ollamaApiKey'),
        ollamaModel: document.getElementById('ollamaModel'),
      };
      const fetchModelsBtn = document.getElementById('fetchModelsBtn');
      const status = document.getElementById('status');
      const saveButton = document.getElementById('save');
      const cancelButton = document.getElementById('cancel');
      const closeButton = document.getElementById('close');

      const setSaving = (saving) => {
        saveButton.disabled = saving;
        cancelButton.disabled = saving;
        closeButton.disabled = saving;
        saveButton.textContent = saving ? 'Dogrulaniyor...' : 'Kaydet ve Uygula';
        Object.values(fields).forEach((input) => {
          input.disabled = saving;
        });
        fetchModelsBtn.disabled = saving;
      };

      const setStatus = (tone, message) => {
        status.className = 'status';
        if (!message) {
          status.textContent = '';
          return;
        }

        status.classList.add(tone === 'success' ? 'is-success' : 'is-error');
        status.textContent = message;
      };

      const closeWindow = () => {
        if (window.electronAPI?.closeCurrentWindow) {
          window.electronAPI.closeCurrentWindow();
          return;
        }
        window.close();
      };

      const openUrl = (url) => {
        if (window.electronAPI?.openUrl) {
          window.electronAPI.openUrl(url);
        }
      };

      closeButton.addEventListener('click', closeWindow);
      cancelButton.addEventListener('click', closeWindow);

      document.querySelectorAll('[data-url]').forEach((anchor) => {
        anchor.addEventListener('click', (event) => {
          event.preventDefault();
          openUrl(anchor.getAttribute('data-url'));
        });
      });

      if (window.electronAPI?.onApiSettingsWindowData) {
        window.electronAPI.onApiSettingsWindowData((data) => {
          fields.azureSpeechKey.value = data.azureSpeechKey || '';
          fields.azureSpeechRegion.value = data.azureSpeechRegion || '';
          fields.deepgramKey.value = data.deepgramKey || '';
          fields.deeplKey.value = data.deeplKey || '';
          fields.ollamaEndpoint.value = data.ollamaEndpoint || 'http://127.0.0.1:11434';
          fields.ollamaApiKey.value = data.ollamaApiKey || '';
          
          if (data.ollamaModel) {
            fields.ollamaModel.innerHTML = '<option value="">Seciniz</option>';
            const opt = document.createElement('option');
            opt.value = data.ollamaModel;
            opt.textContent = data.ollamaModel;
            opt.selected = true;
            fields.ollamaModel.appendChild(opt);
          }

          setStatus('idle', '');
          setSaving(false);
        });
      }
      
      fetchModelsBtn.addEventListener('click', async () => {
        if (!window.electronAPI?.fetchOllamaModels) return;
        fetchModelsBtn.disabled = true;
        fetchModelsBtn.textContent = 'Getiriliyor...';
        try {
          const res = await window.electronAPI.fetchOllamaModels(fields.ollamaEndpoint.value, fields.ollamaApiKey.value);
          if (res.ok && res.models) {
            fields.ollamaModel.innerHTML = '<option value="">Seciniz</option>';
            res.models.forEach(m => {
              const opt = document.createElement('option');
              opt.value = m.name;
              opt.textContent = m.name;
              fields.ollamaModel.appendChild(opt);
            });
            setStatus('success', 'Modeller ba\u015Farıyla getirildi. L\u00FCtfen se\u00E7im yap\u0131n.');
          } else {
            setStatus('error', res.message || 'Model getirme ba\u015Farisiz oldu.');
          }
        } catch (e) {
          setStatus('error', 'Modeller getirilirken hata olu\u015Ftu.');
        }
        fetchModelsBtn.disabled = false;
        fetchModelsBtn.textContent = 'Modelleri Getir';
      });

      saveButton.addEventListener('click', async () => {
        if (!window.electronAPI?.saveApiSettingsWindow) {
          setStatus('error', 'Elektron koprusu hazir degil.');
          return;
        }

        setSaving(true);
        setStatus('idle', '');

        try {
          const result = await window.electronAPI.saveApiSettingsWindow({
            azureSpeechKey: fields.azureSpeechKey.value,
            azureSpeechRegion: fields.azureSpeechRegion.value,
            deepgramKey: fields.deepgramKey.value,
            deeplKey: fields.deeplKey.value,
            ollamaEndpoint: fields.ollamaEndpoint.value,
            ollamaApiKey: fields.ollamaApiKey.value,
            ollamaModel: fields.ollamaModel.value,
          });

          setStatus(result.ok ? 'success' : 'error', result.message);

          if (result.ok) {
            window.setTimeout(closeWindow, 320);
          }
        } catch (error) {
          setStatus('error', 'Kayit sirasinda beklenmeyen bir hata olustu.');
        }

        setSaving(false);
      });
    })();
  </script>
</body>
</html>`;
}

function buildUsageGuideWindowHtml() {
    return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>Kullanim Senaryolari</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body {
      background: #09090b;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      padding: 16px;
    }
    .shell {
      height: 100%;
      display: flex;
      flex-direction: column;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.08);
      background: linear-gradient(180deg, rgba(20,20,24,0.96), rgba(10,10,14,0.98));
      overflow: hidden;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 20px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      flex-shrink: 0;
    }
    h1 { font-size: 20px; font-weight: 700; color: #fff; }
    .close {
      width: 36px;
      height: 36px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.72);
      font-size: 24px;
      cursor: pointer;
    }
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 18px 20px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .desc, .note {
      color: rgba(255,255,255,0.68);
      font-size: 14px;
      line-height: 1.55;
    }
    .card {
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
      padding: 14px 16px;
    }
    .card h2 {
      font-size: 15px;
      color: #fff;
      margin-bottom: 6px;
    }
    .card p {
      font-size: 14px;
      line-height: 1.55;
      color: rgba(255,255,255,0.72);
    }
    .note {
      border-radius: 14px;
      border: 1px solid rgba(96,165,250,0.14);
      background: rgba(96,165,250,0.08);
      padding: 14px 16px;
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="header">
      <h1>Kullanim Senaryolari</h1>
      <button id="close" class="close" aria-label="Kapat">&times;</button>
    </div>
    <div class="content">
      <p class="desc">
        Streaming kapali mod daha rahat geliyorsa bu normaldir. Kapali mod daha stabil okunur; acik mod ise
        konusmaciya yetismek icin daha agresif preview gosterir.
      </p>
      <section class="card">
        <h2>Canli Takip (Onerilen)</h2>
        <p>Bulut modu acik, Streaming acik ve Akici Yazim acik kullan. Bu ayar konusmaciya en yakin deneyimi verir.</p>
      </section>
      <section class="card">
        <h2>Daha Stabil Okuma</h2>
        <p>Streaming kapali kullan. Metin biraz daha gec gelir ama daha buyuk ve daha duzgun bloklar halinde okunur.</p>
      </section>
      <section class="card">
        <h2>Dusuk Dikkat Dagitma</h2>
        <p>Orijinal metni kapat, opakligi 0.88 civarinda ve fontu 22 civarinda tut. Video ustunde en temiz deneyim bu olur.</p>
      </section>
      <section class="card">
        <h2>Teknik Icerik</h2>
        <p>Azure Speech ana motor olarak kullanilir. Azure aktifse Tüm Transcript penceresi de ayni real-time Azure preview/final akisini gosterir.</p>
      </section>
      <div class="note">
        Bulut + Streaming kapali modu daha rahat buluyorsan bunu kullanmak yanlis degil. Sadece en dusuk algilanan gecikme icin streaming acik gerekir.
      </div>
    </div>
  </div>
  <script>
    (() => {
      const closeWindow = () => {
        if (window.electronAPI?.closeCurrentWindow) {
          window.electronAPI.closeCurrentWindow();
          return;
        }
        window.close();
      };

      document.getElementById('close').addEventListener('click', closeWindow);
    })();
  </script>
</body>
</html>`;
}

function pushHistoryDataToWindow() {
    if (historyWindow && !historyWindow.isDestroyed()) {
        historyWindow.webContents.send('history-data', latestHistoryTranscripts);
    }
}

function pushApiSettingsDataToWindow() {
    if (apiSettingsWindow && !apiSettingsWindow.isDestroyed()) {
        apiSettingsWindow.webContents.send('api-settings-window-data', latestApiSettingsDraft);
    }
}

function createUtilityWindow(options: {
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
    title: string;
    backgroundColor?: string;
}): BrowserWindow {
    const win = new BrowserWindow({
        width: options.width,
        height: options.height,
        minWidth: options.minWidth,
        minHeight: options.minHeight,
        center: true,
        title: options.title,
        backgroundColor: options.backgroundColor ?? '#09090b',
        autoHideMenuBar: true,
        webPreferences: {
            preload: getPreloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    // Apply global stealth state
    win.setContentProtection(isStealthModeMain);

    return win;
}

async function saveApiSettingsDraft(draft: unknown): Promise<ApiSettingsSaveResult> {
    const sanitized = sanitizeApiSettingsDraft(draft);
    const validation = await Promise.all([
        validateAzureSpeechCredentials(sanitized.azureSpeechKey, sanitized.azureSpeechRegion),
        validateDeepgramKey(sanitized.deepgramKey),
        validateDeepLKey(sanitized.deeplKey),
    ]).then(([azureSpeech, deepgram, deepl]) => ({
        ok: azureSpeech.ok && deepgram.ok && deepl.ok,
        azureSpeech,
        deepgram,
        deepl,
    }));

    if (!validation.ok) {
        const problems = [validation.azureSpeech, validation.deepgram, validation.deepl]
            .filter((item) => !item.ok)
            .map((item) => item.message);

        return {
            ok: false,
            message: problems.join(' '),
            validation,
        };
    }

    const hasAzure = Boolean(sanitized.azureSpeechKey.trim() && sanitized.azureSpeechRegion.trim());
    const hasCloudProvider = hasAzure || Boolean(sanitized.deepgramKey.trim());
    const currentConfig = readSetupConfig();
    const previousEngineType = currentConfig.engineType ?? 'local';
    const nextEngineType =
        !hasCloudProvider && previousEngineType === 'cloud'
            ? 'local'
            : hasCloudProvider && previousEngineType === 'local'
                ? 'cloud'
                : previousEngineType;

    const nextConfig: SetupConfig = {
        ...currentConfig,
        isSetupComplete: currentConfig.isSetupComplete ?? false,
        azureSpeechKey: sanitized.azureSpeechKey.trim(),
        azureSpeechRegion: sanitized.azureSpeechRegion.trim().toLowerCase(),
        deepgramKey: sanitized.deepgramKey.trim(),
        deeplKey: sanitized.deeplKey.trim(),
        ollamaEndpoint: sanitized.ollamaEndpoint?.trim(),
        ollamaApiKey: sanitized.ollamaApiKey?.trim(),
        ollamaModel: sanitized.ollamaModel?.trim(),
        engineType: nextEngineType,
    };

    if (!writeSetupConfig(nextConfig)) {
        return {
            ok: false,
            message: 'API ayarlari dogrulandi ama config diske yazilamadi.',
            validation,
        };
    }

    latestApiSettingsDraft = buildApiSettingsDraft(nextConfig);

    await broadcastCommand({
        type: 'update_keys',
        azureSpeech: nextConfig.azureSpeechKey,
        azureSpeechRegion: nextConfig.azureSpeechRegion,
        deepgram: nextConfig.deepgramKey,
        deepl: nextConfig.deeplKey,
    }, 'update_keys');

    if (nextEngineType !== previousEngineType) {
        await broadcastCommand({
            type: 'config',
            key: 'engine_type',
            value: nextEngineType,
        }, 'engine_type');
    }

    notifyApiSettingsUpdated(nextConfig);

    return {
        ok: true,
        message: 'API ayarlari dogrulandi, kaydedildi ve engine tarafina iletildi.',
        validation,
        config: nextConfig,
    };
}

/**
 * Stealth BrowserWindow Konfigürasyonu
 * 
 * Bu fonksiyon ekran paylaşımına görünmez bir pencere oluşturur.
 * macOS'ta NSWindowSharingNone kullanılarak bu sağlanır.
 */
function createStealthWindow(): BrowserWindow {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    // If setup is not complete, show a larger window for the wizard
    const setupConfig = readSetupConfig();
    const windowHeight = setupConfig.isSetupComplete ? 280 : 600;

    const windowWidth = Math.min(1000, Math.floor(screenWidth * 0.75));
    const xPosition = Math.floor((screenWidth - windowWidth) / 2);
    const yPosition = screenHeight - windowHeight - 30;

    const preloadPath = getPreloadPath();

    const win = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        x: xPosition,
        y: yPosition,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        hasShadow: false,
        focusable: true,
        skipTaskbar: true,
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webSecurity: !isDev,
        },
    });

    // Match the current global stealth state
    win.setContentProtection(isStealthModeMain);

    // Visible on all Spaces and full-screen apps
    if (process.platform === 'darwin') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    return win;
}

/**
 * Python AI Engine'i başlat
 */
function startPythonEngine(): ChildProcess | null {
    const pythonPath = getPythonScriptPath();
    const venvPython = getPythonBinaryPath();
    let sawZmqBindConflict = false;

    console.log('[Main] Starting Python engine:', pythonPath);
    console.log('[Main] Using Python:', venvPython);

    // Setup Config üzerinden API Key okuma
    let env = { ...process.env };
    const setupConfig = readSetupConfig();
    if (setupConfig.azureSpeechKey) env.AZURE_SPEECH_KEY = setupConfig.azureSpeechKey;
    if (setupConfig.azureSpeechRegion) env.AZURE_SPEECH_REGION = setupConfig.azureSpeechRegion;
    if (setupConfig.deepgramKey) env.DEEPGRAM_API_KEY = setupConfig.deepgramKey;
    if (setupConfig.deeplKey) env.DEEPL_API_KEY = setupConfig.deeplKey;
    if (setupConfig.language) env.ENGINE_SOURCE_LANG = setupConfig.language;
    if (setupConfig.engineType) env.ENGINE_TYPE = setupConfig.engineType;

    try {
        const proc = spawn(venvPython, [pythonPath], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: env,
            detached: false,
        });

        proc.stdout?.on('data', (data: Buffer) => {
            const output = data.toString().trim();
            console.log('[Python]', output);

            // Parse [TRANSCRIPT] messages and send to renderer
            const lines = output.split('\n');
            for (const line of lines) {
                if (line.includes('[TRANSCRIPT]')) {
                    try {
                        // Extract JSON from [TRANSCRIPT] {...}
                        const jsonMatch = line.match(/\[TRANSCRIPT\]\s*(.+)/);
                        if (jsonMatch && jsonMatch[1]) {
                            const transcriptData = JSON.parse(jsonMatch[1]);

                            // Send to renderer
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('transcript-update', transcriptData);
                                saveFinalizedTranscript(transcriptData);
                                // console.log('[Main] Sent transcript to renderer:', transcriptData.translated);
                            }
                        }
                    } catch (parseError) {
                        // Not valid JSON, ignore
                    }
                } else if (line.includes('[Engine] Started successfully')) {
                    console.log('[Main] Python engine ready signal detected');
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('engine-ready');
                    }
                }
            }
        });

        proc.stderr?.on('data', (data: Buffer) => {
            const errorMsg = data.toString().trim();
            if (errorMsg.includes('Address already in use') && errorMsg.includes(String(ZMQ_PORT))) {
                sawZmqBindConflict = true;
            }
            console.error('[Python Error]', errorMsg);
            // Forward to renderer via safe IPC (no executeJavaScript)
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('engine-log', `[Python] ${errorMsg}`);
            }
        });

        proc.on('close', (code: number | null) => {
            console.log(`[Python] Process exited with code ${code}`);
            if (pythonProcess?.pid === proc.pid) {
                pythonProcess = null;
            }

            if (!isQuitting && sawZmqBindConflict) {
                console.warn('[Main] Python hit a ZMQ bind conflict; retrying after stale-engine cleanup');
                setTimeout(() => {
                    void launchPythonEngineWithRecovery('bind-conflict');
                }, PYTHON_RECOVERY_RETRY_DELAY_MS);
            }
        });

        proc.on('error', (err: Error) => {
            console.error('[Python] Failed to start:', err.message);
        });

        return proc;
    } catch (error) {
        console.error('[Main] Failed to spawn Python process:', error);
        return null;
    }
}

/**
 * ZeroMQ Subscriber başlat
 * Python engine'den gelen transkript mesajlarını dinler
 */
async function startZmqSubscriber(): Promise<void> {
    try {
        zmq = await import('zeromq');
        const subscriber = new zmq.Subscriber();

        subscriber.connect(ZMQ_ADDRESS);
        subscriber.subscribe(''); // Tüm mesajları al

        console.log(`[ZMQ] Subscriber connected to ${ZMQ_ADDRESS}`);
        zmqSubscriber = subscriber;

        // Mesaj döngüsü
        (async () => {
            for await (const [msg] of subscriber) {
                try {
                    const data = JSON.parse(msg.toString());

                    // Renderer'a gönder
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        if (data.type === 'audio_level') {
                            // Visualizer update (High frequency)
                            mainWindow.webContents.send('audio-level', data.level);
                        } else {
                            // Transcript update
                            mainWindow.webContents.send('transcript-update', data);
                            saveFinalizedTranscript(data);
                        }
                    }
                } catch (parseError) {
                    console.error('[ZMQ] Failed to parse message:', parseError);
                }
            }
        })();
    } catch (error) {
        console.error('[ZMQ] Failed to start subscriber:', error);
        console.log('[ZMQ] Falling back to mock data for development...');

        // Development fallback: Mock data
        if (isDev) {
            setInterval(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('transcript-update', {
                        original: 'This is a test transcription...',
                        translated: 'Bu bir test transkripsiyonu...',
                        timestamp: Date.now(),
                        isFinal: true,
                    });
                }
            }, 3000);
        }
    }
}

/**
 * ZeroMQ Publisher başlat (Command Channel)
 */
async function startZmqPublisher(): Promise<void> {
    try {
        const zmq = await import('zeromq');
        commandSock = new zmq.Publisher();
        await commandSock.bind(ZMQ_COMMAND_ADDRESS);
        console.log(`[ZMQ] Command Publisher bound to ${ZMQ_COMMAND_ADDRESS}`);
    } catch (error) {
        console.error('[ZMQ] Failed to start publisher:', error);
    }
}

async function broadcastCommand(
    payload: Record<string, unknown>,
    label: string,
    attempts = COMMAND_RETRY_COUNT,
    delayMs = COMMAND_RETRY_DELAY_MS,
): Promise<boolean> {
    if (!commandSock) {
        console.warn(`[Main] ${label} skipped: command socket not ready`);
        return false;
    }

    let sent = false;

    for (let i = 0; i < attempts; i++) {
        try {
            await commandSock.send(JSON.stringify(payload));
            sent = true;
            if (i === 0) {
                console.log(`[Main] ${label} sent`);
            }
        } catch (err) {
            console.error(`[Main] ${label} send error:`, err);
        }

        if (i < attempts - 1) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    return sent;
}

async function requestStaleEngineShutdown(): Promise<void> {
    if (!commandSock) {
        return;
    }

    if (!(await isLocalPortInUse(ZMQ_PORT))) {
        return;
    }

    await broadcastCommand(
        { type: 'shutdown' },
        'shutdown stale python',
        STALE_ENGINE_SHUTDOWN_RETRIES,
        STALE_ENGINE_SHUTDOWN_DELAY_MS,
    );
}

async function terminateLingeringPythonEngines(): Promise<number[]> {
    if (process.platform === 'win32') {
        return [];
    }

    const scriptPath = getPythonScriptPath().replace(/\\/g, '/');

    try {
        const { stdout } = await execAsync('ps -axo pid=,command=');
        const terminated: number[] = [];

        for (const line of stdout.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }

            const match = trimmed.match(/^(\d+)\s+(.+)$/);
            if (!match) {
                continue;
            }

            const pid = Number(match[1]);
            const command = match[2].replace(/\\/g, '/');

            if (!Number.isFinite(pid) || pid <= 0) {
                continue;
            }

            if (!command.includes(scriptPath)) {
                continue;
            }

            if (pythonProcess?.pid && pid === pythonProcess.pid) {
                continue;
            }

            try {
                process.kill(pid, 'SIGTERM');
                terminated.push(pid);
            } catch (error) {
                console.warn(`[Main] Failed to terminate lingering Python engine PID ${pid}:`, error);
            }
        }

        if (terminated.length > 0) {
            console.warn(`[Main] Terminated lingering Python engine(s): ${terminated.join(', ')}`);
        }

        return terminated;
    } catch (error) {
        console.warn('[Main] Failed to scan for lingering Python engines:', error);
        return [];
    }
}

async function recoverStalePythonEngines(): Promise<boolean> {
    await requestStaleEngineShutdown();
    const terminated = await terminateLingeringPythonEngines();
    const portFreed = await waitForPortToBeFree(
        ZMQ_PORT,
        terminated.length > 0 ? PYTHON_PORT_RELEASE_TIMEOUT_MS : PYTHON_PORT_RELEASE_TIMEOUT_MS / 2,
    );

    if (!portFreed) {
        console.warn(`[Main] Port ${ZMQ_PORT} is still busy after recovery attempts`);
    }

    return portFreed;
}

async function launchPythonEngineWithRecovery(reason: string): Promise<void> {
    if (isQuitting) {
        return;
    }

    if (pythonRecoveryInFlight) {
        console.log(`[Main] Python recovery already in progress (${reason})`);
        return;
    }

    pythonRecoveryInFlight = true;

    try {
        console.log(`[Main] Preparing Python engine launch (${reason})...`);
        const portFreed = await recoverStalePythonEngines();

        if (!portFreed) {
            const message = `[Main] Python launch aborted: ZMQ port ${ZMQ_PORT} is still occupied`;
            console.error(message);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('engine-log', message);
            }
            return;
        }

        if (!pythonProcess) {
            pythonProcess = startPythonEngine();
        }
    } finally {
        pythonRecoveryInFlight = false;
    }
}

/**
 * Interaction Polling (macOS Click-Through Fix)
 * 
 * macOS'te setIgnoreMouseEvents(true, { forward: true }) forward etmediği için,
 * main process üzerinden cursor takibi yapıyoruz.
 */
function startInteractionPolling() {
    if (interactionPollingInterval) clearInterval(interactionPollingInterval);

    interactionPollingInterval = setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;

        // Don't do anything until we've received zones at least once
        if (!hasReceivedZones) return;

        const cursor = screen.getCursorScreenPoint();
        const [winX, winY] = mainWindow.getPosition();

        // Cursor'ın pencere içindeki göreceli konumu
        const relX = cursor.x - winX;
        const relY = cursor.y - winY;

        let shouldEnable = false;

        // Zone kontrolü
        for (const zone of interactiveZones) {
            if (
                relX >= zone.x &&
                relX <= zone.x + zone.width &&
                relY >= zone.y &&
                relY <= zone.y + zone.height
            ) {
                shouldEnable = true;
                break;
            }
        }

        // Durum değişikliği varsa uygula
        if (shouldEnable !== isInteractionEnabled) {
            if (shouldEnable) {
                mainWindow.setIgnoreMouseEvents(false);
            } else {
                // When ignoring, we still want to forward events to a potential overlay underneath,
                // but Electron's setIgnoreMouseEvents(true, {forward: true}) is the standard way.
                mainWindow.setIgnoreMouseEvents(true, { forward: true });
            }
            isInteractionEnabled = shouldEnable;
        }

    }, 200); // 200ms polling rate - safer for performance
}

/**
 * IPC Handlers
 */
function setupIpcHandlers(): void {
    // Interactive Zones Update
    ipcMain.on('update-interactive-zones', (_event, zones) => {
        interactiveZones = zones;
        if (!hasReceivedZones && zones.length > 0) {
            hasReceivedZones = true;
            console.log('[Main] First zones received, polling now active');
        }
    });

    // Mouse olaylarını yönet (drag için)
    ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean, options?: { forward: boolean }) => {
        if (mainWindow) {
            try {
                mainWindow.setIgnoreMouseEvents(ignore, options);
            } catch (e) {
                console.error('[Main] Failed to set ignore mouse events:', e);
            }
        }
    });

    // Pencere pozisyonunu ayarla
    ipcMain.on('move-window', (_event, deltaX: number, deltaY: number) => {
        if (mainWindow) {
            const [x, y] = mainWindow.getPosition();
            mainWindow.setPosition(x + deltaX, y + deltaY);
        }
    });

    // Pencere yüksekliğini ayarla (Dynamic Resizing) - keep top edge stable
    ipcMain.on('set-window-height', (_event, height: number) => {
        if (mainWindow) {
            try {
                const [currentWidth, currentHeight] = mainWindow.getSize();
                const [currentX, currentY] = mainWindow.getPosition();

                // Minimum yükseklik kontrolü
                const newHeight = Math.max(180, height);
                const heightDiff = newHeight - currentHeight;

                if (Math.abs(heightDiff) < 2) return;

                mainWindow.setBounds({
                    x: currentX,
                    // Keep the bottom edge fixed so the control bar does not "jump" upward
                    // when content is hidden (for example when entering stealth mode).
                    y: currentY - heightDiff,
                    width: currentWidth,
                    height: Math.floor(newHeight)
                });
            } catch (e) {
                console.error('[Main] Resize error:', e);
            }
        }
    });

    // ═══════════════════════════════════════════════════════════════
    // Setup Wizard IPC Handlers
    // ═══════════════════════════════════════════════════════════════
    ipcMain.handle('get-config', () => {
        return readSetupConfig();
    });

    ipcMain.handle('save-config', async (_event, config) => {
        // Validate config schema before writing to disk
        if (!isValidConfig(config)) {
            console.warn('[Main] Invalid config rejected:', JSON.stringify(config));
            return false;
        }
        const normalized = normalizeSetupConfig(config);

        if (!writeSetupConfig(normalized)) {
            return false;
        }

        latestApiSettingsDraft = buildApiSettingsDraft(normalized);
        console.log('[Main] Config saved successfully to:', getSetupConfigPath());

        await broadcastCommand({
            type: 'update_keys',
            azureSpeech: normalized.azureSpeechKey,
            azureSpeechRegion: normalized.azureSpeechRegion,
            deepgram: normalized.deepgramKey,
            deepl: normalized.deeplKey
        }, 'update_keys');

        notifyApiSettingsUpdated(normalized);
        return true;
    });

    ipcMain.handle('validate-api-keys', async (_event, keys): Promise<ApiKeyValidationResult> => {
        const azureSpeech = await validateAzureSpeechCredentials(
            keys?.azureSpeechKey,
            keys?.azureSpeechRegion,
        );
        const deepgram = await validateDeepgramKey(keys?.deepgramKey);
        const deepl = await validateDeepLKey(keys?.deeplKey);

        return {
            ok: azureSpeech.ok && deepgram.ok && deepl.ok,
            azureSpeech,
            deepgram,
            deepl,
        };
    });

    ipcMain.handle('fetch-ollama-models', async (_event, endpoint: string, apiKey: string) => {
        try {
            const baseUrl = (endpoint || 'http://127.0.0.1:11434').replace(/\/$/, '');
            const headers: Record<string, string> = {};
            if (apiKey?.trim()) {
                headers['Authorization'] = `Bearer ${apiKey.trim()}`;
            }
            const response = await fetchWithTimeout(`${baseUrl}/api/tags`, {
                headers
            }, 5000);
            
            if (!response.ok) {
                return { ok: false, message: `Ollama hatasi: ${response.status} ${response.statusText}` };
            }
            const data: any = await response.json();
            return { ok: true, models: data.models || [] };
        } catch (error) {
            return { ok: false, message: `Baglanti hatasi: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}` };
        }
    });

    ipcMain.handle('check-blackhole', async () => {
        try {
            console.log('[Main] Checking for BlackHole audio driver...');
            // Broad search for any variation of BlackHole
            const { stdout } = await execAsync('/usr/sbin/system_profiler SPAudioDataType');
            const found = stdout.toLowerCase().includes('blackhole');
            console.log(`[Main] BlackHole detection result: ${found}`);
            return found;
        } catch (e) {
            console.error('[Main] BlackHole check failed:', e);
            return false;
        }
    });

    ipcMain.on('open-url', (_event, url: string) => {
        if (isSafeExternalUrl(url)) {
            console.log('[Main] Opening URL:', url);
            shell.openExternal(url).catch(err => {
                console.error('[Main] Failed to open URL:', err);
            });
        } else {
            console.warn('[Main] Blocked unsafe external URL:', url);
        }
    });

    ipcMain.handle('get-history-dates', async () => {
        try {
            if (!fs.existsSync(TRANSCRIPTS_DIR)) return [];
            const files = fs.readdirSync(TRANSCRIPTS_DIR);
            return files.filter(f => f.endsWith('.json')).map(f => f.substring(0, f.length - 5)).sort().reverse();
        } catch { return []; }
    });

    ipcMain.handle('get-history-by-date', async (_event, dateStr: string) => {
        try {
            const filePath = path.join(TRANSCRIPTS_DIR, `${dateStr}.json`);
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
        } catch {}
        return [];
    });

    ipcMain.handle('generate-ollama-report', async (_event, transcripts) => {
        try {
            const config = readSetupConfig();
            if (!config.ollamaEndpoint || !config.ollamaModel) {
                return { ok: false, message: 'Ollama URL veya Model secilmedi. Lutfen API Ayarlarini kontrol edin.' };
            }
            const baseUrl = config.ollamaEndpoint.replace(/\/$/, '');
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (config.ollamaApiKey?.trim()) {
                headers['Authorization'] = `Bearer ${config.ollamaApiKey.trim()}`;
            }

            let fullText = transcripts.map((t: any) => `[${new Date(t.timestamp).toLocaleTimeString()}] ${t.original || t.translated}`).join('\n');
            const prompt = `Sen profesyonel bir yazılım toplantısı asistanısın. Aşağıdaki toplantı dökümünü incele. Toplantının amacını, konuşulan ana konuları, alınan kararları ve Doğan'ın (veya genel olarak ekibin) yapması gereken görevleri (Action Items) maddeler halinde Türkçe özetle.\n\nToplantı Dökümü:\n${fullText}`;

            const response = await fetchWithTimeout(`${baseUrl}/api/chat`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: config.ollamaModel,
                    messages: [{ role: 'user', content: prompt }],
                    stream: false
                })
            }, 120000); // 120s timeout for large models

            if (!response.ok) {
                return { ok: false, message: `Ollama Hatasi: ${response.status} ${response.statusText}` };
            }
            
            const data: any = await response.json();
            return { ok: true, report: data.message?.content || '' };
        } catch (e: any) {
            return { ok: false, message: e.message };
        }
    });

    ipcMain.handle('save-report-to-desktop', async (_event, reportText) => {
        try {
            const { dialog } = await import('electron');
            const dateStr = new Date().toISOString().split('T')[0];
            const defaultPath = path.join(app.getPath('desktop'), `Toplanti_Ozeti_${dateStr}.md`);
            
            const result = await dialog.showSaveDialog({
                defaultPath,
                filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }]
            });

            if (!result.canceled && result.filePath) {
                fs.writeFileSync(result.filePath, reportText, 'utf8');
                return { ok: true };
            }
            return { ok: false, message: 'Iptal edildi' };
        } catch (e: any) {
            return { ok: false, message: e.message };
        }
    });

    ipcMain.on('close-current-window', (event) => {
        const currentWindow = BrowserWindow.fromWebContents(event.sender);
        if (currentWindow && currentWindow !== mainWindow) {
            currentWindow.close();
        }
    });

    ipcMain.on('open-api-settings-window', (_event, draft) => {
        const savedDraft = buildApiSettingsDraft(readSetupConfig());
        latestApiSettingsDraft =
            typeof draft === 'object' && draft !== null && !Array.isArray(draft)
                ? sanitizeApiSettingsDraft(draft)
                : savedDraft;

        if (apiSettingsWindow && !apiSettingsWindow.isDestroyed()) {
            apiSettingsWindow.close();
            return;
        }

        if (usageGuideWindow && !usageGuideWindow.isDestroyed()) {
            usageGuideWindow.close();
        }

        apiSettingsWindow = createUtilityWindow({
            width: 760,
            height: 780,
            minWidth: 680,
            minHeight: 720,
            title: 'API Ayarlari',
        });

        apiSettingsWindow.webContents.on('did-finish-load', () => {
            pushApiSettingsDataToWindow();
        });

        apiSettingsWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildApiSettingsWindowHtml())}`);

        apiSettingsWindow.on('closed', () => {
            apiSettingsWindow = null;
        });
    });

    ipcMain.handle('save-api-settings-window', async (_event, draft) => {
        return saveApiSettingsDraft(draft);
    });

    ipcMain.on('open-usage-guide-window', () => {
        if (usageGuideWindow && !usageGuideWindow.isDestroyed()) {
            usageGuideWindow.close();
            return;
        }

        if (apiSettingsWindow && !apiSettingsWindow.isDestroyed()) {
            apiSettingsWindow.close();
        }

        usageGuideWindow = createUtilityWindow({
            width: 720,
            height: 560,
            minWidth: 640,
            minHeight: 500,
            title: 'Kullanim Senaryolari',
        });

        usageGuideWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildUsageGuideWindowHtml())}`);

        usageGuideWindow.on('closed', () => {
            usageGuideWindow = null;
        });
    });

    // ═══════════════════════════════════════════════════════════════

    // Streaming Modu Ayarla
    ipcMain.on('set-streaming-mode', (_event, enabled: boolean) => {
        console.log(`[Main] Set streaming mode: ${enabled}`);
        void broadcastCommand({
            type: 'config',
            key: 'streaming_mode',
            value: enabled
        }, 'streaming_mode');
    });

    // Language Change (Dynamic) - retried for ZMQ slow joiner safety
    ipcMain.on('set-language', async (_event, lang: string) => {
        console.log(`[Main] Set language: ${lang}`);
        await broadcastCommand({
            type: 'config',
            key: 'source_lang',
            value: lang
        }, 'source_lang');
    });

    // Engine Type Change (local / cloud)
    ipcMain.on('set-engine-type', async (_event, engineType: string) => {
        console.log(`[Main] Set engine type: ${engineType}`);
        await broadcastCommand({
            type: 'config',
            key: 'engine_type',
            value: engineType
        }, 'engine_type');
    });

    // Python engine'i yeniden başlat (graceful shutdown + respawn)
    ipcMain.on('restart-engine', () => {
        if (pythonProcess) {
            const pid = pythonProcess.pid;
            pythonProcess.kill('SIGTERM');
            // Force kill fallback after 1.5s if still alive
            if (pid) {
                setTimeout(() => {
                    try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
                }, 1500);
            }
        }
        // Delay respawn to let old process clean up
        setTimeout(() => {
            pythonProcess = startPythonEngine();
        }, 500);
    });

    // Stealth mode toggle (macOS only — no-op on other platforms)
    ipcMain.on('toggle-stealth', (_event, enabled: boolean) => {
        isStealthModeMain = enabled;
        const allWindows = BrowserWindow.getAllWindows();

        for (const win of allWindows) {
            if (!win.isDestroyed()) {
                win.setContentProtection(enabled);
            }
        }

        if (process.platform !== 'darwin' && enabled) {
            console.warn('[Main] setContentProtection is only effective on macOS');
        }
    });

    ipcMain.on('set-listening', (_event, enabled: boolean) => {
        console.log(`[Main] Set listening: ${enabled}`);
        void broadcastCommand({
            type: 'config',
            key: 'is_listening',
            value: enabled
        }, 'is_listening');
    });

    // Opacity
    ipcMain.on('set-opacity', (_event, opacity: number) => {
        if (mainWindow) {
            mainWindow.setOpacity(Math.max(0.1, Math.min(1, opacity)));
        }
    });

    // Restore focus (used by the show-control-bar button)
    ipcMain.on('force-focus', () => {
        if (mainWindow) {
            mainWindow.setAlwaysOnTop(true, 'screen-saver');
            mainWindow.show();
            mainWindow.moveTop();
            mainWindow.focus();
        }
    });

    // Show control bar (sent by global shortcut or tray click)
    ipcMain.on('show-control-bar', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('show-control-bar');
            mainWindow.show();
            mainWindow.focus();
        }
    });

    // Open history in a separate native window (toggle behavior)
    ipcMain.on('open-history-window', (_event, transcripts) => {
        latestHistoryTranscripts = Array.isArray(transcripts) ? transcripts : [];

        if (historyWindow && !historyWindow.isDestroyed()) {
            historyWindow.close();
            return;
        }

        const { width, height } = screen.getPrimaryDisplay().workAreaSize;

        historyWindow = new BrowserWindow({
            width: Math.min(1600, Math.floor(width * 0.9)),
            height: Math.min(1100, Math.floor(height * 0.9)),
            minWidth: Math.min(960, Math.floor(width * 0.75)),
            minHeight: Math.min(640, Math.floor(height * 0.7)),
            center: true,
            title: 'Transcript History',
            backgroundColor: '#09090b',
            autoHideMenuBar: true,
            webPreferences: {
                preload: getPreloadPath(),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
            },
        });

        // Apply global stealth state
        historyWindow.setContentProtection(isStealthModeMain);

        historyWindow.webContents.on('did-finish-load', () => {
            pushHistoryDataToWindow();
            sendHistoryWindowState(true);
        });

        historyWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHistoryWindowHtml())}`);

        historyWindow.on('closed', () => {
            historyWindow = null;
            sendHistoryWindowState(false);
        });
    });

    ipcMain.on('update-history-window', (_event, transcripts) => {
        latestHistoryTranscripts = Array.isArray(transcripts) ? transcripts : [];
        pushHistoryDataToWindow();
    });

    // Quit
    ipcMain.on('app-quit', () => {
        app.quit();
    });

    // App info
    ipcMain.handle('get-app-info', () => ({
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        isDev,
    }));
}

/**
 * App Lifecycle
 */
// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
            mainWindow.show();
        }
    });

    app.whenReady().then(async () => {
        setupIpcHandlers();

        // ─── Start ZMQ publisher FIRST so commandSock is ready before the
        //     renderer loads and fires IPC calls (e.g. save-config / setLanguage).
        //     Previously commandSock was null when those early IPC messages arrived,
        //     causing "Socket is blocked by a bind or unbind operation" (EBUSY).
        await startZmqPublisher();

        mainWindow = createStealthWindow();

        // ─── Production Debugging: Error Listeners ───────────────────────────
        mainWindow.webContents.on('did-fail-load', (_event: any, errorCode: number, errorDescription: string, validatedURL: string) => {
            console.error(`[Main] Failed to load URL: ${validatedURL}`);
            console.error(`       Error: ${errorDescription} (${errorCode})`);
        });

        mainWindow.webContents.on('render-process-gone', (_event: any, details: any) => {
            console.error(`[Main] Renderer process gone. Reason: ${details.reason}, Exit Code: ${details.exitCode}`);
            // Auto-recovery: reload the window after a brief delay
            if (mainWindow && !mainWindow.isDestroyed()) {
                console.log('[Main] Attempting auto-recovery by reloading renderer...');
                setTimeout(() => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.reload();
                    }
                }, 1000);
            }
        });

        mainWindow.webContents.on('unresponsive', () => {
            console.warn('[Main] Window became unresponsive');
        });

        // ─── Renderer Console to Main Log ──────────────────────────────────
        mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
            const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
            console.log(`[Renderer ${levels[level] || 'LOG'}] ${message} (${sourceId}:${line})`);
        });

        try {
            if (isDev) {
                await mainWindow.loadURL(VITE_DEV_SERVER_URL);
            } else {
                // Production Path Resolution
                const indexHtml = path.resolve(__dirname, '..', 'dist', 'index.html');
                console.log('[Main] Loading production HTML:', indexHtml);

                if (!fs.existsSync(indexHtml)) {
                    console.error('[Main] CRITICAL: index.html not found at:', indexHtml);
                }

                await mainWindow.loadFile(indexHtml);
            }

            // Explicitly show and focus the window
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                mainWindow.focus();
                // Ensure it's on top of other windows
                mainWindow.setAlwaysOnTop(true, 'screen-saver');
            }
        } catch (err) {
            console.error('[Main] Failed to load URL/File:', err);
        }

        // Delay Python engine startup to let Vite dev server stabilize
        setTimeout(() => {
            void launchPythonEngineWithRecovery('startup');
        }, 1000);

        // Start ZMQ subscriber after Python has had time to bind its port
        setTimeout(() => {
            startZmqSubscriber();
        }, 2000);

        startInteractionPolling();

        // Global shortcut: ⌘+Shift+S (macOS) / Ctrl+Shift+S (Win/Linux) to show control bar
        const shortcut = process.platform === 'darwin' ? 'Command+Shift+S' : 'Ctrl+Shift+S';
        const registered = globalShortcut.register(shortcut, () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('show-control-bar');
                mainWindow.show();
                mainWindow.moveTop();
                mainWindow.focus();
            }
        });
        if (!registered) {
            console.warn(`[Main] Failed to register global shortcut: ${shortcut}. It may be in use by another app.`);
        } else {
            console.log(`[Main] Global shortcut registered: ${shortcut}`);
        }
    });
}

// macOS: Tüm pencereler kapandığında çık
app.on('window-all-closed', () => {
    // Reset click-through before quitting
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            mainWindow.setIgnoreMouseEvents(false);
        } catch (e) {
            // Ignore
        }
    }

    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// macOS: Dock ikonuna tıklandığında
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createStealthWindow();
    }
});

// Cleanup
app.on('before-quit', () => {
    console.log('[Main] Cleaning up...');
    isQuitting = true;

    // Unregister all global shortcuts
    globalShortcut.unregisterAll();

    // CRITICAL: Reset click-through to prevent stuck mouse state
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            mainWindow.setIgnoreMouseEvents(false);
            console.log('[Main] Click-through disabled');
        } catch (e) {
            // Ignore if window is already destroyed
        }
    }

    if (interactionPollingInterval) {
        clearInterval(interactionPollingInterval);
        interactionPollingInterval = null;
    }

    if (pythonProcess) {
        console.log('[Main] Killing Python process...');
        pythonProcess.kill('SIGTERM'); // Try graceful kill first

        // Force kill fallback if it doesn't exit in 1000ms
        const pid = pythonProcess.pid;
        if (pid) {
            setTimeout(() => {
                try {
                    process.kill(pid, 'SIGKILL');
                    console.log('[Main] Force killed Python process');
                } catch (e) {
                    // Ignore if already dead
                }
            }, 1000);
        }

        pythonProcess = null;
    }

    if (zmqSubscriber) {
        try {
            zmqSubscriber.close();
            console.log('[Main] ZMQ subscriber closed');
        } catch (e) {
            console.error('[Main] Error closing ZMQ subscriber:', e);
        }
        zmqSubscriber = null;
    }

    if (commandSock) {
        try {
            commandSock.close();
            console.log('[Main] ZMQ command socket closed');
        } catch (e) {
            console.error('[Main] Error closing ZMQ command socket:', e);
        }
        commandSock = null;
    }
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
    console.error('[Main] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('[Main] Unhandled rejection:', reason);
});
