/**
 * Electron Preload Script
 * 
 * Context isolation ile güvenli IPC köprüsü sağlar.
 * Renderer process'e sadece gerekli API'leri expose eder.
 * 
 * NOT: Bu dosya CommonJS formatında olmalı.
 */

const { contextBridge, ipcRenderer } = require('electron');

console.log('[Preload] Loading Electron API...');

// Type definitions (for reference, not used in runtime)
// interface TranscriptData {
//     original: string;
//     translated: string;
//     timestamp: number;
//     isFinal: boolean;
// }

const electronAPI = {
    // ═══════════════════════════════════════════════════════════════
    // Transcript Updates (from Python via ZMQ)
    // ═══════════════════════════════════════════════════════════════
    onTranscriptUpdate: (callback) => {
        const handler = (_event, data) => {
            console.log('[Preload] Received transcript-update:', data);
            callback(data);
        };

        ipcRenderer.on('transcript-update', handler);

        // Cleanup function
        return () => {
            ipcRenderer.removeListener('transcript-update', handler);
        };
    },

    onAudioLevel: (callback) => {
        const handler = (_event, level) => callback(level);
        ipcRenderer.on('audio-level', handler);
        return () => ipcRenderer.removeListener('audio-level', handler);
    },

    updateInteractiveZones: (zones) => {
        ipcRenderer.send('update-interactive-zones', zones);
    },

    // ═══════════════════════════════════════════════════════════════
    // Window Controls (for drag functionality)
    // ═══════════════════════════════════════════════════════════════
    setIgnoreMouseEvents: (ignore, options) => {
        ipcRenderer.send('set-ignore-mouse-events', ignore, options);
    },

    moveWindow: (deltaX, deltaY) => {
        ipcRenderer.send('move-window', deltaX, deltaY);
    },

    setWindowHeight: (height) => {
        ipcRenderer.send('set-window-height', height);
    },

    setStreamingMode: (enabled) => {
        ipcRenderer.send('set-streaming-mode', enabled);
    },

    setOpacity: (opacity) => {
        ipcRenderer.send('set-opacity', opacity);
    },

    forceFocus: () => {
        ipcRenderer.send('force-focus');
    },

    // ═══════════════════════════════════════════════════════════════
    // Engine Controls
    // ═══════════════════════════════════════════════════════════════
    restartEngine: () => {
        ipcRenderer.send('restart-engine');
    },

    toggleStealth: (enabled) => {
        ipcRenderer.send('toggle-stealth', enabled);
    },

    quitApp: () => {
        ipcRenderer.send('app-quit');
    },

    // ═══════════════════════════════════════════════════════════════
    // App Info
    // ═══════════════════════════════════════════════════════════════
    getAppInfo: () => {
        return ipcRenderer.invoke('get-app-info');
    },
};

// Expose to window object
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

console.log('[Preload] Electron API exposed to renderer');
