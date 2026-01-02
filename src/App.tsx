/**
 * Stealth Subtitle Translator - Main App Component
 * 
 * Glassmorphism tasarımlı, şeffaf arka planlı subtitle overlay.
 * Electron IPC ile Python engine'den transcript alır.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import SubtitleOverlay from './components/SubtitleOverlay';
import ControlBar from './components/ControlBar';
import SiriWave from './components/SiriWave'; // Switched back to SiriWave
import TranscriptHistory from './components/TranscriptHistory';
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
    isFinal: boolean; // Added for streaming
}

// Maksimum görüntülenecek altyazı sayısı
const MAX_SUBTITLES = 1;



function App() {
    // State
    const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([]);
    const [allTranscripts, setAllTranscripts] = useState<SubtitleEntry[]>([]); // Tüm geçmiş
    const [showHistory, setShowHistory] = useState(false);
    const [showControlBar, setShowControlBar] = useState(true); // Control bar görünürlüğü
    const [isListening, setIsListening] = useState(true);
    const [isStreaming, setIsStreaming] = useState(false); // Default: Sentence Mode (False)
    const [isStealthMode, setIsStealthMode] = useState(true);
    const [showOriginal, setShowOriginal] = useState(true);
    const [opacity, setOpacity] = useState(0.9);
    const [fontSize, setFontSize] = useState(18);
    // Audio Level for SiriWave
    const [audioLevel, setAudioLevel] = useState(0);

    // Electron IPC listener
    useEffect(() => {
        // Handle incoming transcripts
        const handleTranscriptUpdate = (data: TranscriptData) => {
            // console.log('[App] Received transcript:', data);

            if (!data.original && !data.translated) return;

            setSubtitles((prev) => {
                const now = Date.now();
                const latest = prev[0];

                // 1. Durum: Partial Update (Henüz bitmedi)
                if (!data.isFinal) {
                    // Eğer son kart da partial ise, onu güncelle
                    if (latest && !latest.isFinal) {
                        const updatedLatest = {
                            ...latest,
                            original: data.original,
                            translated: data.translated,
                            timestamp: now, // Süreyi uzat
                        };
                        return [updatedLatest, ...prev.slice(1)];
                    }

                    // Eğer son kart Final ise veya hiç kart yoksa -> Yeni Partial Kart
                    const newEntry: SubtitleEntry = {
                        id: `partial-${now}`,
                        original: data.original,
                        translated: data.translated,
                        timestamp: now,
                        isFinal: false,
                    };
                    return [newEntry, ...prev].slice(0, MAX_SUBTITLES);
                }

                // 2. Durum: Final Result (Cümle bitti)
                // Son kart partial ise, onu Finalize et
                if (latest && !latest.isFinal) {
                    const finalizedLatest = {
                        ...latest,
                        original: data.original,
                        translated: data.translated,
                        timestamp: now,
                        isFinal: true,
                        id: `final-${now}` // ID'yi final yap ki animasyon resetlensin mi? Hayır, key değişirse titrer. ID'yi korumak daha iyi olabilir ama 'final-' prefixi yeni bir kart hissi verir. Streaming'de ID sabit kalmalı.
                        // Partial ID 'partial-...' idi. Final ID de aynı kalsa?
                        // React key değiştiğinde unmount/remount yapar. Yumuşak geçiş için key aynı kalmalı.
                    };
                    // Update main list
                    const updatedList = [finalizedLatest, ...prev.slice(1)];

                    // Add to history ONLY when finalized
                    setAllTranscripts(history => [...history, finalizedLatest]);

                    return updatedList;
                }

                // Eğer son kart zaten Final ise ve yeni bir Final geldiyse (Nadir durum, belki Partial atlandı)
                const newFinalEntry: SubtitleEntry = {
                    id: `final-${now}`,
                    original: data.original,
                    translated: data.translated,
                    timestamp: now,
                    isFinal: true,
                };
                setAllTranscripts(history => [...history, newFinalEntry]);
                return [newFinalEntry, ...prev].slice(0, MAX_SUBTITLES);
            });
        };

        if (typeof window.electronAPI === 'undefined') {
            // ... mock data logic update needed if used ...
            return;
        }

        const unsubscribe = window.electronAPI.onTranscriptUpdate(handleTranscriptUpdate);
        // Audio Level Listener
        const unsubscribeAudio = window.electronAPI.onAudioLevel((level) => {
            // Level is roughly 0 to 0.5 (RMS). Scale it for visualization (0 to 1)
            // Apply some gain
            const scaledLevel = Math.min(1, level * 5);
            setAudioLevel(scaledLevel);
        });

        return () => {
            unsubscribe();
            unsubscribeAudio();
        };
    }, []);

    // Toggle stealth mode
    const handleToggleStealth = useCallback(() => {
        setIsStealthMode((prev) => {
            const newValue = !prev;
            window.electronAPI?.toggleStealth(newValue);
            return newValue;
        });
    }, []);

    // Toggle listening
    const handleToggleListening = useCallback(() => {
        setIsListening((prev) => !prev);
        // TODO: Send to Python engine
    }, []);

    // Toggle original text display
    const handleToggleOriginal = useCallback(() => {
        setShowOriginal((prev) => !prev);
    }, []);

    // Adjust opacity
    const handleOpacityChange = useCallback((value: number) => {
        setOpacity(value);
        window.electronAPI?.setOpacity(value);
    }, []);

    // Adjust font size
    const handleFontSizeChange = useCallback((value: number) => {
        setFontSize(value);
    }, []);

    // Restart engine
    const handleRestartEngine = useCallback(() => {
        window.electronAPI?.restartEngine();
        setSubtitles([]);
    }, []);

    const handleToggleStreaming = useCallback(() => {
        setIsStreaming((prev) => {
            const newState = !prev;
            window.electronAPI?.setStreamingMode(newState);
            return newState;
        });
    }, []);

    // Refs for interaction detection
    const bottomSectionRef = useRef<HTMLDivElement>(null); // ControlBar wrapper
    const restoreBtnRef = useRef<HTMLButtonElement>(null);
    // TranscriptHistory already manages its own events mostly, but checking bound helps

    // Central interaction handler
    // Interaction Polling (Replaces handleMouseMove)
    useEffect(() => {
        if (!window.electronAPI) return;

        const updateZones = () => {
            const zones = [];

            // 1. Bottom Section (Control Bar)
            if (showControlBar && bottomSectionRef.current) {
                const rect = bottomSectionRef.current.getBoundingClientRect();
                zones.push({
                    x: Math.round(rect.left),
                    y: Math.round(rect.top),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                });
            }

            // 2. Restore Button
            if (!showControlBar && restoreBtnRef.current) {
                const rect = restoreBtnRef.current.getBoundingClientRect();
                zones.push({
                    x: Math.round(rect.left),
                    y: Math.round(rect.top),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                });
            }

            // 3. Subtitles (Draggable)
            const subtitles = document.querySelectorAll('.interactive-subtitle');
            subtitles.forEach(el => {
                const rect = el.getBoundingClientRect();
                zones.push({
                    x: Math.round(rect.left),
                    y: Math.round(rect.top),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                });
            });

            // 4. History Panel
            if (showHistory) {
                // History açıkken tüm ekran etkileşimli olsun (basit çözüm)
                zones.push({ x: 0, y: 0, width: 9999, height: 9999 });
            }

            window.electronAPI.updateInteractiveZones(zones);
        };

        // UI değişimlerinde hemen güncelle
        updateZones();

        // Her 200ms'de bir konum güncelle (pencere taşınırsa vs)
        const interval = setInterval(updateZones, 200);

        return () => clearInterval(interval);
    }, [showControlBar, showHistory, subtitles.length]); // subtitles değişince boyut değişebilir

    // Toggle history panel
    const handleToggleHistory = useCallback(() => {
        setShowHistory((prev) => !prev);
    }, []);

    // ═══════════════════════════════════════════════════════════════════
    // Dynamic Window Resizing Logic
    // ═══════════════════════════════════════════════════════════════════
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const handleResize = (entries: ResizeObserverEntry[]) => {
            for (const entry of entries) {
                // İçerik yüksekliğini al (padding dahil)
                const contentHeight = entry.contentRect.height + 40; // +40px extra padding/safe area

                // Çok küçük değişimleri veya gereksiz güncellemeleri filtrele
                // Min yükseklik 180px
                const targetHeight = Math.max(180, Math.ceil(contentHeight));

                window.electronAPI?.setWindowHeight(targetHeight);
            }
        };

        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(containerRef.current);

        return () => resizeObserver.disconnect();
    }, [subtitles, showControlBar, fontSize]); // Dependencies crucial for trigger

    return (
        <div ref={containerRef} className="app-container" style={{ height: 'fit-content', minHeight: '100vh' }}>
            {/* Subtitle display area */}
            <div className="subtitle-area">
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
            </div>

            {/* Toggle control bar button (Only visible when bar is hidden) */}
            {!showControlBar && (
                <button
                    ref={restoreBtnRef}
                    className="toggle-restore-btn"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowControlBar(true);
                        // Pencereyi zorla öne getir, aksi halde arkada kalabilir
                        window.electronAPI?.forceFocus();
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    title="Control Bar'ı Göster"
                >
                    ▲
                </button>
            )}

            {/* Bottom section: Siri wave + Control bar */}
            <motion.div
                ref={bottomSectionRef}
                className="bottom-section"
                initial={false}
                animate={{
                    opacity: showControlBar ? 1 : 0,
                    y: showControlBar ? 0 : 20,
                    pointerEvents: showControlBar ? 'auto' : 'none'
                }}
                transition={{ duration: 0.2 }}
                style={{
                    position: 'relative',
                    zIndex: 50
                }}
            >
                {/* Classic Siri Wave Visualizer */}
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '-10px' }}>
                    <SiriWave
                        isActive={isListening}
                        amplitude={audioLevel}
                        width={300}
                        height={60}
                    />
                </div>

                {/* Control bar */}
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
                    onToggleVisible={() => setShowControlBar(prev => !prev)}
                    onQuit={() => window.electronAPI?.quitApp()}
                    isStreaming={isStreaming}
                    onToggleStreaming={handleToggleStreaming}
                />
            </motion.div>

            {/* Transcript History Panel */}
            <TranscriptHistory
                isOpen={showHistory}
                transcripts={allTranscripts}
                onClose={() => setShowHistory(false)}
            />
        </div>
    );
}

export default App;
