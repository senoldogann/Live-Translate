/**
 * Control Bar Component
 * 
 * Draggable kontrol çubuğu.
 * Stealth mode, listening toggle, opacity ve font size kontrolleri.
 */

import { useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';

// Constants
const OPACITY_MIN = 0.3;
const OPACITY_MAX = 1.0;
const OPACITY_STEP = 0.1;

const FONT_SIZE_MIN = 14;
const FONT_SIZE_MAX = 28;
const FONT_SIZE_STEP = 2;

interface ControlBarProps {
    isListening: boolean;
    isStealthMode: boolean;
    showOriginal: boolean;
    opacity: number;
    fontSize: number;
    isStreaming: boolean;
    isWordByWord: boolean;
    language: 'en' | 'fi' | 'tr';
    engineType: 'local' | 'cloud';
    onToggleListening: () => void;
    onToggleStealth: () => void;
    onToggleOriginal: () => void;
    onOpacityChange: (value: number) => void;
    onFontSizeChange: (value: number) => void;
    onRestartEngine: () => void;
    onShowHistory: () => void;
    onToggleVisible: () => void;
    onQuit: () => void;
    onToggleStreaming: () => void;
    onToggleWordByWord: () => void;
    onLanguageChange: (lang: 'en' | 'fi' | 'tr') => void;
    onEngineTypeChange: (type: 'local' | 'cloud') => void;
    onShowApiSettings: () => void;
    onShowUsageGuide: () => void;
    showTooltips?: boolean;
    engineStatus?: { state: 'downloading_model' | 'loading_model' | 'listening' | 'error'; detail?: string } | null;
}

// Icons (inline SVG for bundle size)
const Icons = {
    stream: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
    ),
    x: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    ),
    mic: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
    ),
    micOff: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
    ),
    eye: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    ),
    eyeOff: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
    ),
    shield: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
    ),
    shieldOff: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19.69 14a6.9 6.9 0 0 0 .31-2V5l-8-3-3.16 1.18" />
            <path d="M4.73 4.73L4 5v7c0 6 8 10 8 10a20.29 20.29 0 0 0 5.62-4.38" />
            <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
    ),
    refresh: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
    ),
    text: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4 7 4 4 20 4 20 7" />
            <line x1="9" y1="20" x2="15" y2="20" />
            <line x1="12" y1="4" x2="12" y2="20" />
        </svg>
    ),
    typewriter: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="6" y1="11" x2="18" y2="11" />
            <line x1="8" y1="16" x2="16" y2="16" />
        </svg>
    ),
    list: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
    ),
    camera: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
            <circle cx="12" cy="13" r="3" />
        </svg>
    ),
    globe: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
    ),
    settings: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    ),
    info: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
    ),
};

// ── UI i18n (ControlBar tooltip'leri) ────────────────────────────────────────
// Yayin dili varsayilani EN; TR destegi icin language === 'tr' kullanilir.
const UI_TEXTS = {
    en: {
        listening: 'Listening',
        paused: 'Paused',
        pause: 'Pause',
        listen: 'Listen',
        wordMode: 'Word-by-word mode (fast)',
        sentenceMode: 'Sentence mode (stable)',
        flowOn: 'Fluid typing on',
        flowOff: 'Fluid typing off',
        screenshot: '📷 Screenshot Mode (Make Visible)',
        stealthBack: '🔒 Back to Stealth',
        hideOriginal: 'Hide original text',
        showOriginal: 'Show original text',
        opacity: 'Opacity',
        fontSize: 'Font size',
        restartEngine: 'Restart engine',
        apiSettings: 'API Settings',
        usageGuide: 'Usage guide',
        history: 'Transcript history',
        hideBar: 'Hide',
        quit: 'Quit',
        sourceLang: 'Source language',
        engine: 'Engine',
        local: '💻 Local',
        cloud: '☁️ Cloud',
        downloadingModel: 'Downloading Whisper model (first run, ~{size}MB)...',
        loadingModel: 'Loading model...',
        engineError: 'Engine error',
    },
    tr: {
        listening: 'Dinleniyor',
        paused: 'Duraklatıldı',
        pause: 'Durakla',
        listen: 'Dinle',
        wordMode: 'Kelime Kelime Modu (Hızlı)',
        sentenceMode: 'Cümle Modu (Stabil)',
        flowOn: 'Akıcı Yazım Açık',
        flowOff: 'Akıcı Yazım Kapalı',
        screenshot: '📷 Screenshot Al (Görünür Yap)',
        stealthBack: '🔒 Gizli Moda Dön',
        hideOriginal: 'İngilizceyi Gizle',
        showOriginal: 'İngilizceyi Göster',
        opacity: 'Şeffaflık',
        fontSize: 'Yazı Boyutu',
        restartEngine: 'Motoru Yeniden Başlat',
        apiSettings: 'API Ayarları',
        usageGuide: 'Kullanim Senaryolari',
        history: 'Tüm Transcript',
        hideBar: 'Gizle',
        quit: 'Kapat',
        sourceLang: 'Kaynak Dil Seçimi',
        engine: 'Motor Seçimi',
        local: '💻 Yerel',
        cloud: '☁️ Bulut',
        downloadingModel: 'Whisper modeli indiriliyor (ilk açılış, ~{size}MB)...',
        loadingModel: 'Model yükleniyor...',
        engineError: 'Motor hatası',
    },
} as const;

