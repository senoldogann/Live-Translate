/**
 * Electron Preload Script (CommonJS)
 * 
 * Context isolation ile güvenli IPC köprüsü sağlar.
 * Renderer process'e sadece gerekli API'leri expose eder.
 */

const { contextBridge, ipcRenderer, clipboard } = require('electron');

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

    setListening: (enabled) => {
        ipcRenderer.send('set-listening', enabled);
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

    updateHistoryWindow: (transcripts) => {
        ipcRenderer.send('update-history-window', transcripts);
    },

    onHistoryWindowState: (callback) => {
        const handler = (_event, isOpen) => callback(isOpen);
        ipcRenderer.on('history-window-state', handler);
        return () => ipcRenderer.removeListener('history-window-state', handler);
    },

    onHistoryData: (callback) => {
        const handler = (_event, transcripts) => callback(transcripts);
        ipcRenderer.on('history-data', handler);
        return () => ipcRenderer.removeListener('history-data', handler);
    },

    openApiSettingsWindow: (draft) => {
        ipcRenderer.send('open-api-settings-window', draft);
    },

    saveApiSettingsWindow: (draft) => {
        return ipcRenderer.invoke('save-api-settings-window', draft);
    },

    onApiSettingsWindowData: (callback) => {
        const handler = (_event, draft) => callback(draft);
        ipcRenderer.on('api-settings-window-data', handler);
        return () => ipcRenderer.removeListener('api-settings-window-data', handler);
    },

    onApiSettingsUpdated: (callback) => {
        const handler = (_event, config) => callback(config);
        ipcRenderer.on('api-settings-updated', handler);
        return () => ipcRenderer.removeListener('api-settings-updated', handler);
    },

    openUsageGuideWindow: () => {
        ipcRenderer.send('open-usage-guide-window');
    },

    closeCurrentWindow: () => {
        ipcRenderer.send('close-current-window');
    },

    // ═══════════════════════════════════════════════════════════════
    // Engine Type
    // ═══════════════════════════════════════════════════════════════
    setEngineType: (engineType) => {
        ipcRenderer.send('set-engine-type', engineType);
    },

    // ═══════════════════════════════════════════════════════════════
    // Engine Log (Python stderr forwarded safely via IPC)
    // ═══════════════════════════════════════════════════════════════
    onEngineLog: (callback) => {
        const handler = (_event, msg) => {
            callback(msg);
        };
        ipcRenderer.on('engine-log', handler);
        return () => {
            ipcRenderer.removeListener('engine-log', handler);
        };
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

    // ═══════════════════════════════════════════════════════════════
    // Setup Wizard
    // ═══════════════════════════════════════════════════════════════
    getConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (config) => ipcRenderer.invoke('save-config', config),
    validateApiKeys: (keys) => ipcRenderer.invoke('validate-api-keys', keys),
    checkBlackhole: () => ipcRenderer.invoke('check-blackhole'),
    openUrl: (url) => ipcRenderer.send('open-url', url),
    copyToClipboard: (text) => {
        clipboard.writeText(text);
    },
};

// Expose to renderer
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

console.log('[Preload] Electron API exposed to renderer (CJS version)');
