/**
 * Electron Main Process
 * 
 * KRİTİK: Bu dosya "Stealth Mode" implementasyonunu içerir.
 * setContentProtection(true) -> macOS NSWindowSharingNone API'sini kullanır.
 * Bu sayede pencere ekran paylaşımı ve ekran kaydında GÖRÜNMEZ olur.
 */

import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

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
let isInteractionEnabled = true; // Başlangıçta etkileşim açık olsun

// Environment
const isDev = process.env.NODE_ENV !== 'production';
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

    // Window boyutları (ekranın alt kısmında, ortalanmış)
    const windowWidth = Math.min(1000, screenWidth * 0.8);
    const windowHeight = 280; // Daha yüksek - İngilizce metin görünsün
    const xPosition = Math.floor((screenWidth - windowWidth) / 2);
    // const yPosition = screenHeight - windowHeight - 30; // ESKİ: Alt kısım
    const yPosition = Math.floor((screenHeight - windowHeight) / 2); // YENİ: Tam orta

    // Debug: preload path - CJS dosyasını kullan (ESM değil)
    const preloadPath = isDev
        ? path.join(process.cwd(), 'electron', 'preload.cjs')
        : path.join(__dirname, 'preload.cjs');
    console.log('[Main] Preload path:', preloadPath);

    const win = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        x: xPosition,
        y: yPosition,
        center: true, // Garanti olsun
        type: 'panel',
        fullscreenable: false,
        transparent: true,           // Şeffaf arka plan (CSS ile kontrol)
        frame: false,                // Sistem çerçevesi yok
        alwaysOnTop: true,           // Her zaman üstte
        hasShadow: false,            // Gölge yok (tespit edilebilir)
        skipTaskbar: true,           // Taskbar'da görünme
        focusable: true,             // Focus alabilir (kontroller için gerekli)

        // ═══════════════════════════════════════════════════════════════

        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false, // Preload için gerekli
            webSecurity: false, // Dev mode için
        },

        // macOS spesifik
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: -100, y: -100 }, // Trafik ışıklarını gizle
        vibrancy: undefined, // Vibrancy'yi kapatıyoruz (stealth için)
        visualEffectState: 'inactive',
    });

    // ═══════════════════════════════════════════════════════════════════
    // ⚠️ KRİTİK: EKRAN PAYLAŞIMINA GÖRÜNMEZLIK
    // Bu satır macOS'ta NSWindow.sharingType = NSWindowSharingNone yapar.
    // Zoom, Teams, OBS, QuickTime bu pencereyi GÖREMEZ.
    // ═══════════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════════
    // ⚠️ KRİTİK: EKRAN PAYLAŞIMINA GÖRÜNMEZLIK
    // Bu satır macOS'ta NSWindow.sharingType = NSWindowSharingNone yapar.
    // Zoom, Teams, OBS, QuickTime bu pencereyi GÖREMEZ.
    // ═══════════════════════════════════════════════════════════════════
    win.setContentProtection(true);

    // ═══════════════════════════════════════════════════════════════════
    // Click-through: BAŞLANGIÇTA KAPALI - kontroller için gerekli
    // Renderer'dan dinamik olarak açılıp kapanacak
    // ═══════════════════════════════════════════════════════════════════
    // win.setIgnoreMouseEvents(true, { forward: true }); // DEVRE DIŞI

    // Dock'ta gizle (macOS) - Ve Space davranışlarını ayarla
    if (process.platform === 'darwin') {
        app.dock?.hide();
        // Space değiştirmeyi engelle, her yerde görün
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    // Window level ayarı (screen-saver en üst seviyedir)
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });


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
        : 'python3';

    console.log('[Main] Starting Python engine:', pythonPath);
    console.log('[Main] Using Python:', venvPython);

    try {
        const proc = spawn(venvPython, [pythonPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                PYTHONUNBUFFERED: '1', // Real-time output
            },
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
                                console.log('[Main] Sent transcript to renderer:', transcriptData.translated);
                            }
                        }
                    } catch (parseError) {
                        // Not valid JSON, ignore
                    }
                }
            }
        });

        proc.stderr?.on('data', (data: Buffer) => {
            console.error('[Python Error]', data.toString().trim());
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

    }, 50); // 50ms polling rate (Smooth enough)
}

