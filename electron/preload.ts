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

interface ElectronAPI {
    // Transcript updates
    onTranscriptUpdate: (callback: (data: TranscriptData) => void) => () => void;

    // Window controls
    setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => void;
    moveWindow: (deltaX: number, deltaY: number) => void;
    setOpacity: (opacity: number) => void;

    // Engine controls
    restartEngine: () => void;
    toggleStealth: (enabled: boolean) => void;

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

    // ═══════════════════════════════════════════════════════════════
    // Engine Controls
    // ═══════════════════════════════════════════════════════════════
    restartEngine: () => {
        ipcRenderer.send('restart-engine');
    },

    toggleStealth: (enabled: boolean) => {
        ipcRenderer.send('toggle-stealth', enabled);
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
