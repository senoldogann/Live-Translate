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
import type { SetupConfig } from './shared/types';
import './index.css';

// Types — mirrored from src/shared/types.ts for standalone use
interface TranscriptData {
    original: string;
    translated: string;
    timestamp: number;
    isFinal: boolean;
    confidence?: number;
    source?: 'local' | 'cloud';
    translationProvider?: 'azure-speech' | 'deepl' | 'google' | 'argos' | 'fast-argos' | 'passthrough';
}

interface SubtitleEntry {
    id: string;
    original: string;
    translated: string;
    timestamp: number;
    isFinal: boolean;
}

function isSameTranscriptPayload(
    left: Pick<SubtitleEntry, 'original' | 'translated' | 'isFinal'> | null | undefined,
    right: Pick<SubtitleEntry, 'original' | 'translated' | 'isFinal'> | null | undefined,
): boolean {
    if (!left || !right) {
        return false;
    }

    return (
        left.original === right.original
        && left.translated === right.translated
        && left.isFinal === right.isFinal
    );
}

// Maximum number of subtitles to display at once
const MAX_SUBTITLES = 1;
// Bellek sınırsız büyümesini engellemek için kaydedilen son transkript sayısı
const MAX_TRANSCRIPT_HISTORY = 200;

// How long to wait after the last subtitle before showing the wave again (ms)
const SILENCE_TIMEOUT_MS = 3000;
const PREVIEW_THROTTLE_MS = 120;
const TOOLTIP_HEADROOM_PX = 56;

