/**
 * Electron Preload Script (CommonJS)
 * 
 * Context isolation ile güvenli IPC köprüsü sağlar.
 * Renderer process'e sadece gerekli API'leri expose eder.
 */

const { contextBridge, ipcRenderer } = require('electron');

const electronAPI = {
    // ═══════════════════════════════════════════════════════════════
    // Transcript Updates (from Python via ZMQ)
    // ═══════════════════════════════════════════════════════════════
    onTranscriptUpdate: (callback) => {
        const handler = (_event, data) => {
            callback(data);
        };
        ipcRenderer.on('transcript-update', handler);
        return () => {
            ipcRenderer.removeListener('transcript-update', handler);
        };
    },

    onAudioLevel: (callback) => {
        const handler = (_event, level) => {
            callback(level);
        };
        ipcRenderer.on('audio-level', handler);
        return () => {
            ipcRenderer.removeListener('audio-level', handler);
        };
    },

    onEngineReady: (callback) => {
        const handler = () => {
            callback();
        };
        ipcRenderer.on('engine-ready', handler);
        return () => {
            ipcRenderer.removeListener('engine-ready', handler);
        };
    },

    // ═══════════════════════════════════════════════════════════════
    // Mouse/Interaction
    // ═══════════════════════════════════════════════════════════════
    setIgnoreMouseEvents: (ignore, options) => {
        ipcRenderer.send('set-ignore-mouse-events', ignore, options);
    },

    moveWindow: (deltaX, deltaY) => {
        ipcRenderer.send('move-window', deltaX, deltaY);
    },

    setOpacity: (opacity) => {
        ipcRenderer.send('set-opacity', opacity);
    },

    updateInteractiveZones: (zones) => {
        ipcRenderer.send('update-interactive-zones', zones);
    },

    // ═══════════════════════════════════════════════════════════════
    // Window Control
    // ═══════════════════════════════════════════════════════════════
    setWindowHeight: (height) => {
        ipcRenderer.send('set-window-height', height);
    },

    forceFocus: () => {
        ipcRenderer.send('force-focus');
    },

    quitApp: () => {
        ipcRenderer.send('app-quit');
    },

    restartEngine: () => {
        ipcRenderer.send('restart-engine');
    },

    toggleStealth: (enabled) => {
        ipcRenderer.send('toggle-stealth', enabled);
    },

    setStreamingMode: (enabled) => {
        ipcRenderer.send('set-streaming-mode', enabled);
    },

    setLanguage: (lang) => {
        ipcRenderer.send('set-language', lang);
    },

    openHistoryWindow: (transcripts) => {
        ipcRenderer.send('open-history-window', transcripts);
    },

    onShowControlBar: (callback) => {
        const handler = () => callback();
        ipcRenderer.on('show-control-bar', handler);
        return () => ipcRenderer.removeListener('show-control-bar', handler);
    },

    // ═══════════════════════════════════════════════════════════════
    // App Info
    // ═══════════════════════════════════════════════════════════════
    getAppInfo: () => ipcRenderer.invoke('get-app-info'),
};

// Expose to renderer
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

console.log('[Preload] Electron API exposed to renderer (CJS version)');
