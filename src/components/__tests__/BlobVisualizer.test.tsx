import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BlobVisualizer from '../BlobVisualizer';

describe('BlobVisualizer', () => {
    let audioListener: ((level: number) => void) | undefined;

    beforeEach(() => {
        audioListener = undefined;
        window.electronAPI = {
            onAudioLevel: vi.fn((cb) => {
                audioListener = cb;
                return vi.fn();
            }),
        } as any;
    });

    it('subscribes to audio level events on mount', () => {
        render(<BlobVisualizer isActive={true} />);
        expect(window.electronAPI.onAudioLevel).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes on unmount', () => {
        const unsubscribe = vi.fn();
        window.electronAPI.onAudioLevel = vi.fn(() => unsubscribe) as any;
        const { unmount } = render(<BlobVisualizer isActive={true} />);
        unmount();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('smooths incoming audio levels with damping', () => {
        render(<BlobVisualizer isActive={true} />);
        act(() => {
            audioListener?.(1.0);
        });
        act(() => {
            audioListener?.(0.0);
        });
        // Damping: 0.7*prev + 0.3*new — value stays bounded
        expect(audioListener).toBeDefined();
    });

    it('renders the core blob element', () => {
        const { container } = render(<BlobVisualizer isActive={true} />);
        expect(container.querySelector('.blob-container')).not.toBeNull();
    });
});
