import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SubtitleOverlay from '../SubtitleOverlay';

// Kelime kelime render edilen span'ler yüzünden metin parçalara bölünür;
// bu yüzden tam metin yerine element textContent'ine bakan matcher kullanılır.
function byText(expected: string) {
    return (_content: string, node: Element | null) =>
        !!node
        && node.classList.contains('subtitle-translated')
        && node.textContent !== null
        && node.textContent.replace(/\s+/g, ' ').trim().startsWith(expected);
}

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

        expect(screen.getByText(byText('Merhaba guzel dunya'))).toBeInTheDocument();
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

        const translatedLine = screen.getByText(byText('Merhaba guzel'));
        expect(translatedLine).toBeInTheDocument();
        expect(screen.queryByText(byText('Merhaba guzel dunya burada'))).not.toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(25);
        });

        expect(screen.getByText(byText('Merhaba guzel dunya burada'))).toBeInTheDocument();
    });

    it('renders only the active preview line without a separate stable row', () => {
        render(
            <SubtitleOverlay
                original="Current preview"
                translated="Yeni taslak cumle"
                isFinal={false}
                wordByWord={false}
            />
        );

        expect(screen.getByText(byText('Yeni taslak cumle'))).toBeInTheDocument();
        expect(screen.queryByText('Stabil')).not.toBeInTheDocument();
    });
});
