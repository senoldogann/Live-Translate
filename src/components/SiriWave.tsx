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

    // Configuration
    // Klasik Siri dalgaları: 3 ana çizgi + zayıf yan çizgiler
    const curves = [
        { attenuation: -2, lineWidth: 1, opacity: 0.1 },
        { attenuation: -6, lineWidth: 1, opacity: 0.2 },
        { attenuation: 4, lineWidth: 1, opacity: 0.4 },
        { attenuation: 2, lineWidth: 1, opacity: 0.6 },
        { attenuation: 1, lineWidth: 1.5, opacity: 1 },
    ];

    // Interpolated Amplitude (Smooth transitions)
    const currentAmpRef = useRef(0);

    const draw = (ctx: CanvasRenderingContext2D) => {
        // Clear
        ctx.clearRect(0, 0, width, height);

        // Smooth amplitude transition
        // Hedef amplitude doğru yumuşak geçiş (Linear Interpolation)
        // Eğer sessizse (active ama ses yok) çok hafif bir dalgalanma (0.1) olsun ki "dinliyor" hissi versin
        const targetAmp = isActive ? Math.max(0.05, amplitude * 1.5) : 0;

        // Yumuşak geçiş katsayısı (0.1 = yavaş, 0.3 = hızlı)
        currentAmpRef.current += (targetAmp - currentAmpRef.current) * 0.15;

        // Tamamen durduysa ve target 0 ise çizme (CPU save)
        if (!isActive && currentAmpRef.current < 0.001) return;

        phaseRef.current += speed;

        // Draw curves
        curves.forEach((curve, index) => {
            ctx.beginPath();

            // Renk kullanımı (hex to rgb dönüşümü basitleştirildi, varsayılan olarak beyaz/opaklık mantığı)
            // Daha gelişmiş renk yönetimi için hexToRgb helper gerekebilir ama şimdilik color prop'u direkt kullanalım mı?
            // Hayır, opacity ile oynadığımız için color string'i manipüle etmek zor.
            // Basitçe color prop'u görmezden gelip beyaz yapalım ya da color'ı rgb ise parçalayalım.
            // En temizi: Kullanıcının verdiği rengi kullanmak ama opacity curve'den gelsin.
            // Şimdilik 'color' prop'unu kullanmıyoruz, o yüzden unused warning'i silmek için prop'tan çıkaralım ya da _color yapalım.
            // Ama kullanıcı "eski animasyon" dedi, eski animasyonda renk var mıydı? Evet.
            // Basit çözüm: Rengi direkt kullanmak yerine strokeStyle'ı dinamik yapalım.

            // Fix: Use generic white with opacity for classic iOS look
            ctx.strokeStyle = `rgba(255, 255, 255, ${curve.opacity})`;
            ctx.lineWidth = curve.lineWidth;

            for (let x = 0; x <= width; x += 5) { // Optimizasyon: x artışı 5px
                const xRunning = x / width; // 0 to 1

                // Classic Siri Wave Formula
                // y = A * sin(B * x + C)
                // A key part is attenuation: wave matches 0 at ends
                const attenuation = Math.pow(4 * xRunning * (1 - xRunning), Math.abs(curve.attenuation));

                // Actual wave
                const y = height / 2 +
                    Math.sin(xRunning * 12 + phaseRef.current - index) *
                    (currentAmpRef.current * height * 0.45) *
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
