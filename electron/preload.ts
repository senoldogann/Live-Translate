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
    // NEW: Streaming Mode
    setStreamingMode: (enabled: boolean) => void;
    // NEW: Language Selection
    setLanguage: (lang: string) => void;

    // App info
    getAppInfo: () => Promise<AppInfo>;
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

    setStreamingMode: (enabled: boolean) => {
        ipcRenderer.send('set-streaming-mode', enabled);
    },

    setLanguage: (lang: string) => {
        console.log('[Preload] setLanguage called with:', lang);
        ipcRenderer.send('set-language', lang);
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

// Type augmentation for TypeScript
declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

console.log('[Preload] Electron API exposed to renderer');
