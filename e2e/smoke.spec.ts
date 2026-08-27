/**
 * E2E smoke test: uygulamanin Electron main process'i boot edip
 * bir pencere olusturdugunu dogrular. Ses/TCC gerektirmez.
 *
 * Kosmak icin: npm run test:e2e
 */
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('Electron app boots and creates a window', async () => {
    const app = await electron.launch({
        args: [path.join(__dirname, '..', 'dist-electron', 'main.js')],
        env: {
            ...process.env,
            // Engine'i testte spawn etme (ses/BlackHole gerektirmez).
            STEALTH_E2E: '1',
        },
    });

    const firstWindow = await app.firstWindow();
    expect(firstWindow).toBeTruthy();

    // Main process hazir mi + surum okunabiliyor mu
    const ready = await app.evaluate(({ app: electronApp }) => electronApp.isReady());
    expect(ready).toBe(true);
    const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);

    await app.close();
});
