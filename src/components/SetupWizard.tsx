import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SetupConfig } from '../shared/types';
import './SetupWizard.css';

interface SetupWizardProps {
    onComplete: (config: SetupConfig) => void;
}

type Lang = 'en' | 'tr';

const TEXTS = {
    tr: {
        welcome: "Hoş Geldiniz",
        welcomeDesc: "Live Translate kurulumuna başlıyoruz. Seçiminizi yapın.",
        next: "İleri",
        back: "Geri",
        finish: "Bitir ve Başla",
        checking: "Kontrol Ediliyor...",

        stepAudio: "Sistem Sesi Kurulumu",
        stepAudioDesc: "Uygulamanın çeviri yapabilmesi için bilgisayarınızın sesini duyabilmesi gerekir.",
        bhFound: "BlackHole 2ch Bulundu!",
        bhFoundDesc: "Sistem seslerini başarıyla dinleyebiliriz.",
        bhMissing: "BlackHole 2ch Bulunamadı",
        bhMissingDesc: "Lütfen BlackHole sanal ses sürücüsünü kurun. Kurulumdan sonra 'Tekrar Kontrol Et' butonuna basabilirsiniz.",
        bhCheckAgain: "Tekrar Kontrol Et",
        bhDownload: "İndir (Ücretsiz)",

        stepFinish: "Kurulum Tamamlandı!",
        stepFinishDesc: "Her şey hazır. Uygulamanın sağ üstündeki tekerlek (⚙️) ikonundan daima ayarlara ulaşabilirsiniz."
    },
    en: {
        welcome: "Welcome",
        welcomeDesc: "Let's set up Live Translate. Choose your language.",
        next: "Next",
        back: "Back",
        finish: "Finish & Start",
        checking: "Checking...",

        stepAudio: "System Audio Setup",
        stepAudioDesc: "The app needs to capture your system audio to translate movies & meetings.",
        bhFound: "BlackHole 2ch Found!",
        bhFoundDesc: "System audio capture is ready.",
        bhMissing: "BlackHole 2ch Not Found",
        bhMissingDesc: "Please install the BlackHole virtual audio driver. Click 'Check Again' after installing.",
        bhCheckAgain: "Check Again",
        bhDownload: "Download (Free)",

        stepFinish: "Setup Complete!",
        stepFinishDesc: "Everything is ready. You can always change settings by clicking the gear (⚙️) icon."
    }
};