function ControlBar({
    isListening,
    isStealthMode,
    showOriginal,
    opacity,
    fontSize,
    onToggleListening,
    onToggleStealth,
    onToggleOriginal,
    onOpacityChange,
    onFontSizeChange,
    onRestartEngine,
    onShowHistory,
    onToggleVisible,
    onQuit,
    isStreaming,
    onToggleStreaming,
    isWordByWord,
    onToggleWordByWord,
    language,
    onLanguageChange,
    engineType,
    onEngineTypeChange,
    onShowApiSettings,
    onShowUsageGuide,
    showTooltips = true,
    engineStatus = null,
}: ControlBarProps) {
    const ui = language === 'tr' ? UI_TEXTS.tr : UI_TEXTS.en;
    const [isDragging, setIsDragging] = useState(false);
    const dragStartPos = useRef({ x: 0, y: 0 });
    const controlBarRef = useRef<HTMLDivElement>(null);

    // Mouse eventleri artık App.tsx tarafından yönetiliyor

    // Drag handling
    const handleDragStart = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.control-bar-inner')) return;

        setIsDragging(true);
        dragStartPos.current = { x: e.clientX, y: e.clientY };
    }, []);

    const handleDrag = useCallback((e: React.MouseEvent) => {
        if (!isDragging) return;

        const deltaX = e.clientX - dragStartPos.current.x;
        const deltaY = e.clientY - dragStartPos.current.y;

        if (typeof window.electronAPI !== 'undefined') {
            window.electronAPI.moveWindow(deltaX, deltaY);
        }

        dragStartPos.current = { x: e.clientX, y: e.clientY };
    }, [isDragging]);

    const handleDragEnd = useCallback(() => {
        setIsDragging(false);
    }, []);

    return (
        <motion.div
            ref={controlBarRef}
            className="control-bar"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.3 }}
            onMouseDown={handleDragStart}
            onMouseMove={handleDrag}
            onMouseUp={handleDragEnd}
            onMouseLeave={handleDragEnd}
        >
            <div
                className="control-bar-inner"
                data-tooltips-disabled={showTooltips ? 'false' : 'true'}
            >
                {/* Status indicator */}
                <div
                    className={`status-dot tooltip ${isListening ? 'listening' : 'paused'}`}
                    data-tooltip={isListening ? ui.listening : ui.paused}
                    aria-label={isListening ? ui.listening : ui.paused}
                    role="status"
                />

                {/* Engine status badge (model download / load / error) */}
                {engineStatus && engineStatus.state !== 'listening' && (
                    <span
                        className={`engine-status-badge ${engineStatus.state === 'error' ? 'is-error' : ''}`}
                        role="status"
                        aria-live="polite"
                    >
                        {engineStatus.state === 'downloading_model' && (
                            <span className="engine-status-spinner" aria-hidden="true" />
                        )}
                        {engineStatus.state === 'downloading_model'
                            ? ui.downloadingModel.replace('{size}', engineStatus.detail?.split('|')[1] ?? '')
                            : engineStatus.state === 'loading_model'
                                ? ui.loadingModel
                                : ui.engineError}
                    </span>
                )}

                {/* Divider */}
                <div className="divider" />

                {/* Listening toggle */}
                <button
                    className={`btn btn-icon tooltip ${isListening ? 'btn-success' : 'btn-danger'}`}
                    onClick={onToggleListening}
                    data-tooltip={isListening ? ui.pause : ui.listen}
                    aria-label={isListening ? ui.pause : ui.listen}
                >
                    {isListening ? Icons.mic : Icons.micOff}
                </button>

                {/* Streaming mode toggle */}
                <button
                    className={`btn btn-icon tooltip ${isStreaming ? 'btn-success' : ''}`}
                    onClick={onToggleStreaming}
                    data-tooltip={isStreaming ? ui.wordMode : ui.sentenceMode}
                    aria-label={isStreaming ? ui.wordMode : ui.sentenceMode}
                >
                    {Icons.stream}
                </button>

                {/* Word-by-word render toggle */}
                <button
                    className={`btn btn-icon tooltip ${isWordByWord ? 'btn-success' : ''}`}
                    onClick={onToggleWordByWord}
                    data-tooltip={isWordByWord ? ui.flowOn : ui.flowOff}
                    aria-label={isWordByWord ? ui.flowOn : ui.flowOff}
                >
                    {Icons.typewriter}
                </button>

                {/* Screenshot mode toggle (stealth off = visible in screenshots) */}
                <button
                    className={`btn btn-icon tooltip ${isStealthMode ? '' : 'btn-warning'}`}
                    onClick={onToggleStealth}
                    data-tooltip={isStealthMode ? ui.screenshot : ui.stealthBack}
                    aria-label={isStealthMode ? ui.screenshot : ui.stealthBack}
                >
                    {isStealthMode ? Icons.camera : Icons.shield}
                </button>

                {/* Show original toggle */}
                <button
                    className={`btn btn-icon tooltip ${showOriginal ? '' : ''}`}
                    onClick={onToggleOriginal}
                    data-tooltip={showOriginal ? ui.hideOriginal : ui.showOriginal}
                    aria-label={showOriginal ? ui.hideOriginal : ui.showOriginal}
                >
                    {showOriginal ? Icons.eye : Icons.eyeOff}
                </button>

                {/* Language Selector */}
                <select
                    className="select-lang"
                    value={language}
                    onChange={(e) => onLanguageChange(e.target.value as 'en' | 'fi' | 'tr')}
                    aria-label={ui.sourceLang}
                >
                    <option value="en">🇬🇧 EN</option>
                    <option value="tr">🇹🇷 TR</option>
                    <option value="fi">🇫🇮 FI</option>
                </select>

                {/* Engine Selector */}
                <select
                    className="select-lang"
                    value={engineType}
                    onChange={(e) => onEngineTypeChange(e.target.value as 'local' | 'cloud')}
                    aria-label={ui.engine}
                    style={{ marginLeft: '4px' }}
                >
                    <option value="local">{ui.local}</option>
                    <option value="cloud">{ui.cloud}</option>
                </select>

                {/* Divider */}
                <div className="divider" />

                {/* Opacity slider */}
                <div className="slider-container tooltip" data-tooltip={ui.opacity}>
                    <span className="slider-label">{ui.opacity}</span>
                    <input
                        type="range"
                        className="slider"
                        min={OPACITY_MIN}
                        max={OPACITY_MAX}
                        step={OPACITY_STEP}
                        value={opacity}
                        onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
                        aria-label={ui.opacity}
                    />
                </div>

                {/* Font size slider */}
                <div className="slider-container tooltip" data-tooltip={ui.fontSize}>
                    <span className="slider-label">{Icons.text}</span>
                    <input
                        type="range"
                        className="slider"
                        min={FONT_SIZE_MIN}
                        max={FONT_SIZE_MAX}
                        step={FONT_SIZE_STEP}
                        value={fontSize}
                        onChange={(e) => onFontSizeChange(parseInt(e.target.value))}
                        aria-label={ui.fontSize}
                    />
                </div>

                {/* Divider */}
                <div className="divider" />

                {/* Restart engine */}
                <button
                    className="btn btn-icon tooltip"
                    onClick={onRestartEngine}
                    data-tooltip={ui.restartEngine}
                    aria-label={ui.restartEngine}
                >
                    {Icons.refresh}
                </button>

                {/* API Settings */}
                <button
                    className="btn btn-icon tooltip"
                    onClick={onShowApiSettings}
                    data-tooltip={ui.apiSettings}
                    aria-label={ui.apiSettings}
                >
                    {Icons.settings}
                </button>

                {/* Usage guide */}
                <button
                    className="btn btn-icon tooltip"
                    onClick={onShowUsageGuide}
                    data-tooltip={ui.usageGuide}
                    aria-label={ui.usageGuide}
                >
                    {Icons.info}
                </button>

                {/* Divider */}
                <div className="divider" />

                {/* Transcript history */}
                <button
                    className="btn btn-icon tooltip"
                    onClick={onShowHistory}
                    data-tooltip={ui.history}
                    aria-label={ui.history}
                >
                    {Icons.list}
                </button>

                {/* Divider */}
                <div className="divider" />

                {/* Hide Control Bar */}
                <button
                    className="btn btn-icon tooltip"
                    onClick={() => onToggleVisible()}
                    data-tooltip={ui.hideBar}
                    aria-label={ui.hideBar}
                >
                    ▼
                </button>

                {/* Divider */}
                <div className="divider" />

                {/* Quit App */}
                <button
                    className="btn btn-icon tooltip btn-danger"
                    onClick={onQuit}
                    data-tooltip={ui.quit}
                    aria-label={ui.quit}
                >
                    {Icons.x}
                </button>
            </div>
        </motion.div>
    );
}

export default ControlBar;
