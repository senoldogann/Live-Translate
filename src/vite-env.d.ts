/// <reference types="vite/client" />

// Electron API type definitions
interface TranscriptData {
    original: string;
    translated: string;
    timestamp: number;
    isFinal: boolean;
    confidence?: number;
}

interface AppInfo {
    version: string;
    platform: NodeJS.Platform;
    arch: string;
    isDev: boolean;
}

interface ElectronAPI {
    onTranscriptUpdate: (callback: (data: TranscriptData) => void) => () => void;
    onAudioLevel: (callback: (level: number) => void) => () => void;
    updateInteractiveZones: (zones: Array<{ x: number, y: number, width: number, height: number }>) => void;
    setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => void;
    moveWindow: (deltaX: number, deltaY: number) => void;
    setWindowHeight: (height: number) => void;
    setStreamingMode: (enabled: boolean) => void;
    setOpacity: (opacity: number) => void;
    forceFocus: () => void;
    restartEngine: () => void;
    toggleStealth: (enabled: boolean) => void;
    quitApp: () => void;
    getAppInfo: () => Promise<AppInfo>;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

export { };
