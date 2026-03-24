/**
 * Shared Type Definitions
 *
 * Common types used across Electron main process, preload, and React renderer.
 * Single source of truth for IPC message shapes.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ZMQ Message Types (Python → Electron → React)
// ═══════════════════════════════════════════════════════════════════════════════

export interface TranscriptMessage {
    original: string;
    translated: string;
    timestamp: number;
    isFinal: boolean;
    confidence?: number;
    source?: 'local' | 'cloud';
    translationProvider?: 'azure-speech' | 'deepl' | 'google' | 'argos' | 'fast-argos' | 'passthrough';
    type?: 'transcript';
}

export interface AudioLevelMessage {
    type: 'audio_level';
    level: number;
}

export type EngineMessage = TranscriptMessage | AudioLevelMessage;

// ═══════════════════════════════════════════════════════════════════════════════
// IPC Payload Types (Electron ↔ React)
// ═══════════════════════════════════════════════════════════════════════════════

export interface InteractiveZone {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface AppInfo {
    version: string;
    platform: NodeJS.Platform;
    arch: string;
    isDev: boolean;
}

export interface ApiKeyValidationStatus {
    ok: boolean;
    message: string;
}

export interface ApiKeyValidationResult {
    ok: boolean;
    azureSpeech: ApiKeyValidationStatus;
    deepgram: ApiKeyValidationStatus;
    deepl: ApiKeyValidationStatus;
}

export interface ApiSettingsDraft {
    azureSpeechKey: string;
    azureSpeechRegion: string;
    deepgramKey: string;
    deeplKey: string;
    ollamaEndpoint: string;
    ollamaApiKey: string;
    ollamaModel: string;
}

export interface ApiSettingsSaveResult {
    ok: boolean;
    message: string;
    validation?: ApiKeyValidationResult;
    config?: SetupConfig;
}

export interface SetupConfig {
    isSetupComplete: boolean;
    setupComplete?: boolean; // legacy alias
    language?: 'en' | 'fi' | 'tr';
    engineType?: 'local' | 'cloud';
    wordByWord?: boolean;
    azureSpeechKey?: string;
    azureSpeechRegion?: string;
    deepgramKey?: string;
    deeplKey?: string;
    ollamaEndpoint?: string;
    ollamaApiKey?: string;
    ollamaModel?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZMQ Command Types (Electron → Python)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ConfigCommand {
    type: 'config';
    key: 'streaming_mode' | 'source_lang' | 'engine_type' | 'is_listening';
    value: string | boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Subtitle Entry (React UI state)
// ═══════════════════════════════════════════════════════════════════════════════

export interface SubtitleEntry {
    id: string;
    original: string;
    translated: string;
    timestamp: number;
    isFinal: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Electron API Interface (preload bridge)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ElectronAPI {
    // Transcript updates
    onTranscriptUpdate: (callback: (data: TranscriptMessage) => void) => () => void;
    onAudioLevel: (callback: (level: number) => void) => () => void;
    onEngineReady: (callback: () => void) => () => void;
    onShowControlBar: (callback: () => void) => () => void;
    onEngineLog?: (callback: (msg: string) => void) => () => void;

    // Window controls
    setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => void;
    moveWindow: (deltaX: number, deltaY: number) => void;
    setOpacity: (opacity: number) => void;
    updateInteractiveZones: (zones: InteractiveZone[]) => void;
    setWindowHeight: (height: number) => void;
    forceFocus: () => void;
    quitApp: () => void;

    // Engine controls
    restartEngine: () => void;
    toggleStealth: (enabled: boolean) => void;
    setListening: (enabled: boolean) => void;
    setStreamingMode: (enabled: boolean) => void;
    setEngineType: (type: string) => void;
    setLanguage: (lang: string) => void;

    // Setup Wizard
    getConfig: () => Promise<SetupConfig>;
    saveConfig: (config: SetupConfig) => Promise<boolean>;
    validateApiKeys: (keys: {
        azureSpeechKey?: string;
        azureSpeechRegion?: string;
        deepgramKey?: string;
        deeplKey?: string;
    }) => Promise<ApiKeyValidationResult>;
    checkBlackhole: () => Promise<boolean>;
    openUrl: (url: string) => void;

    // App info
    getAppInfo: () => Promise<AppInfo>;

    // History
    openHistoryWindow: (transcripts: unknown[]) => void;
    updateHistoryWindow?: (transcripts: unknown[]) => void;
    onHistoryWindowState?: (callback: (isOpen: boolean) => void) => () => void;
    onHistoryData?: (callback: (transcripts: unknown[]) => void) => () => void;
    getHistoryDates?: () => Promise<string[]>;
    getHistoryByDate?: (date: string) => Promise<any[]>;

    // Native auxiliary windows
    openApiSettingsWindow?: (draft: ApiSettingsDraft) => void;
    saveApiSettingsWindow?: (draft: ApiSettingsDraft) => Promise<ApiSettingsSaveResult>;
    onApiSettingsWindowData?: (callback: (draft: ApiSettingsDraft) => void) => () => void;
    onApiSettingsUpdated?: (callback: (config: SetupConfig) => void) => () => void;
    openUsageGuideWindow?: () => void;
    closeCurrentWindow?: () => void;
    
    // Ollama API
    fetchOllamaModels?: (endpoint: string, apiKey: string) => Promise<{ok: boolean, models?: {name: string}[], message?: string}>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Window augmentation
// ═══════════════════════════════════════════════════════════════════════════════

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
