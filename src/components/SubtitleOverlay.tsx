/**
 * Subtitle Overlay Component
 *
 * Glassmorphism tasarımlı altyazı gösterimi.
 * Fade-in animasyonu ve dinamik font boyutu.
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const PARTIAL_SEED_WORDS = 2;
const PARTIAL_STEP_WORDS = 1;
const PARTIAL_REVEAL_DELAY_MS = 48;
const FINAL_SEED_WORDS = 2;
const FINAL_STEP_WORDS = 2;
const FINAL_REVEAL_DELAY_MS = 20;

interface SubtitleOverlayProps {
    original?: string;
    translated: string;
    fontSize?: number;
    opacity?: number;
    index?: number;
    isFinal?: boolean;
    wordByWord?: boolean;
}

function splitWords(text: string): string[] {
    return text.trim().split(/\s+/).filter(Boolean);
}

function countSharedWordPrefix(left: string[], right: string[]): number {
    const maxLength = Math.min(left.length, right.length);
    let index = 0;

    while (index < maxLength && left[index] === right[index]) {
        index += 1;
    }

    return index;
}

function SubtitleOverlay({
    original,
    translated,
    fontSize = 18,
    opacity = 0.9,
    index = 0,
    isFinal = true,
    wordByWord = true,
}: SubtitleOverlayProps) {
    const initialWords = splitWords(translated);
    const initialVisibleCount =
        !wordByWord || initialWords.length <= 1
            ? initialWords.length
            : Math.min(isFinal ? FINAL_SEED_WORDS : PARTIAL_SEED_WORDS, initialWords.length);
    const [visibleTranslated, setVisibleTranslated] = useState(() =>
        initialWords.length > 0
            ? initialWords.slice(0, initialVisibleCount).join(' ')
            : translated
    );
    const revealTimerRef = useRef<number | null>(null);
    const previousTargetWordsRef = useRef<string[]>(initialWords);
    const visibleWordCountRef = useRef(initialVisibleCount);

    useEffect(() => {
        const targetWords = splitWords(translated);
        const fullText = translated.trim();

        if (revealTimerRef.current !== null) {
            window.clearInterval(revealTimerRef.current);
            revealTimerRef.current = null;
        }

        if (!wordByWord || targetWords.length <= 1 || !fullText) {
            previousTargetWordsRef.current = targetWords;
            visibleWordCountRef.current = targetWords.length;
            setVisibleTranslated(translated);
            return;
        }

        const sharedPrefix = countSharedWordPrefix(previousTargetWordsRef.current, targetWords);
        const seedWords = isFinal ? FINAL_SEED_WORDS : PARTIAL_SEED_WORDS;
        const stepWords = isFinal ? FINAL_STEP_WORDS : PARTIAL_STEP_WORDS;
        const delayMs = isFinal ? FINAL_REVEAL_DELAY_MS : PARTIAL_REVEAL_DELAY_MS;

        let nextVisibleCount: number;

        if (isFinal) {
            // Final cümle bir kez gelir ve sabittir; klasik seed+adım reveal kullan.
            nextVisibleCount = Math.min(visibleWordCountRef.current, sharedPrefix, targetWords.length);
            if (nextVisibleCount === 0) {
                nextVisibleCount = Math.min(seedWords, targetWords.length);
            }
        } else {
            // Partial modda görünen kelime sayısını ASLA azaltma: hızlı konuşmada
            // Whisper önceki kelimeleri yeniden yazınca metnin "silinip baştan
            // yazılması" hissi oluşuyordu. Ortak öneki koru, sadece yeni kelimeleri ekle.
            nextVisibleCount = Math.max(
                visibleWordCountRef.current,
                Math.min(sharedPrefix, targetWords.length)
            );
        }

        if (nextVisibleCount >= targetWords.length) {
            previousTargetWordsRef.current = targetWords;
            visibleWordCountRef.current = targetWords.length;
            setVisibleTranslated(targetWords.join(' '));
            return;
        }

        previousTargetWordsRef.current = targetWords;
        visibleWordCountRef.current = nextVisibleCount;
        setVisibleTranslated(targetWords.slice(0, nextVisibleCount).join(' '));

        revealTimerRef.current = window.setInterval(() => {
            nextVisibleCount = Math.min(targetWords.length, nextVisibleCount + stepWords);
            visibleWordCountRef.current = nextVisibleCount;
            setVisibleTranslated(targetWords.slice(0, nextVisibleCount).join(' '));

            if (nextVisibleCount >= targetWords.length && revealTimerRef.current !== null) {
                window.clearInterval(revealTimerRef.current);
                revealTimerRef.current = null;
            }
        }, delayMs);

        return () => {
            if (revealTimerRef.current !== null) {
                window.clearInterval(revealTimerRef.current);
                revealTimerRef.current = null;
            }
        };
    }, [isFinal, translated, wordByWord]);

    // Animation variants (Partial ise sıçrama yapma)
    const variants = {
        initial: {
            opacity: 0,
            y: 10,
            scale: 0.98,
        },
        animate: {
            opacity: 1,
            y: 0,
            scale: 1,
            transition: {
                duration: isFinal ? 0.3 : 0.1, // Quick update for partial
                ease: 'easeOut',
            },
        },
        exit: {
            opacity: 0,
            transition: { duration: 0.2 }
        }
    };

    // Partial style
    const partialStyle = isFinal ? {} : {
        fontStyle: 'italic',
        opacity: 0.8,
        filter: 'brightness(0.9)'
    };

    // Karaoke efekti: canlı (partial) modda son eklenen kelime parlak vurgulanır,
    // okunmuş kelimeler hafif soluk kalır — okurken göz cümlenin akışını takip eder.
    const visibleWords = splitWords(visibleTranslated);

    // Uzun cümlelerde taşmayı önlemek için yazı boyutunu kademeli küçült
    const effectiveFontSize =
        translated.length > 160
            ? Math.round(fontSize * 0.7)
            : translated.length > 100
                ? Math.round(fontSize * 0.85)
                : fontSize;
    const effectiveOriginalSize =
        original && original.length > 120
            ? Math.max(10, effectiveFontSize - 6)
            : Math.max(12, effectiveFontSize - 4);

    // Dynamic opacity
    const dynamicOpacity = Math.max(0.5, opacity - index * 0.15);
    return (
        <motion.div
            className="subtitle-overlay glass-card interactive-subtitle"
            variants={variants}
            initial={isFinal ? "initial" : false} // Partial direkt görünsün
            animate="animate"
            exit="exit"
            layout="position" // Layout animation
            style={{
                backgroundColor: `rgba(0, 0, 0, ${dynamicOpacity})`,
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
                opacity: 1,
                WebkitAppRegion: 'drag', // Enable drag
                userSelect: 'none',      // Prevent text selection
                ...partialStyle, // Apply partial style
            } as any} // TypeScript might complain about custom webkit prop
        >
            {/* Original text (English) */}
            {original && (
                <motion.div
                    className="subtitle-original"
                    style={{
                        fontSize: effectiveOriginalSize,
                        color: isFinal ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.6)'
                    }}
                >
                    {original} {isFinal ? '' : '...'}
                </motion.div>
            )}

            {/* Translated text (Turkish) */}
            <motion.div
                className="subtitle-translated"
                style={{
                    fontSize: effectiveFontSize,
                    color: isFinal ? '#ffffff' : 'rgba(255,255,255,0.9)'
                }}
            >
                {visibleWords.map((word, i) => (
                    <span
                        key={`${word}-${i}`}
                        className={!isFinal && i === visibleWords.length - 1 ? 'word-current' : ''}
                    >
                        {word}{' '}
                    </span>
                ))}
                {isFinal ? '' : '...'}
            </motion.div>
        </motion.div>
    );
}

export default SubtitleOverlay;
