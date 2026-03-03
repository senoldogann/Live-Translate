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

interface SetupConfig {
    isSetupComplete: boolean;
    deepgramKey?: string;
    deeplKey?: string;
    language?: 'en' | 'tr';
}

interface ElectronAPI {
    onTranscriptUpdate: (callback: (data: TranscriptData) => void) => () => void;
    onAudioLevel: (callback: (level: number) => void) => () => void;
    onEngineReady?: (callback: () => void) => () => void;
    updateInteractiveZones: (zones: Array<{ x: number, y: number, width: number, height: number }>) => void;
    setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => void;
    moveWindow: (deltaX: number, deltaY: number) => void;
    setWindowHeight: (height: number) => void;
    setStreamingMode: (enabled: boolean) => void;
    setEngineType: (type: string) => void;
    setOpacity: (opacity: number) => void;
    forceFocus: () => void;
    restartEngine: () => void;
    toggleStealth: (enabled: boolean) => void;
    setLanguage: (lang: string) => void;
    quitApp: () => void;
    getAppInfo: () => Promise<AppInfo>;
    openHistoryWindow: (transcripts: unknown[]) => void;
    onShowControlBar?: (callback: () => void) => () => void;

    // Kurulum Sihirbazı IPC'leri
    getConfig: () => Promise<SetupConfig>;
    saveConfig: (config: Partial<SetupConfig>) => Promise<boolean>;
    checkBlackhole: () => Promise<boolean>;
    openUrl: (url: string) => void;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

export { };
