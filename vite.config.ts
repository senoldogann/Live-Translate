import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
    plugins: [
        react(),
        electron([
            {
                // Main process entry
                entry: 'electron/main.ts',
                vite: {
                    build: {
                        outDir: 'dist-electron',
                        rollupOptions: {
                            external: ['zeromq'],
                        },
                    },
                },
            },
            {
                // Preload script - MUST be CommonJS for Electron
                entry: 'electron/preload.ts',
                onstart(options) {
                    options.reload();
                },
                vite: {
                    build: {
                        outDir: 'dist-electron',
                        // lib:formats[cjs], esbuild `import electron`'u CommonJS `require`'a
                        // dondurur; sandbox rendererin CJS preload istegini karsilar.
                        lib: {
                            entry: 'electron/preload.ts',
                            formats: ['cjs'],
                            fileName: () => 'preload.cjs',
                        },
                        rollupOptions: {
                            external: ['electron'],
                        },
                    },
                },
            },
        ]),
        renderer(),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@components': path.resolve(__dirname, './src/components'),
        },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, 'index.html'),
            },
        },
    },
    server: {
        port: 5174,
        strictPort: true,
    },
});
