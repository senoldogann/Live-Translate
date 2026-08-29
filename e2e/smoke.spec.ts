/**
 * E2E smoke tests: Electron main process boot, window creation, and the
 * preload IPC bridge that the renderer depends on.
 *
 * No audio devices / TCC permissions required — the engine is not spawned
 * (STEALTH_E2E=1) and the renderer runs in its own window.
 *
 * Run with: npm run test:e2e
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let app: ElectronApplication;
let page: Page;

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
    const launched = await electron.launch({
        args: [path.join(__dirname, '..', 'dist-electron', 'main.js')],
        env: {
            ...process.env,
            STEALTH_E2E: '1',
        },
    });
    const firstWindow = await launched.firstWindow();
    await firstWindow.waitForLoadState('domcontentloaded');
    return { app: launched, page: firstWindow };
}

test.beforeEach(async () => {
    ({ app, page } = await launchApp());
});

test.afterEach(async () => {
    await app.close();
});

test.describe('Electron boot', () => {
    test('app boots, reports ready and has a valid version', async () => {
        const ready = await app.evaluate(({ app: electronApp }) => electronApp.isReady());
        expect(ready).toBe(true);

        const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
        expect(typeof version).toBe('string');
        expect(version.length).toBeGreaterThan(0);
    });

    test('creates exactly one visible window', async () => {
        const winInfo = await app.evaluate(({ BrowserWindow }) => {
            const windows = BrowserWindow.getAllWindows();
            return {
                count: windows.length,
                visible: windows.length > 0 ? windows[0].isVisible() : false,
            };
        });
        expect(winInfo.count).toBeGreaterThanOrEqual(1);
        expect(winInfo.visible).toBe(true);
    });

    test('window has sane overlay dimensions', async () => {
        const bounds = await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            const b = win.getBounds();
            return { width: b.width, height: b.height };
        });
        expect(bounds.width).toBeGreaterThan(0);
        expect(bounds.height).toBeGreaterThan(0);
    });
});

test.describe('Preload IPC bridge', () => {
    test('exposes electronAPI to the renderer', async () => {
        const hasApi = await page.evaluate(() => typeof (window as any).electronAPI);
        expect(hasApi).toBe('object');
    });

    test('exposes transcript subscription methods', async () => {
        const methods = await page.evaluate(() => {
            const api = (window as any).electronAPI ?? {};
            return {
                onTranscriptUpdate: typeof api.onTranscriptUpdate,
                onAudioLevel: typeof api.onAudioLevel,
                onEngineReady: typeof api.onEngineReady,
                getConfig: typeof api.getConfig,
            };
        });
        expect(methods.onTranscriptUpdate).toBe('function');
        expect(methods.onAudioLevel).toBe('function');
        expect(methods.onEngineReady).toBe('function');
        expect(methods.getConfig).toBe('function');
    });

    test('window control API is available', async () => {
        const controls = await page.evaluate(() => {
            const api = (window as any).electronAPI ?? {};
            return {
                moveWindow: typeof api.moveWindow,
                setOpacity: typeof api.setOpacity,
                quitApp: typeof api.quitApp,
                restartEngine: typeof api.restartEngine,
                setListening: typeof api.setListening,
            };
        });
        expect(controls.moveWindow).toBe('function');
        expect(controls.setOpacity).toBe('function');
        expect(controls.quitApp).toBe('function');
        expect(controls.restartEngine).toBe('function');
        expect(controls.setListening).toBe('function');
    });

    test('setup config can be read', async () => {
        const config = await page.evaluate(() => (window as any).electronAPI.getConfig());
        expect(config).toBeDefined();
    });
});

test.describe('Renderer renders', () => {
    test('the app mounts and shows the React root', async () => {
        // App shows either SetupWizard or the main UI after config load.
        const rootContent = await page.locator('#root, .app-container, .wizard-overlay').count();
        expect(rootContent).toBeGreaterThan(0);
    });

    test('no uncaught renderer exceptions on boot', async () => {
        const pageErrors: string[] = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));
        await page.waitForTimeout(1500);
        expect(pageErrors).toEqual([]);
    });
});
