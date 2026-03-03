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
    deepgramKey?: string;
    deeplKey?: string;
}

interface ApiKeyValidationStatus {
    ok: boolean;
    message: string;
}

interface ApiKeyValidationResult {
    ok: boolean;
    deepgram: ApiKeyValidationStatus;
    deepl: ApiKeyValidationStatus;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECURITY: URL Whitelist for shell.openExternal
// ═══════════════════════════════════════════════════════════════════════════════

const ALLOWED_EXTERNAL_HOSTS = [
    'existential.audio',
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
    'deepgramKey',
    'deeplKey',
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
let latestHistoryTranscripts: unknown[] = [];

const COMMAND_RETRY_COUNT = 3;
const COMMAND_RETRY_DELAY_MS = 100;

// Environment
const isDev = !app.isPackaged;
const VITE_DEV_SERVER_URL = 'http://localhost:5173';
const ZMQ_ADDRESS = 'tcp://127.0.0.1:5555';

function getPreloadPath() {
    return isDev
        ? path.join(process.cwd(), 'electron', 'preload.cjs')
        : path.join(__dirname, 'preload.js');
}

function sendHistoryWindowState(isOpen: boolean) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('history-window-state', isOpen);
    }
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
    }
    .header {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    h1 { font-size: 22px; font-weight: 700; color: #fff; }
    .meta { font-size: 13px; color: rgba(255,255,255,0.55); }
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
    .entry.is-live {
      border-color: rgba(167,139,250,0.28);
      background: rgba(167,139,250,0.08);
    }
    .time {
      color: #a78bfa;
      font-size: 13px;
      min-width: 74px;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      padding-top: 2px;
    }
    .texts { flex: 1; min-width: 0; }
    .original {
      font-size: 14px;
      color: rgba(255,255,255,0.5);
      font-style: italic;
      margin-bottom: 6px;
      line-height: 1.45;
      word-break: break-word;
    }
    .translated {
      font-size: 18px;
      color: #fff;
      font-weight: 600;
      line-height: 1.5;
      word-break: break-word;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-left: 10px;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #e9d5ff;
      background: rgba(167,139,250,0.16);
      border: 1px solid rgba(167,139,250,0.22);
    }
    .empty {
      margin: auto;
      color: rgba(255,255,255,0.35);
      text-align: center;
      font-size: 15px;
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="header">
      <h1>Transcript History</h1>
      <div id="meta" class="meta">0 entries</div>
    </div>
    <div id="content"><div class="empty">No transcripts yet.</div></div>
  </div>
  <script>
    (() => {
      const content = document.getElementById('content');
      const meta = document.getElementById('meta');

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

      const render = (entries) => {
        const list = Array.isArray(entries) ? [...entries].reverse() : [];
        meta.textContent = \`\${list.length} entries\`;

        if (!list.length) {
          content.innerHTML = '<div class="empty">No transcripts yet.</div>';
          return;
        }

        content.innerHTML = list.map((item) => \`
          <div class="entry \${item.isFinal === false ? 'is-live' : ''}">
            <div class="time">\${formatTime(item.timestamp)}</div>
            <div class="texts">
              <div class="original">
                \${escapeHtml(item.original)}
                \${item.isFinal === false ? '<span class="badge">Live</span>' : ''}
              </div>
              <div class="translated">\${escapeHtml(item.translated)}</div>
            </div>
          </div>
        \`).join('');
      };

      if (window.electronAPI?.onHistoryData) {
        window.electronAPI.onHistoryData(render);
      }
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
    let windowHeight = 280;
    try {
        const configPath = getSetupConfigPath();
        if (fs.existsSync(configPath)) {
            const configRaw = fs.readFileSync(configPath, 'utf-8');
            const setupConfig = JSON.parse(configRaw);
            // Check both new and old key for safety here
            const finished = setupConfig.isSetupComplete || setupConfig.setupComplete;
            if (!finished) {
                windowHeight = 600; // Wizard height
            }
        } else {
            windowHeight = 600; // No config, show wizard
        }
    } catch {
        windowHeight = 600; // Default to wizard height if error
    }

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

    // Screen-share invisibility: NSWindowSharingNone (macOS)
    win.setContentProtection(true);

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
    const pythonPath = isDev
        ? path.join(process.cwd(), 'python', 'engine.py')
        : path.join(process.resourcesPath, 'python', 'engine.py');

    // Virtual environment Python path
    const venvPython = isDev
        ? path.join(process.cwd(), 'python', '.venv', 'bin', 'python')
        : path.join(process.resourcesPath, 'python', '.venv', 'bin', 'python');

    console.log('[Main] Starting Python engine:', pythonPath);
    console.log('[Main] Using Python:', venvPython);

    // Setup Config üzerinden API Key okuma
    let env = { ...process.env };
    try {
        const configRaw = fs.readFileSync(getSetupConfigPath(), 'utf-8');
        const setupConfig = JSON.parse(configRaw);
        if (setupConfig.deepgramKey) env.DEEPGRAM_API_KEY = setupConfig.deepgramKey;
        if (setupConfig.deeplKey) env.DEEPL_API_KEY = setupConfig.deeplKey;
    } catch {
        // İlk çalışmada veya hata durumunda boş kalır
    }

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
            console.error('[Python Error]', errorMsg);
            // Forward to renderer via safe IPC (no executeJavaScript)
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('engine-log', `[Python] ${errorMsg}`);
            }
        });

        proc.on('close', (code: number | null) => {
            console.log(`[Python] Process exited with code ${code}`);
            pythonProcess = null;
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
        await commandSock.bind('tcp://127.0.0.1:5556');
        console.log('[ZMQ] Command Publisher bound to tcp://127.0.0.1:5556');
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

    // Pencere yüksekliğini ayarla (Dynamic Resizing) - GROW UPWARDS
    ipcMain.on('set-window-height', (_event, height: number) => {
        if (mainWindow) {
            try {
                const [currentWidth, currentHeight] = mainWindow.getSize();
                const [currentX, currentY] = mainWindow.getPosition();

                // Minimum yükseklik kontrolü
                const newHeight = Math.max(180, height);
                const heightDiff = newHeight - currentHeight;

                if (Math.abs(heightDiff) < 2) return;

                // GROW UPWARDS: Maintain bottom edge position
                // NewY = currentY - heightDiff (if height grows by 10, target top moves up by 10)
                const newY = currentY - heightDiff;

                // Bounds protection: prevent window from going above the screen
                const safeY = Math.max(0, Math.floor(newY));

                mainWindow.setBounds({
                    x: currentX,
                    y: safeY,
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
        try {
            const data = fs.readFileSync(getSetupConfigPath(), 'utf8');
            const parsed = JSON.parse(data);
            // Normalize legacy key: setupComplete → isSetupComplete
            if ('setupComplete' in parsed && !('isSetupComplete' in parsed)) {
                parsed.isSetupComplete = parsed.setupComplete;
            }
            return parsed;
        } catch {
            return { isSetupComplete: false };
        }
    });

    ipcMain.handle('save-config', async (_event, config) => {
        // Validate config schema before writing to disk
        if (!isValidConfig(config)) {
            console.warn('[Main] Invalid config rejected:', JSON.stringify(config));
            return false;
        }
        try {
            const configPath = getSetupConfigPath();
            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            console.log('[Main] Config saved successfully to:', configPath);

            // Notify Python engine about key updates via ZMQ
            await broadcastCommand({
                type: 'update_keys',
                deepgram: config.deepgramKey,
                deepl: config.deeplKey
            }, 'update_keys');

            return true;
        } catch (e) {
            console.error('[Main] Failed to save config:', e);
            return false;
        }
    });

    ipcMain.handle('validate-api-keys', async (_event, keys): Promise<ApiKeyValidationResult> => {
        const deepgram = await validateDeepgramKey(keys?.deepgramKey);
        const deepl = await validateDeepLKey(keys?.deeplKey);

        return {
            ok: deepgram.ok && deepl.ok,
            deepgram,
            deepl,
        };
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
        if (mainWindow) {
            mainWindow.setContentProtection(enabled);
            if (process.platform !== 'darwin') {
                console.warn('[Main] setContentProtection is only effective on macOS');
            }
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
            pythonProcess = startPythonEngine();
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
