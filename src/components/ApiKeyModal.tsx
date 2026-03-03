/**
 * API Key Modal Component
 * 
 * Kullanıcının API anahtarlarını girmesine olanak tanıyan modal.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ApiKeyValidationResult } from '../shared/types';
import './ApiKeyModal.css';

interface ApiKeySaveResult {
    ok: boolean;
    message: string;
    validation?: ApiKeyValidationResult;
}

interface ApiKeyModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (deepgramKey: string, deeplKey: string) => Promise<ApiKeySaveResult>;
    initialDeepgramKey?: string;
    initialDeeplKey?: string;
}

export default function ApiKeyModal({
    isOpen,
    onClose,
    onSave,
    initialDeepgramKey = "",
    initialDeeplKey = ""
}: ApiKeyModalProps) {
    const [deepgramKey, setDeepgramKey] = useState(initialDeepgramKey);
    const [deeplKey, setDeeplKey] = useState(initialDeeplKey);
    const [isSaving, setIsSaving] = useState(false);
    const [statusMessage, setStatusMessage] = useState("");
    const [statusTone, setStatusTone] = useState<'idle' | 'success' | 'error'>('idle');

    useEffect(() => {
        if (isOpen) {
            setDeepgramKey(initialDeepgramKey);
            setDeeplKey(initialDeeplKey);
            setStatusMessage("");
            setStatusTone('idle');
            setIsSaving(false);
        }
    }, [isOpen, initialDeepgramKey, initialDeeplKey]);

    const handleSave = async () => {
        if (isSaving) return;

        setIsSaving(true);
        setStatusMessage("");
        setStatusTone('idle');
        try {
            const result = await onSave(deepgramKey, deeplKey);

            if (result.ok) {
                setStatusTone('success');
                setStatusMessage(result.message);
                window.setTimeout(() => {
                    onClose();
                }, 400);
            } else {
                setStatusTone('error');
                setStatusMessage(result.message);
            }
        } catch (error) {
            setStatusTone('error');
            setStatusMessage(
                `Kaydetme islemi basarisiz: ${error instanceof Error ? error.message : 'bilinmeyen hata'}`
            );
        }
        setIsSaving(false);
    };

    const openLink = (event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
        event.preventDefault();
        window.electronAPI?.openUrl(url);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="modal-backdrop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    onMouseDown={() => {
                        if (!isSaving) {
                            onClose();
                        }
                    }}
                >
                    <motion.div
                        className="modal-panel"
                        initial={{ opacity: 0, scale: 0.96, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 8 }}
                        transition={{ duration: 0.16 }}
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <div className="modal-header">
                            <h2>API Ayarlari</h2>
                            <button className="close-btn" onClick={onClose} aria-label="Kapat" disabled={isSaving}>&times;</button>
                        </div>

                        <div className="modal-body">
                            <p className="modal-desc">
                                Bulut modu icin Deepgram zorunlu. Kaydetmeden once anahtarlar burada canli olarak dogrulanir.
                            </p>

                            <div className="form-group">
                                <label>Deepgram API Key (Bulut Transkripsiyon)</label>
                                <input
                                    type="password"
                                    placeholder="dg_xxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                    value={deepgramKey}
                                    onChange={e => setDeepgramKey(e.target.value)}
                                    disabled={isSaving}
                                />
                                <div className="form-hint">
                                    <a href="#" onClick={(event) => openLink(event, 'https://console.deepgram.com/')}>Anahtar Al</a> (200$ Ucretsiz Kredi)
                                </div>
                            </div>

                            <div className="form-group">
                                <label>DeepL API Key (Yuksek Kaliteli Ceviri)</label>
                                <input
                                    type="password"
                                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
                                    value={deeplKey}
                                    onChange={e => setDeeplKey(e.target.value)}
                                    disabled={isSaving}
                                />
                                <div className="form-hint">
                                    <a href="#" onClick={(event) => openLink(event, 'https://www.deepl.com/pro-api')}>Anahtar Al</a> (Ucretsiz Plan Mevcut)
                                </div>
                            </div>

                            {statusMessage && (
                                <div className={`modal-status ${statusTone}`}>
                                    {statusMessage}
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <button className="wizard-btn secondary" onClick={onClose} disabled={isSaving}>Vazgec</button>
                            <button className="wizard-btn primary" onClick={handleSave} disabled={isSaving}>
                                {isSaving ? 'Dogrulaniyor...' : 'Kaydet ve Uygula'}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
