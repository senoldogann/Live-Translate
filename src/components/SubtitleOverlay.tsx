/**
 * Subtitle Overlay Component
 * 
 * Glassmorphism tasarımlı altyazı gösterimi.
 * Fade-in animasyonu ve dinamik font boyutu.
 */

import { motion } from 'framer-motion';

interface SubtitleOverlayProps {
    original?: string;
    translated: string;
    fontSize?: number;
    opacity?: number;
    index?: number;
    isFinal?: boolean; // Added
}

function SubtitleOverlay({
    original,
    translated,
    fontSize = 18,
    opacity = 0.9,
    index = 0,
    isFinal = true,
}: SubtitleOverlayProps) {
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

    // Dynamic opacity
    const dynamicOpacity = Math.max(0.5, opacity - index * 0.15);

    return (
        <motion.div
            className="subtitle-overlay glass-card interactive-subtitle" // Added marker class
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
                        fontSize: Math.max(12, fontSize - 4),
                        color: isFinal ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.6)'
                    }}
                >
                    {original} {isFinal ? '' : '...'}
                </motion.div>
            )}

            {/* Translated text (Turkish) */}
            <motion.div
                className="subtitle-translated"
                key={translated} // Key change triggers animation on text change? No, let's keep it stable
                style={{
                    fontSize,
                    color: isFinal ? '#ffffff' : 'rgba(255,255,255,0.9)'
                }}
            >
                {translated} {isFinal ? '' : '...'}
            </motion.div>
        </motion.div>
    );
}

export default SubtitleOverlay;
