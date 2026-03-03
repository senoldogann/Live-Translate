import { useRef } from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useInteractiveZones } from '../useInteractiveZones';

function HookHarness({ fullWindowInteractive }: { fullWindowInteractive: boolean }) {
    const bottomSectionRef = useRef<HTMLDivElement>(null);
    const restoreBtnRef = useRef<HTMLButtonElement>(null);

    useInteractiveZones({
        showControlBar: true,
        showHistory: false,
        fullWindowInteractive,
        bottomSectionRef,
        restoreBtnRef,
        subtitleCount: 0,
    });

    return (
        <div>
            <div ref={bottomSectionRef}>bar</div>
            <button ref={restoreBtnRef}>restore</button>
        </div>
    );
}

describe('useInteractiveZones', () => {
    beforeEach(() => {
        window.electronAPI = {
            updateInteractiveZones: vi.fn(),
        } as any;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('publishes a full-window interactive zone while a modal is open', async () => {
        render(<HookHarness fullWindowInteractive={true} />);

        await waitFor(() => {
            expect(window.electronAPI.updateInteractiveZones).toHaveBeenCalledWith([
                { x: 0, y: 0, width: 9999, height: 9999 },
            ]);
        });
    });
});
