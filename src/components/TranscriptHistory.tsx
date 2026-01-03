/**
 * Transcript History Panel
 * 
 * Tüm konuşma geçmişini zaman damgası ile gösteren panel.
 * Sol: Zaman (dakika:saniye) | Sağ: Türkçe çeviri
 */

import { motion, AnimatePresence } from 'framer-motion';

interface TranscriptEntry {
    id: string;
    original: string;
    translated: string;
    timestamp: number;
}

interface TranscriptHistoryProps {
    isOpen: boolean;
    transcripts: TranscriptEntry[];
    onClose: () => void;
}

function formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

function TranscriptHistory({ isOpen, transcripts, onClose }: TranscriptHistoryProps) {
    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="transcript-history-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    <motion.div
                        className="transcript-history-panel glass-card"
                        initial={{ y: 50, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 50, opacity: 0 }}
                        transition={{ type: 'spring', damping: 25 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="transcript-history-header">
                            <h2>📝 Tüm Transcript</h2>
                            <button
                                type="button"
                                className="btn btn-icon close-btn"
                                onClick={() => {
                                    onClose();
                                }}
                                title="Kapat"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Content */}
                        <div className="transcript-history-content">
                            {transcripts.length === 0 ? (
                                <div className="transcript-empty">
                                    Henüz konuşma kaydı yok...
                                </div>
                            ) : (
                                <div className="transcript-list">
                                    {transcripts.map((entry) => (
                                        <div key={entry.id} className="transcript-item">
                                            <div className="transcript-time">
                                                {formatTime(entry.timestamp)}
                                            </div>
                                            <div className="transcript-texts">
                                                <div className="transcript-original">
                                                    {entry.original}
                                                </div>
                                                <div className="transcript-translated">
                                                    {entry.translated}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

export default TranscriptHistory;