export default function SetupWizard({ onComplete }: SetupWizardProps) {
    const [step, setStep] = useState(1);
    const [lang, setLang] = useState<Lang>('en');
    const [bhStatus, setBhStatus] = useState<'checking' | 'found' | 'missing'>('missing');

    const t = TEXTS[lang];

    // Check Blackhole when landing on Step 2
    useEffect(() => {
        if (step === 2) {
            checkBh();
        }
    }, [step]);

    const checkBh = async () => {
        setBhStatus('checking');
        try {
            // Method 1: Ask Browser/Renderer for devices (more reliable & permissions-aware)
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioDevices = devices.filter(d => d.kind === 'audioinput' || d.kind === 'audiooutput');
            const hasBh = audioDevices.some(d =>
                d.label.toLowerCase().includes('blackhole') ||
                d.groupId.toLowerCase().includes('blackhole')
            );

            if (hasBh) {
                console.log('[SetupSync] BlackHole found via navigator.mediaDevices');
                setBhStatus('found');
                return;
            }

            // Method 2: Fallback to Native Helper
            const hasBhNative = await window.electronAPI?.checkBlackhole();
            console.log(`[SetupSync] BlackHole native check result: ${hasBhNative}`);
            setBhStatus(hasBhNative ? 'found' : 'missing');
        } catch (e) {
            console.error('[SetupSync] Error checking BlackHole:', e);
            setBhStatus('missing');
        }
    };

    const handleNext = () => setStep(s => s + 1);
    const handleBack = () => setStep(s => s - 1);

    const handleFinish = async () => {
        const config: SetupConfig = {
            isSetupComplete: true,
            language: lang,
            engineType: 'local',
            deepgramKey: "",
            deeplKey: ""
        };
        // Save to native config
        await window.electronAPI?.saveConfig(config);
        onComplete(config);
    };

    const openLink = (url: string) => {
        window.electronAPI?.openUrl(url);
    };

    return (
        <div className="wizard-overlay">
            <div className="wizard-container">
                <AnimatePresence mode="wait">

                    {/* STEP 1: WELCOME & LANG */}
                    {step === 1 && (
                        <motion.div
                            key="step1"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="wizard-content"
                        >
                            <div className="wizard-header">
                                <h2>{t.welcome}</h2>
                                <p>{t.welcomeDesc}</p>
                            </div>

                            <div className="lang-selector">
                                <button
                                    className={`lang-btn ${lang === 'en' ? 'active' : ''}`}
                                    onClick={() => setLang('en')}
                                >
                                    <span className="emoji">🇬🇧</span>
                                    <span className="text">English</span>
                                </button>
                                <button
                                    className={`lang-btn ${lang === 'tr' ? 'active' : ''}`}
                                    onClick={() => setLang('tr')}
                                >
                                    <span className="emoji">🇹🇷</span>
                                    <span className="text">Türkçe</span>
                                </button>
                            </div>

                            <div className="wizard-actions">
                                <button className="wizard-btn primary" onClick={handleNext}>{t.next}</button>
                            </div>
                        </motion.div>
                    )}

                    {/* STEP 2: AUDIO SETUP (BlackHole) */}
                    {step === 2 && (
                        <motion.div
                            key="step2"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="wizard-content"
                        >
                            <div className="wizard-header">
                                <h2>{t.stepAudio}</h2>
                                <p>{t.stepAudioDesc}</p>
                            </div>

                            {bhStatus === 'checking' && (
                                <div className="check-result">
                                    <div className="icon">⏳</div>
                                    <div className="text">
                                        <h4>{t.checking}</h4>
                                    </div>
                                </div>
                            )}

                            {bhStatus === 'found' && (
                                <div className="check-result success">
                                    <div className="icon">✅</div>
                                    <div className="text">
                                        <h4>{t.bhFound}</h4>
                                        <p>{t.bhFoundDesc}</p>
                                    </div>
                                </div>
                            )}

                            {bhStatus === 'missing' && (
                                <div className="check-result error">
                                    <div className="icon">⚠️</div>
                                    <div className="text">
                                        <h4>{t.bhMissing}</h4>
                                        <p>{t.bhMissingDesc}</p>
                                    </div>
                                </div>
                            )}

                            <div className="wizard-actions">
                                <button className="wizard-btn secondary" onClick={handleBack} style={{ marginRight: 'auto' }}>{t.back}</button>

                                {bhStatus === 'missing' && (
                                    <>
                                        <button className="wizard-btn secondary" onClick={() => openLink('https://existential.audio/blackhole/')}>
                                            {t.bhDownload}
                                        </button>
                                        <button className="wizard-btn primary" onClick={checkBh}>{t.bhCheckAgain}</button>
                                    </>
                                )}

                                {bhStatus === 'found' && (
                                    <button className="wizard-btn primary" onClick={handleNext}>{t.next}</button>
                                )}
                            </div>
                        </motion.div>
                    )}

                    {/* STEP 3: FINISH */}
                    {step === 3 && (
                        <motion.div
                            key="step3"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="wizard-content"
                            style={{ textAlign: 'center' }}
                        >
                            <div className="wizard-header" style={{ marginTop: '20px' }}>
                                <div style={{ fontSize: '64px', marginBottom: '20px' }}>🚀</div>
                                <h2>{t.stepFinish}</h2>
                                <p style={{ maxWidth: '80%', margin: '0 auto' }}>{t.stepFinishDesc}</p>
                            </div>

                            <div className="wizard-actions" style={{ justifyContent: 'center', marginTop: '40px' }}>
                                <button className="wizard-btn secondary" onClick={handleBack}>{t.back}</button>
                                <button className="wizard-btn primary" onClick={handleFinish}>{t.finish}</button>
                            </div>
                        </motion.div>
                    )}

                </AnimatePresence>
            </div>
        </div>
    );
}
