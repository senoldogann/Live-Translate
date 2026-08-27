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
        // CI'da ve yerelde yalnizca ana depodaki testler calismali.
        exclude: [...configDefaults.exclude, '.worktrees/**', 'e2e/**'],
    },
});
