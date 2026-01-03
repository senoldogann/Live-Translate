import { useEffect } from 'react';

interface UseInteractiveZonesProps {
    showControlBar: boolean;
    showHistory: boolean;
    bottomSectionRef: React.RefObject<HTMLDivElement>;
    restoreBtnRef: React.RefObject<HTMLButtonElement>;
    subtitleCount: number;
}

/**
 * Hook to manage interactive zones for Electron click-through
 */
export function useInteractiveZones({
    showControlBar,
    showHistory,
    bottomSectionRef,
    restoreBtnRef,
    subtitleCount
}: UseInteractiveZonesProps) {
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
    }, [showControlBar, showHistory, bottomSectionRef, restoreBtnRef, subtitleCount]);
}
