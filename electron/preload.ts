/**
 * Electron Preload Script
 * 
 * Context isolation ile güvenli IPC köprüsü sağlar.
 * Renderer process'e sadece gerekli API'leri expose eder.
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Type definitions
interface TranscriptData {
    original: string;
    translated: string;
    timestamp: number;
    isFinal: boolean;
    translationProvider?: 'azure-speech' | 'deepl' | 'google' | 'argos' | 'fast-argos' | 'passthrough';
}

interface ApiSettingsDraft {
    azureSpeechKey: string;
    azureSpeechRegion: string;
    deepgramKey: string;
    deeplKey: string;
    ollamaEndpoint?: string;
    ollamaApiKey?: string;
    ollamaModel?: string;
}

interface ApiSettingsSaveResult {
    ok: boolean;
    message: string;
    validation?: unknown;
    config?: unknown;
}

interface AppInfo {
    version: string;
    platform: NodeJS.Platform;
    arch: string;
    isDev: boolean;
}

// Zone definition matches Main Process
interface InteractiveZone {
    x: number;
    y: number;
    width: number;
    height: number;
}

// Engine durum mesajı (model indirme/yükleme/dinleme/hata)
interface EngineStatus {
    state: 'downloading_model' | 'loading_model' | 'listening' | 'error';
    detail?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// NEW API INTERFACE (Must match Renderer usage)
// ════════════════════════════════════════════════════════════════════════════
interface ElectronAPI {
    // Transcript updates
    onTranscriptUpdate: (callback: (data: TranscriptData) => void) => () => void;

    // NEW: Audio Level Visualization
    onAudioLevel: (callback: (level: number) => void) => () => void;

    // Window controls
    setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => void;
    moveWindow: (deltaX: number, deltaY: number) => void;
    setOpacity: (opacity: number) => void;
    // NEW: Interactive Zones
    updateInteractiveZones: (zones: InteractiveZone[]) => void;
    // NEW: Dynamic Resizing
    setWindowHeight: (height: number) => void;
    // NEW: Force Focus
    forceFocus: () => void;
    // NEW: Quit
    quitApp: () => void;

    // Engine controls
    restartEngine: () => void;
    toggleStealth: (enabled: boolean) => void;
    setListening: (enabled: boolean) => void;
    // NEW: Streaming Mode
    setStreamingMode: (enabled: boolean) => void;
    // NEW: Engine Type
    setEngineType: (type: string) => void;
    // NEW: Language Selection
    setLanguage: (lang: string) => void;

    // Kurulum Sihirbazı
    getConfig: () => Promise<any>;
    saveConfig: (config: any) => Promise<boolean>;
    validateApiKeys: (keys: {
        azureSpeechKey?: string;
        azureSpeechRegion?: string;
        deepgramKey?: string;
        deeplKey?: string;
    }) => Promise<any>;
    checkBlackhole: () => Promise<boolean>;
    openUrl: (url: string) => void;

    // App info
    getAppInfo: () => Promise<AppInfo>;

    openHistoryWindow: (transcripts: unknown[]) => void;
    updateHistoryWindow: (transcripts: unknown[]) => void;
    onHistoryWindowState: (callback: (isOpen: boolean) => void) => () => void;
    onHistoryData: (callback: (transcripts: unknown[]) => void) => () => void;
    openApiSettingsWindow: (draft: ApiSettingsDraft) => void;
    saveApiSettingsWindow: (draft: ApiSettingsDraft) => Promise<ApiSettingsSaveResult>;
    onApiSettingsWindowData: (callback: (draft: ApiSettingsDraft) => void) => () => void;
    onApiSettingsUpdated: (callback: (config: any) => void) => () => void;
    openUsageGuideWindow: () => void;
    closeCurrentWindow: () => void;
    onShowControlBar: (callback: () => void) => () => void;
    onEngineReady: (callback: () => void) => () => void;
    onEngineLog: (callback: (msg: string) => void) => () => void;
    onEngineStatus: (callback: (data: EngineStatus) => void) => () => void;

    // Ollama model listesi
    fetchOllamaModels: (endpoint: string, apiKey: string) => Promise<{ ok: boolean; models?: { name: string }[]; message?: string }>;

    // Transcript history
    getHistoryDates: () => Promise<string[]>;
    getHistoryByDate: (date: string) => Promise<unknown[]>;
}

// Expose protected methods to renderer
const electronAPI: ElectronAPI = {
    // ═══════════════════════════════════════════════════════════════
    // Transcript Updates (from Python via ZMQ)
    // ═══════════════════════════════════════════════════════════════
    onTranscriptUpdate: (callback: (data: TranscriptData) => void) => {
        const handler = (_event: IpcRendererEvent, data: TranscriptData) => {
            callback(data);
        };

        ipcRenderer.on('transcript-update', handler);

        // Cleanup function
        return () => {
            ipcRenderer.removeListener('transcript-update', handler);
        };
    },

    onAudioLevel: (callback: (level: number) => void) => {
        const handler = (_event: IpcRendererEvent, level: number) => {
            callback(level);
        };
        ipcRenderer.on('audio-level', handler);
        return () => {
            ipcRenderer.removeListener('audio-level', handler);
        };
    },

    // ═══════════════════════════════════════════════════════════════
    // Window Controls (for drag functionality)
    // ═══════════════════════════════════════════════════════════════
    setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => {
        ipcRenderer.send('set-ignore-mouse-events', ignore, options);
    },

    moveWindow: (deltaX: number, deltaY: number) => {
        ipcRenderer.send('move-window', deltaX, deltaY);
    },

    setOpacity: (opacity: number) => {
        ipcRenderer.send('set-opacity', opacity);
    },

    updateInteractiveZones: (zones: InteractiveZone[]) => {
        ipcRenderer.send('update-interactive-zones', zones);
    },

    setWindowHeight: (height: number) => {
        ipcRenderer.send('set-window-height', height);
    },

    forceFocus: () => {
        ipcRenderer.send('force-focus');
    },

    quitApp: () => {
        ipcRenderer.send('app-quit');
    },

    // ═══════════════════════════════════════════════════════════════
    // Engine Controls
    // ═══════════════════════════════════════════════════════════════
    restartEngine: () => {
        ipcRenderer.send('restart-engine');
    },

    toggleStealth: (enabled: boolean) => {
        ipcRenderer.send('toggle-stealth', enabled);
    },

    setListening: (enabled: boolean) => {
        ipcRenderer.send('set-listening', enabled);
    },

    setStreamingMode: (enabled: boolean) => {
        ipcRenderer.send('set-streaming-mode', enabled);
    },

    setEngineType: (engineType: string) => {
        ipcRenderer.send('set-engine-type', engineType);
    },

    setLanguage: (lang: string) => {
        ipcRenderer.send('set-language', lang);
    },

    openHistoryWindow: (transcripts: unknown[]) => {
        ipcRenderer.send('open-history-window', transcripts);
    },

    updateHistoryWindow: (transcripts: unknown[]) => {
        ipcRenderer.send('update-history-window', transcripts);
    },

    onHistoryWindowState: (callback: (isOpen: boolean) => void) => {
        const handler = (_event: IpcRendererEvent, isOpen: boolean) => callback(isOpen);
        ipcRenderer.on('history-window-state', handler);
        return () => ipcRenderer.removeListener('history-window-state', handler);
    },

    onHistoryData: (callback: (transcripts: unknown[]) => void) => {
        const handler = (_event: IpcRendererEvent, transcripts: unknown[]) => callback(transcripts);
        ipcRenderer.on('history-data', handler);
        return () => ipcRenderer.removeListener('history-data', handler);
    },

    openApiSettingsWindow: (draft: ApiSettingsDraft) => {
        ipcRenderer.send('open-api-settings-window', draft);
    },

    saveApiSettingsWindow: (draft: ApiSettingsDraft) => {
        return ipcRenderer.invoke('save-api-settings-window', draft);
    },

    onApiSettingsWindowData: (callback: (draft: ApiSettingsDraft) => void) => {
        const handler = (_event: IpcRendererEvent, draft: ApiSettingsDraft) => callback(draft);
        ipcRenderer.on('api-settings-window-data', handler);
        return () => ipcRenderer.removeListener('api-settings-window-data', handler);
    },

    onApiSettingsUpdated: (callback: (config: any) => void) => {
        const handler = (_event: IpcRendererEvent, config: any) => callback(config);
        ipcRenderer.on('api-settings-updated', handler);
        return () => ipcRenderer.removeListener('api-settings-updated', handler);
    },

    openUsageGuideWindow: () => {
        ipcRenderer.send('open-usage-guide-window');
    },

    closeCurrentWindow: () => {
        ipcRenderer.send('close-current-window');
    },

    onShowControlBar: (callback: () => void) => {
        const handler = () => callback();
        ipcRenderer.on('show-control-bar', handler);
        return () => ipcRenderer.removeListener('show-control-bar', handler);
    },

    // ═══════════════════════════════════════════════════════════════
    // Engine Log (Python stderr forwarded safely via IPC)
    // ═══════════════════════════════════════════════════════════════
    onEngineLog: (callback: (msg: string) => void) => {
        const handler = (_event: IpcRendererEvent, msg: string) => {
            callback(msg);
        };
        ipcRenderer.on('engine-log', handler);
        return () => {
            ipcRenderer.removeListener('engine-log', handler);
        };
    },

    // ═══════════════════════════════════════════════════════════════
    // Engine Status (downloading_model | loading_model | listening | error)
    // ═══════════════════════════════════════════════════════════════
    onEngineStatus: (callback: (data: EngineStatus) => void) => {
        const handler = (_event: IpcRendererEvent, data: EngineStatus) => {
            callback(data);
        };
        ipcRenderer.on('engine-status', handler);
        return () => {
            ipcRenderer.removeListener('engine-status', handler);
        };
    },

    // ═══════════════════════════════════════════════════════════════
    // Ollama models + history
    // ═══════════════════════════════════════════════════════════════
    fetchOllamaModels: (endpoint: string, apiKey: string) => {
        return ipcRenderer.invoke('fetch-ollama-models', endpoint, apiKey);
    },
    getHistoryDates: () => {
        return ipcRenderer.invoke('get-history-dates');
    },
    getHistoryByDate: (date: string) => {
        return ipcRenderer.invoke('get-history-by-date', date);
    },

    // ═══════════════════════════════════════════════════════════════
    // App Info
    // ═══════════════════════════════════════════════════════════════
    getAppInfo: () => {
        return ipcRenderer.invoke('get-app-info');
    },
    exportLogs: () => {
        return ipcRenderer.invoke('export-logs');
    },

    // ═══════════════════════════════════════════════════════════════
    // Setup Wizard
    // ═══════════════════════════════════════════════════════════════
    getConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (config: any) => ipcRenderer.invoke('save-config', config),
    validateApiKeys: (keys: {
        azureSpeechKey?: string;
        azureSpeechRegion?: string;
        deepgramKey?: string;
        deeplKey?: string;
    }) =>
        ipcRenderer.invoke('validate-api-keys', keys),
    checkBlackhole: () => ipcRenderer.invoke('check-blackhole'),
    openUrl: (url: string) => ipcRenderer.send('open-url', url),
    onEngineReady: (callback: () => void) => {
        const handler = () => callback();
        ipcRenderer.on('engine-ready', handler);
        return () => ipcRenderer.removeListener('engine-ready', handler);
    },
};

// Expose to window object
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type augmentation for TypeScript
declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

console.log('[Preload] Electron API exposed to renderer');
