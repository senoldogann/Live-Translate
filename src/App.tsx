/**
 * Stealth Subtitle Translator - Main App Component
 *
 * Glassmorphism UI with transparent overlay.
 * Receives transcripts from Python engine via Electron IPC.
 *
 * Layout:
 *  - Content zone: shows SiriWave when silent, subtitles when speech is active
 *  - Control bar: always at bottom
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import SubtitleOverlay from './components/SubtitleOverlay';
import ControlBar from './components/ControlBar';
import SiriWave from './components/SiriWave';
import SetupWizard from './components/SetupWizard';
import { useInteractiveZones } from './hooks/useInteractiveZones';
import './index.css';

// Types
interface TranscriptData {
    original: string;
    translated: string;
    timestamp: number;
    isFinal: boolean;
    confidence?: number;
}

interface SubtitleEntry {
    id: string;
    original: string;
    translated: string;
    timestamp: number;
    isFinal: boolean;
}

// Maximum number of subtitles to display at once
const MAX_SUBTITLES = 1;

// How long to wait after the last subtitle before showing the wave again (ms)
const SILENCE_TIMEOUT_MS = 3000;

function App() {
    // ─── State ───────────────────────────────────────────────────────────────
    const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([]);
    const [allTranscripts, setAllTranscripts] = useState<SubtitleEntry[]>([]);
    const [showControlBar, setShowControlBar] = useState(true);
    const [isListening, setIsListening] = useState(true);
    const [isStreaming, setIsStreaming] = useState(false);
    const [isStealthMode, setIsStealthMode] = useState(true);
    const [showOriginal, setShowOriginal] = useState(true);
    const [opacity, setOpacity] = useState(0.9);
    const [fontSize, setFontSize] = useState(18);
    const [language, setLanguage] = useState<'en' | 'fi' | 'tr'>('en');
    const [engineType, setEngineType] = useState<'local' | 'cloud'>('local');
    const [audioLevel, setAudioLevel] = useState(0);

    // Setup Wizard State
    const [isSetupComplete, setIsSetupComplete] = useState<boolean | null>(null);

    // Whether speech is currently active (controls SiriWave ↔ Subtitle toggle)
    const [isSpeechActive, setIsSpeechActive] = useState(false);
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ─── Lifecycle: Config Yükleme ───────────────────────────────────────────
    useEffect(() => {
        async function loadConfig() {
            try {
                const config = await window.electronAPI?.getConfig();
                if (config) {
                    setIsSetupComplete(config.isSetupComplete || false);
                    if (config.language) {
                        setLanguage(config.language);
                        window.electronAPI?.setLanguage(config.language);
                    }
                } else {
                    setIsSetupComplete(false);
                }
            } catch (e) {
                setIsSetupComplete(false);
            }
        }
        loadConfig();
    }, []);

    // ─── IPC Listeners ───────────────────────────────────────────────────────
    useEffect(() => {
        const handleTranscriptUpdate = (data: TranscriptData) => {
            if (!data.original && !data.translated) return;

            // Mark speech as active and reset the silence timer
            setIsSpeechActive(true);
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

            // If the segment is final, start counting down to "silence"
            if (data.isFinal) {
                silenceTimerRef.current = setTimeout(() => {
                    setIsSpeechActive(false);
                    setSubtitles([]);   // Clear subtitles when silence begins
                }, SILENCE_TIMEOUT_MS);
            }

            setSubtitles((prev) => {
                const now = Date.now();
                const latest = prev[0];

                // Case 1: Partial update — update or create partial card
                if (!data.isFinal) {
                    if (latest && !latest.isFinal) {
                        return [
                            { ...latest, original: data.original, translated: data.translated, timestamp: now },
                            ...prev.slice(1),
                        ];
                    }
                    return [
                        { id: `sentence-${now}`, original: data.original, translated: data.translated, timestamp: now, isFinal: false },
                        ...prev,
                    ].slice(0, MAX_SUBTITLES);
                }

                // Case 2: Final result — finalize the latest partial card
                if (latest && !latest.isFinal) {
                    const finalized = { ...latest, original: data.original, translated: data.translated, timestamp: now, isFinal: true };
                    setAllTranscripts(h => [...h, finalized]);
                    return [finalized, ...prev.slice(1)];
                }

                // Case 3: Standalone final (rare — partial was skipped)
                const newFinal: SubtitleEntry = {
                    id: `sentence-${now}`, original: data.original, translated: data.translated, timestamp: now, isFinal: true,
                };
                setAllTranscripts(h => [...h, newFinal]);
                return [newFinal, ...prev].slice(0, MAX_SUBTITLES);
            });
        };

        if (typeof window.electronAPI === 'undefined') return;

        const unsubscribe = window.electronAPI.onTranscriptUpdate(handleTranscriptUpdate);

        const unsubscribeAudio = window.electronAPI.onAudioLevel((level) => {
            const scaledLevel = Math.min(1, level * 5);
            setAudioLevel(scaledLevel);
        });

        const unsubscribeEngine = window.electronAPI.onEngineReady?.(() => {
            window.electronAPI?.setLanguage(language);
            window.electronAPI?.setStreamingMode(isStreaming);
            window.electronAPI?.toggleStealth(isStealthMode);
        });

        // Listen for show-control-bar (from global shortcut ⌘+Shift+S)
        const unsubscribeShowBar = window.electronAPI.onShowControlBar?.(() => {
            setShowControlBar(true);
        });

        return () => {
            unsubscribe();
            unsubscribeAudio();
            unsubscribeEngine?.();
            unsubscribeShowBar?.();
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        };
    }, [language, isStreaming, isStealthMode]);

    // ─── Handlers ────────────────────────────────────────────────────────────
    const handleToggleStealth = useCallback(() => {
        setIsStealthMode((prev) => {
            const next = !prev;
            window.electronAPI?.toggleStealth(next);
            return next;
        });
    }, []);

    const handleToggleListening = useCallback(() => setIsListening(p => !p), []);
    const handleToggleOriginal = useCallback(() => setShowOriginal(p => !p), []);
    const handleToggleHistory = useCallback(() => {
        // Open history in a native window — does NOT resize the overlay
        window.electronAPI?.openHistoryWindow(allTranscripts);
    }, [allTranscripts]);

    const handleOpacityChange = useCallback((value: number) => {
        setOpacity(value);
        window.electronAPI?.setOpacity(value);
    }, []);

    const handleFontSizeChange = useCallback((value: number) => setFontSize(value), []);

    const handleRestartEngine = useCallback(() => {
        window.electronAPI?.restartEngine();
        setSubtitles([]);
        setIsSpeechActive(false);
    }, []);

    const handleToggleStreaming = useCallback(() => {
        setIsStreaming((prev) => {
            const next = !prev;
            window.electronAPI?.setStreamingMode(next);
            return next;
        });
    }, []);

    const handleLanguageChange = useCallback((lang: 'en' | 'fi' | 'tr') => {
        setLanguage(lang);
        window.electronAPI?.setLanguage(lang);
    }, []);

    const handleEngineTypeChange = useCallback((type: 'local' | 'cloud') => {
        setEngineType(type);
        window.electronAPI?.setEngineType(type);
    }, []);

    // ─── Refs for interactive zones ──────────────────────────────────────────
    const bottomSectionRef = useRef<HTMLDivElement>(null);
    const restoreBtnRef = useRef<HTMLButtonElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useInteractiveZones({ showControlBar, showHistory: false, bottomSectionRef, restoreBtnRef, subtitleCount: subtitles.length });

    // ─── Dynamic Window Resizing ─────────────────────────────────────────────
    useEffect(() => {
        if (!containerRef.current) return;

        const handleResize = (entries: ResizeObserverEntry[]) => {
            for (const entry of entries) {
                const contentHeight = entry.contentRect.height + 40;
                const targetHeight = Math.max(180, Math.ceil(contentHeight));
                window.electronAPI?.setWindowHeight(targetHeight);
            }
        };

        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, [subtitles, showControlBar, fontSize]);

    // ─── Render ──────────────────────────────────────────────────────────────
    if (isSetupComplete === null) {
        return <div className="loading-bg" style={{ height: '100vh', background: '#111' }} />;
    }

    if (!isSetupComplete) {
        return <SetupWizard onComplete={(config: any) => {
            setIsSetupComplete(true);
            if (config.language) {
                setLanguage(config.language);
                window.electronAPI?.setLanguage(config.language);
            }
            window.electronAPI?.restartEngine();
        }} />;
    }

    return (
        <div ref={containerRef} className="app-container" style={{ height: 'fit-content' }}>

            {/* ── Content Zone: SiriWave ↔ Subtitle ── */}
            <div className="content-zone">
                <AnimatePresence mode="wait">
                    {isSpeechActive ? (
                        /* ── SUBTITLES ── */
                        <motion.div
                            key="subtitles"
                            className="subtitle-area"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.25 }}
                        >
                            <AnimatePresence mode="popLayout">
                                {subtitles.map((subtitle, index) => (
                                    <SubtitleOverlay
                                        key={subtitle.id}
                                        original={showOriginal ? subtitle.original : undefined}
                                        isFinal={subtitle.isFinal}
                                        translated={subtitle.translated}
                                        fontSize={fontSize}
                                        opacity={opacity}
                                        index={index}
                                    />
                                ))}
                            </AnimatePresence>
                        </motion.div>
                    ) : (
                        /* ── SIRI WAVE (idle) ── */
                        <motion.div
                            key="siriwave"
                            className="wave-zone"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.4 }}
                            style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8px 0' }}
                        >
                            <SiriWave
                                isActive={isListening}
                                amplitude={audioLevel}
                                width={320}
                                height={64}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* ── Restore button (when control bar hidden) ── */}
            {!showControlBar && (
                <button
                    ref={restoreBtnRef}
                    className="toggle-restore-btn"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowControlBar(true);
                        window.electronAPI?.forceFocus();
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    title="Show Control Bar"
                >
                    ▲
                </button>
            )}

            {/* ── Bottom section: Control bar ── */}
            <motion.div
                ref={bottomSectionRef}
                className="bottom-section"
                initial={false}
                animate={{
                    opacity: showControlBar ? 1 : 0,
                    y: showControlBar ? 0 : 20,
                    pointerEvents: showControlBar ? 'auto' : 'none',
                }}
                transition={{ duration: 0.2 }}
                style={{ position: 'relative', zIndex: 50 }}
            >
                <ControlBar
                    isListening={isListening}
                    isStealthMode={isStealthMode}
                    showOriginal={showOriginal}
                    opacity={opacity}
                    fontSize={fontSize}
                    onToggleListening={handleToggleListening}
                    onToggleStealth={handleToggleStealth}
                    onToggleOriginal={handleToggleOriginal}
                    onOpacityChange={handleOpacityChange}
                    onFontSizeChange={handleFontSizeChange}
                    onRestartEngine={handleRestartEngine}
                    onShowHistory={handleToggleHistory}
                    onToggleVisible={() => setShowControlBar(p => !p)}
                    onQuit={() => window.electronAPI?.quitApp()}
                    isStreaming={isStreaming}
                    onToggleStreaming={handleToggleStreaming}
                    language={language}
                    onLanguageChange={handleLanguageChange}
                    engineType={engineType}
                    onEngineTypeChange={handleEngineTypeChange}
                />
            </motion.div>
        </div>
    );
}
export default App;