function App() {
    // ─── State ───────────────────────────────────────────────────────────────
    const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([]);
    const [allTranscripts, setAllTranscripts] = useState<SubtitleEntry[]>([]);
    const [showControlBar, setShowControlBar] = useState(true);
    const [isListening, setIsListening] = useState(true);
    const [isStreaming, setIsStreaming] = useState(true);
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
    const [isHistoryWindowOpen, setIsHistoryWindowOpen] = useState(false);
    const [hasCloudProvider, setHasCloudProvider] = useState(false);

    // Whether speech is currently active (controls SiriWave ↔ Subtitle toggle)
    const [isSpeechActive, setIsSpeechActive] = useState(false);
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const queuedPreviewRef = useRef<SubtitleEntry | null>(null);
    const lastPreviewFlushAtRef = useRef(0);
    const transcriptSequenceRef = useRef(0);
    const lastCommittedTranscriptIdRef = useRef<string | null>(null);

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
                    if (typeof config.hasCloudProvider === 'boolean') {
                        setHasCloudProvider(config.hasCloudProvider);
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

            if (!saved) {
                throw new Error('Yapilandirma kaydedilemedi.');
            }
            return true;
        } catch (error) {
            console.warn('[App] Failed to persist config patch', error);
            return false;
        }
    }, [isSetupComplete]);

    const [previewSubtitle, setPreviewSubtitle] = useState<SubtitleEntry | null>(null);

    const rawLiveSubtitle = subtitles[0] && !subtitles[0].isFinal ? subtitles[0] : null;
    const latestCommittedTranscript = allTranscripts[allTranscripts.length - 1];
    const activePreviewSubtitle = rawLiveSubtitle ? previewSubtitle : null;
    const primaryOverlaySubtitle =
        activePreviewSubtitle
        ?? (rawLiveSubtitle ? (latestCommittedTranscript ?? rawLiveSubtitle) : (subtitles[0] ?? latestCommittedTranscript ?? null));
    const overlayOriginal = showOriginal
        ? (activePreviewSubtitle?.original ?? rawLiveSubtitle?.original ?? primaryOverlaySubtitle?.original)
        : undefined;
    const liveHistoryEntry = rawLiveSubtitle;
    const historyWindowEntries =
        liveHistoryEntry && !isSameTranscriptPayload(latestCommittedTranscript, liveHistoryEntry)
            ? [...allTranscripts, liveHistoryEntry]
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

                if (data.isFinal && latest?.isFinal && isSameTranscriptPayload(latest, data)) {
                    return prev;
                }

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
                    return [finalized, ...prev.slice(1)];
                }

                // Case 3: Standalone final (rare — partial was skipped)
                const newFinal: SubtitleEntry = {
                    id: createTranscriptId(), original: data.original, translated: data.translated, timestamp: now, isFinal: true,
                };
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

        const unsubscribeApiSettings = window.electronAPI.onApiSettingsUpdated?.((config: SetupConfig) => {
            if (typeof config.hasCloudProvider === 'boolean') {
                setHasCloudProvider(config.hasCloudProvider);
            }
            if (config.engineType) {
                setEngineType(config.engineType);
            }
        });

        return () => {
            unsubscribe();
            unsubscribeAudio();
            unsubscribeEngine?.();
            unsubscribeShowBar?.();
            unsubscribeEngineLog?.();
            unsubscribeHistoryState?.();
            unsubscribeApiSettings?.();
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        };
    }, [createTranscriptId, engineType, isListening, language, isStreaming, isStealthMode]);

    useEffect(() => {
        const latest = subtitles[0];

        if (!latest?.isFinal) {
            return;
        }

        if (lastCommittedTranscriptIdRef.current === latest.id) {
            return;
        }

        setAllTranscripts((prev) => [...prev, latest].slice(-MAX_TRANSCRIPT_HISTORY));
        lastCommittedTranscriptIdRef.current = latest.id;
    }, [subtitles]);

    useEffect(() => {
        if (!rawLiveSubtitle) {
            if (previewTimerRef.current) {
                clearTimeout(previewTimerRef.current);
                previewTimerRef.current = null;
            }
            queuedPreviewRef.current = null;
            setPreviewSubtitle(null);
            lastPreviewFlushAtRef.current = 0;
            return;
        }

        const flushPreview = (nextPreview: SubtitleEntry) => {
            setPreviewSubtitle(nextPreview);
            lastPreviewFlushAtRef.current = Date.now();
        };

        const now = Date.now();
        const elapsed = now - lastPreviewFlushAtRef.current;

        if (lastPreviewFlushAtRef.current === 0 || elapsed >= PREVIEW_THROTTLE_MS) {
            queuedPreviewRef.current = null;
            if (previewTimerRef.current) {
                clearTimeout(previewTimerRef.current);
                previewTimerRef.current = null;
            }
            flushPreview(rawLiveSubtitle);
            return;
        }

        queuedPreviewRef.current = rawLiveSubtitle;

        if (previewTimerRef.current === null) {
            previewTimerRef.current = setTimeout(() => {
                const queuedPreview = queuedPreviewRef.current;
                if (queuedPreview) {
                    flushPreview(queuedPreview);
                }
                queuedPreviewRef.current = null;
                previewTimerRef.current = null;
            }, PREVIEW_THROTTLE_MS - elapsed);
        }

        return () => {
            // Timer cleanup is handled only when the live preview stream stops.
        };
    }, [rawLiveSubtitle]);

    // ─── Handlers ────────────────────────────────────────────────────────────
    const openApiSettingsWindow = useCallback(() => {
        // Ayarlar tek dogru kaynagi ana process'te kalir; renderer anahtarlari yeniden gondermez.
        window.electronAPI?.openApiSettingsWindow?.();
    }, []);

    const handleToggleStealth = useCallback(() => {
        setIsStealthMode((prev) => !prev);
    }, []);

    const handleToggleListening = useCallback(() => {
        setIsListening((prev) => {
            const next = !prev;
            window.electronAPI?.setListening(next);

            if (!next) {
                if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
                if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
                queuedPreviewRef.current = null;
                lastPreviewFlushAtRef.current = 0;
                setPreviewSubtitle(null);
                setSubtitles([]);
                setIsSpeechActive(false);
                setAudioLevel(0);
            }

            return next;
        });
    }, []);
    const handleToggleOriginal = useCallback(() => setShowOriginal(p => !p), []);
    const handleToggleHistory = useCallback(() => {
        window.electronAPI?.openHistoryWindow(historyWindowEntries);
    }, [historyWindowEntries]);

    const handleOpacityChange = useCallback((value: number) => {
        setOpacity(value);
        window.electronAPI?.setOpacity(value);
    }, []);

    const handleFontSizeChange = useCallback((value: number) => setFontSize(value), []);

    const handleRestartEngine = useCallback(() => {
        window.electronAPI?.restartEngine();
        if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
        queuedPreviewRef.current = null;
        lastPreviewFlushAtRef.current = 0;
        setPreviewSubtitle(null);
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
        if (type === 'cloud' && !hasCloudProvider) {
            openApiSettingsWindow();
            return;
        }
        setEngineType(type);
        window.electronAPI?.setEngineType(type);
        void persistConfigPatch({ engineType: type });
    }, [hasCloudProvider, openApiSettingsWindow, persistConfigPatch]);

    // ─── Refs for interactive zones ──────────────────────────────────────────
    const bottomSectionRef = useRef<HTMLDivElement>(null);
    const restoreBtnRef = useRef<HTMLButtonElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useInteractiveZones({
        showControlBar,
        showHistory: false,
        bottomSectionRef,
        restoreBtnRef,
        subtitleCount: subtitles.length,
    });

    useEffect(() => {
        if (isHistoryWindowOpen) {
            window.electronAPI?.updateHistoryWindow?.(historyWindowEntries);
        }
    }, [historyWindowEntries, isHistoryWindowOpen]);

    useEffect(() => {
        window.electronAPI?.toggleStealth(isStealthMode);
    }, [isStealthMode]);

    // ─── Dynamic Window Resizing ─────────────────────────────────────────────
    useEffect(() => {
        if (!containerRef.current) return;

        const handleResize = (entries: ResizeObserverEntry[]) => {
            if (!isSetupComplete) return;

            for (const entry of entries) {
                // Tooltip pseudo-elements do not affect layout, so reserve explicit headroom
                // while the control bar is visible to prevent hover labels clipping.
                const contentHeight = entry.contentRect.height + 20;
                const tooltipHeadroom = showControlBar && !isStealthMode ? TOOLTIP_HEADROOM_PX : 0;
                const targetHeight = Math.max(180, Math.ceil(contentHeight + tooltipHeadroom));
                window.electronAPI?.setWindowHeight(targetHeight);
            }
        };

        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, [subtitles, showControlBar, fontSize, isStealthMode]);

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
            if (typeof config.hasCloudProvider === 'boolean') {
                setHasCloudProvider(config.hasCloudProvider);
            }
            window.electronAPI?.restartEngine();
        }} />;
    }

    return (
        <div ref={containerRef} className="app-container" style={{ height: 'fit-content' }}>

            {/* ── Content Zone: always visible to user (handled by native setContentProtection for screen sharing) ── */}
            <motion.div
                key="content-zone"
                className="content-zone"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
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
                                {primaryOverlaySubtitle && (
                                    <SubtitleOverlay
                                        key={primaryOverlaySubtitle.id}
                                        original={overlayOriginal}
                                        isFinal={primaryOverlaySubtitle.isFinal}
                                        wordByWord={isWordByWord}
                                        translated={primaryOverlaySubtitle.translated}
                                        fontSize={fontSize}
                                        opacity={opacity}
                                        index={0}
                                    />
                                )}
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
                    onShowApiSettings={openApiSettingsWindow}
                    onShowUsageGuide={() => window.electronAPI?.openUsageGuideWindow?.()}
                    showTooltips={true}
                />

            </motion.div>
        </div>
    );
}
export default App;
