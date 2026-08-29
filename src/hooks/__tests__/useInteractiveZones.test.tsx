import { useRef } from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useInteractiveZones } from '../useInteractiveZones';

function HookHarness({
    showControlBar,
    showHistory,
    fullWindowInteractive = false,
    subtitleCount = 0,
}: {
    showControlBar: boolean;
    showHistory: boolean;
    fullWindowInteractive?: boolean;
    subtitleCount?: number;
}) {
    const bottomSectionRef = useRef<HTMLDivElement>(null);
    const restoreBtnRef = useRef<HTMLButtonElement>(null);

    useInteractiveZones({
        showControlBar,
        showHistory,
        fullWindowInteractive,
        bottomSectionRef,
        restoreBtnRef,
        subtitleCount,
    });

    return (
        <div>
            <div ref={bottomSectionRef} data-rect="50,100,400,40">
                bar
            </div>
            <button ref={restoreBtnRef} data-rect="20,20,30,30">
                restore
            </button>
            <div className="interactive-subtitle" data-rect="100,200,300,60">
                subtitle
            </div>
            <div className="interactive-subtitle" data-rect="100,300,300,60">
                subtitle2
            </div>
        </div>
    );
}

describe('useInteractiveZones', () => {
    const updateSpy = vi.fn();

    beforeEach(() => {
        updateSpy.mockClear();
        window.electronAPI = {
            updateInteractiveZones: updateSpy,
        } as any;

        // jsdom'da layout yok — getBoundingClientRect her zaman 0 döner.
        // Elementlerin gerçek konumunu data-rect attribute'undan okuyan stub kullan.
        HTMLElement.prototype.getBoundingClientRect = function () {
            const rect = this.getAttribute('data-rect');
            if (rect) {
                const [left, top, width, height] = rect.split(',').map(Number);
                return { left, top, width, height, right: left + width, bottom: top + height } as DOMRect;
            }
            return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 } as DOMRect;
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it('publishes a full-window interactive zone while a modal is open', async () => {
        render(<HookHarness fullWindowInteractive={true} showControlBar={true} showHistory={false} />);

        await waitFor(() => {
            expect(updateSpy).toHaveBeenCalledWith([
                { x: 0, y: 0, width: 9999, height: 9999 },
            ]);
        });
    });

    it('publishes the control bar zone when the bar is visible', async () => {
        render(<HookHarness showControlBar={true} showHistory={false} subtitleCount={2} />);

        await waitFor(() => {
            const zones = updateSpy.mock.calls[0][0];
            // Control bar (50,100,400,40) + 2 subtitles
            expect(zones).toEqual(expect.arrayContaining([
                { x: 50, y: 100, width: 400, height: 40 },
            ]));
        });
    });

    it('publishes the restore button zone when the bar is hidden', async () => {
        render(<HookHarness showControlBar={false} showHistory={false} subtitleCount={0} />);

        await waitFor(() => {
            const zones = updateSpy.mock.calls[0][0];
            expect(zones).toEqual(expect.arrayContaining([
                { x: 20, y: 20, width: 30, height: 30 },
            ]));
            // Control bar should NOT be included
            expect(zones).not.toEqual(expect.arrayContaining([
                { x: 50, y: 100, width: 400, height: 40 },
            ]));
        });
    });

    it('includes subtitle zones for each interactive subtitle element', async () => {
        render(<HookHarness showControlBar={true} showHistory={false} subtitleCount={2} />);

        await waitFor(() => {
            const zones = updateSpy.mock.calls[0][0];
            expect(zones).toEqual(expect.arrayContaining([
                { x: 100, y: 200, width: 300, height: 60 },
                { x: 100, y: 300, width: 300, height: 60 },
            ]));
        });
    });

    it('makes the whole window interactive when history is open', async () => {
        render(<HookHarness showControlBar={false} showHistory={true} subtitleCount={0} />);

        await waitFor(() => {
            const zones = updateSpy.mock.calls[0][0];
            expect(zones).toEqual(expect.arrayContaining([
                { x: 0, y: 0, width: 9999, height: 9999 },
            ]));
        });
    });

    it('does nothing when electronAPI is missing', () => {
        delete (window as any).electronAPI;
        const { unmount } = render(<HookHarness showControlBar={true} showHistory={false} />);
        unmount();
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('re-publishes zones after state changes', async () => {
        const { rerender } = render(<HookHarness showControlBar={true} showHistory={false} />);
        await waitFor(() => expect(updateSpy).toHaveBeenCalled());

        const callsBefore = updateSpy.mock.calls.length;
        act(() => {
            rerender(<HookHarness showControlBar={false} showHistory={false} />);
        });

        await waitFor(() => {
            expect(updateSpy.mock.calls.length).toBeGreaterThan(callsBefore);
        });
    });
});