/**
 * IPC Handlers
 */
function setupIpcHandlers(): void {
    // Interactive Zones Update
    ipcMain.on('update-interactive-zones', (_event, zones) => {
        interactiveZones = zones;
    });

    // Mouse olaylarını yönet (drag için) - ARTIK POLLING YÖNETİYOR AMA DRAG İÇİN ZORLA AÇMAK GEREKEBİLİR
    // Drag başladığında polling'i pause edebiliriz veya override edebiliriz.
    // Şimdilik çakışmayı önlemek için bu eski handler'ı basitleştirelim veya kaldıralım.
    // Ancak App.tsx hala bunu çağırıyorsa sorun olabilir.
    // Legacy support için bırakalım ama polling daha baskın olacak.
    ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean, options?: { forward: boolean }) => {
        // Polling aktifse bu çağrıyı yoksay veya sadece belirli durumlarda kullan
        // Şimdilik polling sistemi her 50ms'de override edeceği için bu anlamsız.
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



    // Streaming Modu Ayarla
    ipcMain.on('set-streaming-mode', (_event, enabled: boolean) => {
        console.log(`[Main] Set streaming mode: ${enabled}`);
        commandSock.send(JSON.stringify({
            type: 'config',
            key: 'streaming_mode',
            value: enabled
        })).catch((err: any) => console.error('Failed to send config:', err));
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
            console.log(`[Main] Stealth mode: ${enabled ? 'ON' : 'OFF'}`);
        }
    });

    // Opacity ayarla
    ipcMain.on('set-opacity', (_event, opacity: number) => {
        if (mainWindow) {
            mainWindow.setOpacity(Math.max(0.1, Math.min(1, opacity)));
        }
    });

    // Pencereyi zorla öne getir (Restore butonu için)
    ipcMain.on('force-focus', () => {
        if (mainWindow) {
            mainWindow.setAlwaysOnTop(true, 'screen-saver');
            mainWindow.show();
            mainWindow.moveTop();
            mainWindow.focus();
            console.log('[Main] Forced focus requested');
        }
    });

    // Uygulamayı kapat
    ipcMain.on('app-quit', () => {
        console.log('[Main] Quit requested by user');
        app.quit();
    });

    // Uygulama bilgisi
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
app.whenReady().then(async () => {
    console.log('[Main] App ready, creating stealth window...');

    // IPC handlers
    setupIpcHandlers();

    // Stealth window oluştur
    mainWindow = createStealthWindow();

    // Content yükle
    if (isDev) {
        await mainWindow.loadURL(VITE_DEV_SERVER_URL);
        // DevTools aç - debug için
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // Python engine başlat (küçük gecikme ile)
    setTimeout(() => {
        pythonProcess = startPythonEngine();
    }, 1000);

    // ZMQ subscriber başlat
    // ZMQ subscriber başlat
    setTimeout(() => {
        startZmqSubscriber();
    }, 2000);

    // ZMQ Publisher başlat
    startZmqPublisher();

    // Interaction Polling başlat
    startInteractionPolling();

    console.log('[Main] Stealth Subtitle Translator started successfully');
});

// macOS: Tüm pencereler kapandığında çık
app.on('window-all-closed', () => {
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

    if (pythonProcess) {
        pythonProcess.kill('SIGTERM');
        pythonProcess = null;
    }

    if (zmqSubscriber) {
        zmqSubscriber.close();
        zmqSubscriber = null;
    }
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
    console.error('[Main] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('[Main] Unhandled rejection:', reason);
});
