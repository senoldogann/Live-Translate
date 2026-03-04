import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SubtitleOverlay from '../SubtitleOverlay';

describe('SubtitleOverlay', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders the full translation immediately when word-by-word mode is disabled', () => {
        render(
            <SubtitleOverlay
                translated="Merhaba guzel dunya"
                isFinal={true}
                wordByWord={false}
            />
        );

        expect(screen.getByText('Merhaba guzel dunya')).toBeInTheDocument();
    });

    it('reveals translated text in fast word groups when word-by-word mode is enabled', () => {
        vi.useFakeTimers();

        render(
            <SubtitleOverlay
                translated="Merhaba guzel dunya burada"
                isFinal={true}
                wordByWord={true}
            />
        );

        const translatedLine = screen.getByText('Merhaba guzel');
        expect(translatedLine).toBeInTheDocument();
        expect(translatedLine).not.toHaveTextContent('Merhaba guzel dunya burada');

        act(() => {
            vi.advanceTimersByTime(25);
        });

        expect(screen.getByText('Merhaba guzel dunya burada')).toBeInTheDocument();
    });

    it('shows the last stable translation as context while a live preview is updating', () => {
        render(
            <SubtitleOverlay
                original="Current preview"
                committedTranslated="Bir onceki net cumle"
                translated="Yeni taslak cumle"
                isFinal={false}
                wordByWord={false}
            />
        );

        expect(screen.getByText('Stabil')).toBeInTheDocument();
        expect(screen.getByText('Bir onceki net cumle')).toBeInTheDocument();
        expect(screen.getByText(/Yeni taslak cumle/)).toBeInTheDocument();
    });
});
