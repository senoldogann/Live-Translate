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
import ApiKeyModal from './components/ApiKeyModal';
import { useInteractiveZones } from './hooks/useInteractiveZones';
import type { ApiKeyValidationResult, SetupConfig } from './shared/types';
import './index.css';

// Types — mirrored from src/shared/types.ts for standalone use
interface TranscriptData {
    original: string;
    translated: string;
    timestamp: number;
    isFinal: boolean;
    confidence?: number;
    source?: 'local' | 'cloud';
    translationProvider?: 'deepl' | 'google' | 'argos' | 'fast-argos' | 'passthrough';
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

interface ApiKeySaveResult {
    ok: boolean;
    message: string;
    validation?: ApiKeyValidationResult;
}

function App() {
    // ─── State ───────────────────────────────────────────────────────────────
    const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([]);
    const [allTranscripts, setAllTranscripts] = useState<SubtitleEntry[]>([]);
    const [showControlBar, setShowControlBar] = useState(true);
    const [isListening, setIsListening] = useState(true);
    const [isStreaming, setIsStreaming] = useState(false);
    const [isWordByWord, setIsWordByWord] = useState(true);
    // false = normal (content visible); true = stealth (content zone hidden)
    const [isStealthMode, setIsStealthMode] = useState(false);
    const [showOriginal, setShowOriginal] = useState(true);
    const [opacity, setOpacity] = useState(0.9);
    const [fontSize, setFontSize] = useState(18);
    const [language, setLanguage] = useState<'en' | 'fi' | 'tr'>('en');
    const [engineType, setEngineType] = useState<'local' | 'cloud'>('local');
    const [audioLevel, setAudioLevel] = useState(0);

    // Setup Wizard State
    const [isSetupComplete, setIsSetupComplete] = useState<boolean | null>(null);
    const [isApiModalOpen, setIsApiModalOpen] = useState(false);
    const [isHistoryWindowOpen, setIsHistoryWindowOpen] = useState(false);
    const [deepgramKey, setDeepgramKey] = useState("");
    const [deeplKey, setDeeplKey] = useState("");

    // Whether speech is currently active (controls SiriWave ↔ Subtitle toggle)
    const [isSpeechActive, setIsSpeechActive] = useState(false);
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const transcriptSequenceRef = useRef(0);

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
                    if (config.engineType) {
                        setEngineType(config.engineType);
                    }
                    if (typeof config.wordByWord === 'boolean') {
                        setIsWordByWord(config.wordByWord);
                    }
                    if (config.deepgramKey) setDeepgramKey(config.deepgramKey);
                    if (config.deeplKey) setDeeplKey(config.deeplKey);
                } else {
                    setIsSetupComplete(false);
                }
            } catch (e) {
                setIsSetupComplete(false);
            }
        }
        loadConfig();
    }, []);

    const createTranscriptId = useCallback(() => {
        transcriptSequenceRef.current += 1;
        return `sentence-${Date.now()}-${transcriptSequenceRef.current}`;
    }, []);

    const persistConfigPatch = useCallback(async (patch: Partial<SetupConfig>): Promise<boolean> => {
        try {
            const currentConfig = await window.electronAPI?.getConfig();
            const baseConfig: SetupConfig = currentConfig ?? {
                isSetupComplete: Boolean(isSetupComplete),
            };

            const saved = await window.electronAPI?.saveConfig({
                ...baseConfig,
                ...patch,
            });

            return Boolean(saved);
        } catch (error) {
            console.warn('[App] Failed to persist config patch', error);
            return false;
        }
    }, [isSetupComplete]);

    const historyWindowEntries =
        subtitles[0] && !subtitles[0].isFinal
            ? [...allTranscripts, subtitles[0]]
            : allTranscripts;

    // ─── IPC Listeners ───────────────────────────────────────────────────────
    useEffect(() => {
        const handleTranscriptUpdate = (data: TranscriptData) => {
            if (!data.original && !data.translated) return;

            if (data.source === 'cloud') {
                console.info(
                    `[Transcript] cloud ${data.isFinal ? 'final' : 'partial'} `
                    + `(${data.translationProvider ?? 'unknown'}): `
                    + `${data.original.slice(0, 80)}`
                );
            } else if (data.source === 'local') {
                console.info(
                    `[Transcript] local ${data.isFinal ? 'final' : 'partial'} `
                    + `(${data.translationProvider ?? 'unknown'}): `
                    + `${data.original.slice(0, 80)}`
                );
            }

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
                        { id: createTranscriptId(), original: data.original, translated: data.translated, timestamp: now, isFinal: false },
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
                    id: createTranscriptId(), original: data.original, translated: data.translated, timestamp: now, isFinal: true,
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
            window.electronAPI?.setListening(isListening);
            window.electronAPI?.setStreamingMode(isStreaming);
            window.electronAPI?.setEngineType(engineType);
            window.electronAPI?.toggleStealth(isStealthMode);
        });

        // Listen for show-control-bar (from global shortcut ⌘+Shift+S)
        const unsubscribeShowBar = window.electronAPI.onShowControlBar?.(() => {
            setShowControlBar(true);
        });

        // Listen for engine log messages (Python stderr forwarded via IPC)
        const unsubscribeEngineLog = window.electronAPI.onEngineLog?.((msg: string) => {
            console.warn('[Engine]', msg);
        });

        const unsubscribeHistoryState = window.electronAPI.onHistoryWindowState?.((isOpen: boolean) => {
            setIsHistoryWindowOpen(isOpen);
        });

        return () => {
            unsubscribe();
            unsubscribeAudio();
            unsubscribeEngine?.();
            unsubscribeShowBar?.();
            unsubscribeEngineLog?.();
            unsubscribeHistoryState?.();
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        };
    }, [createTranscriptId, engineType, isListening, language, isStreaming, isStealthMode]);

    // ─── Handlers ────────────────────────────────────────────────────────────
    const handleToggleStealth = useCallback(() => {
        setIsStealthMode((prev) => {
            const next = !prev;
            window.electronAPI?.toggleStealth(next);
            return next;
        });
    }, []);

    const handleToggleListening = useCallback(() => {
        setIsListening((prev) => {
            const next = !prev;
            window.electronAPI?.setListening(next);

            if (!next) {
                if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
                setSubtitles([]);
                setIsSpeechActive(false);
                setAudioLevel(0);
            }

            return next;
        });
    }, []);
    const handleToggleOriginal = useCallback(() => setShowOriginal(p => !p), []);
    const handleToggleHistory = useCallback(() => {
        setIsApiModalOpen(false);
        window.electronAPI?.openHistoryWindow(historyWindowEntries);
    }, [historyWindowEntries]);

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
        void persistConfigPatch({ language: lang });
    }, [persistConfigPatch]);

    const handleToggleWordByWord = useCallback(() => {
        const next = !isWordByWord;
        setIsWordByWord(next);
        void persistConfigPatch({ wordByWord: next });
    }, [isWordByWord, persistConfigPatch]);

    const handleEngineTypeChange = useCallback((type: 'local' | 'cloud') => {
        if (type === 'cloud' && !deepgramKey) {
            setIsApiModalOpen(true);
            // Don't switch yet, wait for user to provide key
            return;
        }
        setEngineType(type);
        window.electronAPI?.setEngineType(type);
        void persistConfigPatch({ engineType: type });
    }, [deepgramKey, persistConfigPatch]);

    const handleSaveApiKeys = useCallback(async (dg: string, dl: string): Promise<ApiKeySaveResult> => {
        try {
            const trimmedDeepgram = dg.trim();
            const trimmedDeepL = dl.trim();

            const validation = await window.electronAPI?.validateApiKeys({
                deepgramKey: trimmedDeepgram,
                deeplKey: trimmedDeepL,
            });

            if (!validation) {
                return {
                    ok: false,
                    message: 'API anahtarlari dogrulanamadi. Elektron koprusu hazir degil.',
                };
            }

            if (!validation.ok) {
                const problems = [validation.deepgram, validation.deepl]
                    .filter((item) => !item.ok)
                    .map((item) => item.message);

                return {
                    ok: false,
                    message: problems.join(' '),
                    validation,
                };
            }

            const nextEngineType = trimmedDeepgram && engineType === 'local' ? 'cloud' : engineType;
            const didSave = await persistConfigPatch({
                deepgramKey: trimmedDeepgram,
                deeplKey: trimmedDeepL,
                engineType: nextEngineType,
            });

            if (!didSave) {
                return {
                    ok: false,
                    message: 'API anahtarlari dogrulandi ama config diske yazilamadi.',
                    validation,
                };
            }

            setDeepgramKey(trimmedDeepgram);
            setDeeplKey(trimmedDeepL);

            if (nextEngineType !== engineType) {
                setEngineType(nextEngineType);
                window.electronAPI?.setEngineType(nextEngineType);
            }

            return {
                ok: true,
                message: 'API anahtarlari dogrulandi, kaydedildi ve engine tarafina iletildi.',
                validation,
            };
        } catch (error) {
            return {
                ok: false,
                message: `API anahtarlari kaydedilemedi: ${error instanceof Error ? error.message : 'bilinmeyen hata'}`,
            };
        }
    }, [engineType, persistConfigPatch]);

    // ─── Refs for interactive zones ──────────────────────────────────────────
    const bottomSectionRef = useRef<HTMLDivElement>(null);
    const restoreBtnRef = useRef<HTMLButtonElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    // Tracks modal open state inside ResizeObserver callback (avoids stale closure)
    const isApiModalOpenRef = useRef(isApiModalOpen);

    useInteractiveZones({
        showControlBar,
        showHistory: false,
        fullWindowInteractive: isApiModalOpen,
        bottomSectionRef,
        restoreBtnRef,
        subtitleCount: subtitles.length,
    });

    // Keep the ref in sync so the ResizeObserver callback never reads stale state
    useEffect(() => {
        isApiModalOpenRef.current = isApiModalOpen;
    }, [isApiModalOpen]);

    // ─── API Modal: temporarily expand window so modal renders fully ─────────
    useEffect(() => {
        if (isApiModalOpen) {
            // The modal is centered over the whole overlay, so it needs more headroom.
            window.electronAPI?.setWindowHeight(720);
            window.electronAPI?.setIgnoreMouseEvents(false);
            window.electronAPI?.forceFocus();
        }
        // When closed the ResizeObserver naturally recalculates the correct height
    }, [isApiModalOpen]);

    useEffect(() => {
        if (isHistoryWindowOpen) {
            window.electronAPI?.updateHistoryWindow?.(historyWindowEntries);
        }
    }, [historyWindowEntries, isHistoryWindowOpen]);

    // ─── Dynamic Window Resizing ─────────────────────────────────────────────
    useEffect(() => {
        if (!containerRef.current) return;

        const handleResize = (entries: ResizeObserverEntry[]) => {
            // Don't fight the manually-set height while the API modal is open
            if (!isSetupComplete || isApiModalOpenRef.current) return;

            for (const entry of entries) {
                // Add a small buffer but keep it tight
                const contentHeight = entry.contentRect.height + 20;
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
        return <SetupWizard onComplete={(config: SetupConfig) => {
            setIsSetupComplete(true);
            if (config.language) {
                setLanguage(config.language);
                window.electronAPI?.setLanguage(config.language);
            }
            if (config.engineType) {
                setEngineType(config.engineType);
            }
            window.electronAPI?.restartEngine();
        }} />;
    }

    return (
        <div ref={containerRef} className="app-container" style={{ height: 'fit-content' }}>

            {/* ── Content Zone: hidden in stealth mode ── */}
            <AnimatePresence>
                {!isStealthMode && (
                    <motion.div
                        key="content-zone"
                        className="content-zone"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25 }}
                        style={{ overflow: 'hidden', width: '100%' }}
                    >
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
                                    <AnimatePresence mode="wait">
                                        {subtitles.map((subtitle, index) => (
                                            <SubtitleOverlay
                                                key={subtitle.id}
                                                original={showOriginal ? subtitle.original : undefined}
                                                isFinal={subtitle.isFinal}
                                                wordByWord={isWordByWord}
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
                    </motion.div>
                )}
            </AnimatePresence>

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
                    isWordByWord={isWordByWord}
                    onToggleWordByWord={handleToggleWordByWord}
                    language={language}
                    onLanguageChange={handleLanguageChange}
                    engineType={engineType}
                    onEngineTypeChange={handleEngineTypeChange}
                    onShowApiSettings={() => {
                        setIsApiModalOpen(true);
                    }}
                />

            </motion.div>

            <ApiKeyModal
                isOpen={isApiModalOpen}
                onClose={() => setIsApiModalOpen(false)}
                onSave={handleSaveApiKeys}
                initialDeepgramKey={deepgramKey}
                initialDeeplKey={deeplKey}
            />
        </div>
    );
}
export default App;
