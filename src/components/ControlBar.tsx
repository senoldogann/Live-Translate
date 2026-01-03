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
    onToggleListening: () => void;
    onToggleStealth: () => void;
    onToggleOriginal: () => void;
    onOpacityChange: (value: number) => void;
    onFontSizeChange: (value: number) => void;
    onRestartEngine: () => void;
    onShowHistory: () => void;
    onToggleVisible: () => void;
    onQuit: () => void;
    isStreaming: boolean;
    onToggleStreaming: () => void;
    language: 'en' | 'fi';
    onLanguageChange: (lang: 'en' | 'fi') => void;
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
};

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
    language,
    onLanguageChange,
}: ControlBarProps) {
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
            <div className="control-bar-inner">
                {/* Status indicator */}
                <div
                    className={`status-dot tooltip ${isListening ? 'listening' : 'paused'}`}
                    data-tooltip={isListening ? 'Dinleniyor' : 'Duraklatıldı'}
                    aria-label={isListening ? 'Dinleniyor' : 'Duraklatıldı'}
                    role="status"
                />

                {/* Divider */}
                <div className="divider" />

                {/* Listening toggle */}
                <button
                    className={`btn btn-icon tooltip ${isListening ? 'btn-success' : 'btn-danger'}`}
                    onClick={onToggleListening}
                    data-tooltip={isListening ? 'Durakla' : 'Dinle'}
                    aria-label={isListening ? 'Durakla' : 'Dinle'}
                >
                    {isListening ? Icons.mic : Icons.micOff}
                </button>

                {/* Streaming mode toggle */}
                <button
                    className={`btn btn-icon tooltip ${isStreaming ? 'btn-success' : ''}`}
                    onClick={onToggleStreaming}
                    data-tooltip={isStreaming ? 'Kelime Kelime Modu (Hızlı)' : 'Cümle Modu (Stabil)'}
                    aria-label={isStreaming ? 'Kelime Kelime Modu (Hızlı)' : 'Cümle Modu (Stabil)'}
                >
                    {Icons.stream}
                </button>

                {/* Screenshot mode toggle (stealth off = visible in screenshots) */}
                <button
                    className={`btn btn-icon tooltip ${isStealthMode ? '' : 'btn-warning'}`}
                    onClick={onToggleStealth}
                    data-tooltip={isStealthMode ? '📷 Screenshot Al (Görünür Yap)' : '🔒 Gizli Moda Dön'}
                    aria-label={isStealthMode ? 'Screenshot Al (Görünür Yap)' : 'Gizli Moda Dön'}
                >
                    {isStealthMode ? Icons.camera : Icons.shield}
                </button>

                {/* Show original toggle */}
                <button
                    className={`btn btn-icon tooltip ${showOriginal ? '' : ''}`}
                    onClick={onToggleOriginal}
                    data-tooltip={showOriginal ? 'İngilizceyi Gizle' : 'İngilizceyi Göster'}
                    aria-label={showOriginal ? 'İngilizceyi Gizle' : 'İngilizceyi Göster'}
                >
                    {showOriginal ? Icons.eye : Icons.eyeOff}
                </button>

                {/* Language Selector */}
                <select
                    className="select-lang"
                    value={language}
                    onChange={(e) => onLanguageChange(e.target.value as 'en' | 'fi')}
                    aria-label="Kaynak Dil Seçimi"
                >
                    <option value="en">🇬🇧 EN</option>
                    <option value="fi">🇫🇮 FI</option>
                </select>

                {/* Divider */}
                <div className="divider" />

                {/* Opacity slider */}
                <div className="slider-container tooltip" data-tooltip="Şeffaflık">
                    <span className="slider-label">Opaklık</span>
                    <input
                        type="range"
                        className="slider"
                        min={OPACITY_MIN}
                        max={OPACITY_MAX}
                        step={OPACITY_STEP}
                        value={opacity}
                        onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
                        aria-label="Opaklık"
                    />
                </div>

                {/* Font size slider */}
                <div className="slider-container tooltip" data-tooltip="Yazı Boyutu">
                    <span className="slider-label">{Icons.text}</span>
                    <input
                        type="range"
                        className="slider"
                        min={FONT_SIZE_MIN}
                        max={FONT_SIZE_MAX}
                        step={FONT_SIZE_STEP}
                        value={fontSize}
                        onChange={(e) => onFontSizeChange(parseInt(e.target.value))}
                        aria-label="Yazı Boyutu"
                    />
                </div>

                {/* Divider */}
                <div className="divider" />

                {/* Restart engine */}
                <button
                    className="btn btn-icon tooltip"
                    onClick={onRestartEngine}
                    data-tooltip="Motoru Yeniden Başlat"
                    aria-label="Motoru Yeniden Başlat"
                >
                    {Icons.refresh}
                </button>

                {/* Divider */}
                <div className="divider" />

                {/* Transcript history */}
                <button
                    className="btn btn-icon tooltip"
                    onClick={onShowHistory}
                    data-tooltip="Tüm Transcript"
                    aria-label="Tüm Transcript"
                >
                    {Icons.list}
                </button>

                {/* Divider */}
                <div className="divider" />

                {/* Hide Control Bar */}
                <button
                    className="btn btn-icon tooltip"
                    onClick={() => onToggleVisible()}
                    data-tooltip="Gizle"
                    aria-label="Gizle"
                >
                    ▼
                </button>

                {/* Divider */}
                <div className="divider" />

                {/* Quit App */}
                <button
                    className="btn btn-icon tooltip btn-danger"
                    onClick={onQuit}
                    data-tooltip="Kapat"
                    aria-label="Kapat"
                >
                    {Icons.x}
                </button>
            </div>
        </motion.div>
    );
}

export default ControlBar;
