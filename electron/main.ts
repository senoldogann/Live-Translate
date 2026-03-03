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

// Global references
let mainWindow: BrowserWindow | null = null;
let pythonProcess: ChildProcess | null = null;
let zmqSubscriber: any = null;
let commandSock: any = null; // ZMQ Publisher (Streaming komutları için)
let interactiveZones: { x: number, y: number, width: number, height: number }[] = [];
let interactionPollingInterval: NodeJS.Timeout | null = null;
let isInteractionEnabled = true;
let hasReceivedZones = false;
let historyWindow: BrowserWindow | null = null; // Transcript history window

// Environment
const isDev = !app.isPackaged;
const VITE_DEV_SERVER_URL = 'http://localhost:5173';
const ZMQ_ADDRESS = 'tcp://127.0.0.1:5555';

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
        const configRaw = fs.readFileSync(getSetupConfigPath(), 'utf-8');
        const setupConfig = JSON.parse(configRaw);
        if (!setupConfig.setupComplete) {
            windowHeight = 600; // Wizard height
        }
    } catch {
        windowHeight = 600; // Default to wizard height if config missing
    }

    const windowWidth = Math.min(1000, Math.floor(screenWidth * 0.75));
    const xPosition = Math.floor((screenWidth - windowWidth) / 2);
    const yPosition = screenHeight - windowHeight - 30;

    const preloadPath = isDev
        ? path.join(process.cwd(), 'electron', 'preload.cjs')
        : path.join(__dirname, 'preload.js');

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
            // Log to renderer for debugging in production if needed
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.executeJavaScript(`console.error("Python Stderr: ${errorMsg.replace(/"/g, '\\"')}")`);
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
                // console.log('[Main] Interaction Enabled');
            } else {
                mainWindow.setIgnoreMouseEvents(true, { forward: true });
                // console.log('[Main] Interaction Disabled (Click-through)');
            }
            isInteractionEnabled = shouldEnable;
        }

    }, 100); // 100ms polling rate - reduced from 50ms to prevent mouse freeze
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

    // Pencere yüksekliğini ayarla (Dynamic Resizing)
    // Pencere yüksekliğini ayarla (Dynamic Resizing) - GROW UPWARDS
    ipcMain.on('set-window-height', (_event, height: number) => {
        if (mainWindow) {
            try {
                const [currentWidth, currentHeight] = mainWindow.getSize();
                const [currentX, currentY] = mainWindow.getPosition();

                // Minimum yükseklik kontrolü (örn 180px)
                const newHeight = Math.max(180, height);

                // Yükseklik farkı
                const heightDiff = newHeight - currentHeight;

                // Eğer yükseklik değişmeyecekse işlem yapma
                if (Math.abs(heightDiff) < 2) return;

                // Yukarı doğru büyümesi için Y pozisyonunu güncelle
                // Alt kenar sabit kalmalı: NewY = CurrentY - Diff
                const newY = currentY - heightDiff;

                mainWindow.setBounds({
                    x: currentX,
                    y: newY,
                    width: currentWidth,
                    height: newHeight
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
            return JSON.parse(data);
        } catch {
            return { isSetupComplete: false };
        }
    });

    ipcMain.handle('save-config', (_event, config) => {
        try {
            fs.writeFileSync(getSetupConfigPath(), JSON.stringify(config));
            return true;
        } catch (e) {
            console.error('[Main] Failed to save config:', e);
            return false;
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

    ipcMain.on('open-url', (_event, url) => {
        console.log('[Main] Opening URL:', url);
        shell.openExternal(url).catch(err => {
            console.error('[Main] Failed to open URL:', err);
        });
    });

    // ═══════════════════════════════════════════════════════════════

    // Streaming Modu Ayarla
    ipcMain.on('set-streaming-mode', (_event, enabled: boolean) => {
        console.log(`[Main] Set streaming mode: ${enabled}`);
        if (commandSock) {
            commandSock.send(JSON.stringify({
                type: 'config',
                key: 'streaming_mode',
                value: enabled
            })).catch((err: any) => console.error('Failed to send config:', err));
        }
    });

    // Language Change (Dynamic) - with retry for ZMQ slow joiner
    ipcMain.on('set-language', async (_event, lang: string) => {
        console.log(`[Main] Set language: ${lang}`);
        if (commandSock) {
            // Send 3 times with delay to ensure delivery (ZMQ slow joiner fix)
            for (let i = 0; i < 3; i++) {
                try {
                    await commandSock.send(JSON.stringify({
                        type: 'config',
                        key: 'source_lang',
                        value: lang
                    }));
                    if (i === 0) console.log(`[Main] Language command sent (attempt ${i + 1})`);
                } catch (err) {
                    console.error('Failed to send config:', err);
                }
                await new Promise(r => setTimeout(r, 100));
            }
        }
    });

    // Engine Type Change (local / cloud)
    ipcMain.on('set-engine-type', async (_event, engineType: string) => {
        console.log(`[Main] Set engine type: ${engineType}`);
        if (commandSock) {
            try {
                await commandSock.send(JSON.stringify({
                    type: 'config',
                    key: 'engine_type',
                    value: engineType
                }));
            } catch (err) {
                console.error('[Main] engine-type send error:', err);
            }
        }
    });

    // Python engine'i yeniden başlat
    ipcMain.on('restart-engine', () => {
        if (pythonProcess) {
            pythonProcess.kill();
        }
        pythonProcess = startPythonEngine();
    });

    // Stealth mode toggle
    ipcMain.on('toggle-stealth', (_event, enabled: boolean) => {
        if (mainWindow) {
            mainWindow.setContentProtection(enabled);
        }
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

    // Open history in a separate native window
    ipcMain.on('open-history-window', (_event, transcripts) => {
        // Close existing window if already open
        // Toggle: Close existing window if already open
        if (historyWindow && !historyWindow.isDestroyed()) {
            historyWindow.close();
            return;
        }

        const { width, height } = screen.getPrimaryDisplay().workAreaSize;

        historyWindow = new BrowserWindow({
            width: Math.min(900, Math.floor(width * 0.7)),
            height: Math.min(700, Math.floor(height * 0.8)),
            center: true,
            title: 'Transcript History',
            backgroundColor: '#0f0f0f',
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
            },
        });

        // Toggle: Close existing window if already open
        historyWindow.webContents.on('did-finish-load', () => {
            // Safe HTML has been loaded now
        });

        // Build history HTML content (newest first = reversed array)
        const entries = [...transcripts as any[]].reverse().map((t: any) => {
            const d = new Date(t.timestamp);
            const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
            return `
                <div class="entry">
                    <span class="time">${timeStr}</span>
                    <div class="texts">
                        <div class="original">${escapeHtml(t.original)}</div>
                        <div class="translated">${escapeHtml(t.translated)}</div>
                    </div>
                </div>`;
        }).join('');

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <title>Transcript History</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f0f0f; color: #eee; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 20px; color: #fff; border-bottom: 1px solid #333; padding-bottom: 12px; }
    .entry { display: flex; gap: 16px; padding: 12px 0; border-bottom: 1px solid #1e1e1e; align-items: flex-start; }
    .time { color: #888; font-size: 12px; min-width: 64px; padding-top: 3px; font-variant-numeric: tabular-nums; }
    .texts { flex: 1; }
    .original { font-size: 13px; color: rgba(255,255,255,0.55); font-style: italic; margin-bottom: 4px; }
    .translated { font-size: 15px; color: #fff; font-weight: 500; }
    .empty { color: #666; text-align: center; margin-top: 40px; }
  </style>
</head>
<body>
  <h1>📝 Transcript History (${(transcripts as any[]).length} entries)</h1>
  ${entries || '<p class="empty">No transcripts yet.</p>'}
</body>
</html>`;

        historyWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

        historyWindow.on('closed', () => {
            historyWindow = null;
        });
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

/** Escape HTML special characters for safe injection into data: URLs */
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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

        mainWindow = createStealthWindow();

        // ─── Production Debugging: Error Listeners ───────────────────────────
        mainWindow.webContents.on('did-fail-load', (_event: any, errorCode: number, errorDescription: string, validatedURL: string) => {
            console.error(`[Main] Failed to load URL: ${validatedURL}`);
            console.error(`       Error: ${errorDescription} (${errorCode})`);
        });

        mainWindow.webContents.on('render-process-gone', (_event: any, details: any) => {
            console.error(`[Main] Renderer process gone. Reason: ${details.reason}, Exit Code: ${details.exitCode}`);
        });

        mainWindow.webContents.on('unresponsive', () => {
            console.warn('[Main] Window became unresponsive');
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

        startZmqPublisher();
        startInteractionPolling();

        // Global shortcut: ⌘+Shift+S (macOS) / Ctrl+Shift+S (Win/Linux) to show control bar
        const shortcut = process.platform === 'darwin' ? 'Command+Shift+S' : 'Ctrl+Shift+S';
        globalShortcut.register(shortcut, () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('show-control-bar');
                mainWindow.show();
                mainWindow.moveTop();
                mainWindow.focus();
            }
        });
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
        zmqSubscriber.close();
        zmqSubscriber = null;
    }

    if (commandSock) {
        commandSock.close();
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
