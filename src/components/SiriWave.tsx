/**
 * Classic Siri Wave (iOS 9 Style)
 * 
 * HTML5 Canvas tabanlı, yüksek performanslı ve 'audio-reactive' dalga animasyonu.
 * Bağımlılık gerektirmez.
 */

import React, { useRef, useEffect } from 'react';

interface SiriWaveProps {
    isActive?: boolean; // Dinlemeye devam edip etmediği
    amplitude?: number; // 0 ile 1 arası (Ses seviyesi)
    width?: number;     // Genişlik
    height?: number;    // Yükseklik
    speed?: number;     // Hız çarpanı
    color?: string;     // Ana renk (Opsiyonel, klasik modda gradient kullanılır)
}

const SiriWave: React.FC<SiriWaveProps> = ({
    isActive = false,
    amplitude = 1,
    width = 640,
    height = 60,
    speed = 0.05,
    color: _color = '#fff' // Unused but kept for interface compatibility
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const phaseRef = useRef(0);
    const animationFrameRef = useRef<number>();

    // Configuration for "Intertwined" Multi-Line Wave
    // 6 curves with symmetrical phase offsets to create the "braided" look
    const curves = [
        { opacity: 1, phase: 0 },
        { opacity: 0.8, phase: 0.5 },
        { opacity: 0.8, phase: -0.5 },
        { opacity: 0.6, phase: 1.0 },
        { opacity: 0.6, phase: -1.0 },
        { opacity: 0.4, phase: 1.5 },
        { opacity: 0.4, phase: -1.5 },
    ];

    // Interpolated Amplitude (Smooth transitions)
    const currentAmpRef = useRef(0);

    const draw = (ctx: CanvasRenderingContext2D) => {
        // Clear
        ctx.clearRect(0, 0, width, height);

        // Smooth amplitude transition
        const targetAmp = isActive ? Math.max(0.1, amplitude * 1.8) : 0;
        currentAmpRef.current += (targetAmp - currentAmpRef.current) * 0.15;

        if (!isActive && currentAmpRef.current < 0.001) return;

        phaseRef.current += speed;

        curves.forEach((curve) => {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(255, 255, 255, ${curve.opacity})`;
            ctx.lineWidth = 1.5;

            // Draw sine wave
            for (let x = 0; x <= width; x += 2) {
                const xRunning = x / width; // 0 to 1

                // Attenuation: Fade out at edges (Parabolic envelope)
                // 4 * x * (1-x) creates a parabola peaking at 0.5
                const attenuation = Math.pow(4 * xRunning * (1 - xRunning), 2);

                // Wave formula: 
                // x * frequency + moving_phase + fixed_curve_phase
                const y = height / 2 +
                    Math.sin(xRunning * 10 + phaseRef.current + curve.phase) *
                    (currentAmpRef.current * height * 0.4) *
                    attenuation;

                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        });
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // High DPI Support
        const dpr = window.devicePixelRatio || 1;
        // Canvas'ın internal boyutunu scale et
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
        // Canvas'ın CSS boyutunu set et
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        const loop = () => {
            draw(ctx);
            animationFrameRef.current = requestAnimationFrame(loop);
        };

        loop();

        return () => {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, [width, height, speed, isActive]); // amplitude removed from dependency array, handled via ref

    return (
        <div style={{
            display: isActive ? 'flex' : 'none', // Sadece aktifken göster (yer kaplamasın mı? Hayır, animasyon fade out yapıyor)
            // Fade out için opacity transition daha iyi olurdu ama şimdilik direct logic
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none', // Tıklamayı engelleme
            marginBottom: '10px'
        }}>
            <canvas ref={canvasRef} />
        </div>
    );
};

export default SiriWave;
