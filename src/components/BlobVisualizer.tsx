import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface BlobVisualizerProps {
    isActive: boolean;
}

const BlobVisualizer = ({ isActive }: BlobVisualizerProps) => {
    const [audioLevel, setAudioLevel] = useState(0);

    useEffect(() => {
        if (!window.electronAPI) return;

        const unsubscribe = window.electronAPI.onAudioLevel((level: number) => {
            // Smooth damping for less jittery movement
            setAudioLevel(prev => prev * 0.7 + level * 0.3);
        });

        return () => unsubscribe();
    }, []);

    // Base scale when active vs inactive
    const baseScale = isActive ? 1.0 : 0.5;

    // Dynamic scale based on audio
    // audioLevel is 0.0 - 1.0. We want a noticeable punch.
    const dynamicScale = baseScale + (audioLevel * 1.5);

    // Opacity based on activity
    const opacity = isActive ? 0.8 : 0.2;

    return (
        <div className="blob-container" style={{
            position: 'absolute',
            bottom: '50px',
            left: '50%',
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '200px',
            height: '200px',
            zIndex: -1,
        }}>
            {/* Core Blob */}
            <motion.div
                animate={{
                    scale: dynamicScale,
                    opacity: opacity,
                }}
                transition={{
                    type: "spring",
                    damping: 10,
                    stiffness: 200,
                    mass: 0.5
                }}
                style={{
                    width: '60px',
                    height: '60px',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.9), rgba(100, 200, 255, 0.6))',
                    boxShadow: '0 0 20px rgba(100, 200, 255, 0.6), 0 0 60px rgba(100, 200, 255, 0.3)',
                    filter: 'blur(1px)'
                }}
            />

            {/* Outer Aura (Delayed/Echo effect) */}
            <motion.div
                animate={{
                    scale: dynamicScale * 1.2,
                    opacity: opacity * 0.5,
                }}
                transition={{
                    type: "spring",
                    damping: 15,
                    stiffness: 100,
                    mass: 0.8 // Heavier/Slower
                }}
                style={{
                    position: 'absolute',
                    width: '60px',
                    height: '60px',
                    borderRadius: '50%',
                    border: '2px solid rgba(150, 220, 255, 0.4)',
                    boxShadow: '0 0 30px rgba(150, 220, 255, 0.2)',
                }}
            />
        </div>
    );
};

export default BlobVisualizer;
