/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './src/test/setup.ts',
        css: true,
        // Yerel worktree kopyalari ana depodaki node_modules ile cakisiyor;
        // CI'da ve yerelde yalnizca ana depodaki testler calismali. ios/**
        // gitignore'lanmış vendored whisper.cpp'yi içerir — vitest onu taramaz
        // (Swift testleri zaten ayrı çalışır); aksi halde yerel `npm test`
        // build edilmemiş native addon testi yüzünden kırmızı yanar.
        exclude: [...configDefaults.exclude, '.worktrees/**', 'e2e/**', 'ios/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['src/main.tsx', 'src/vite-env.d.ts', 'src/**/*.test.{ts,tsx}', 'src/test/**'],
            thresholds: {
                lines: 70,
                statements: 70,
                functions: 55,
                branches: 60,
            },
        },
    },
});
