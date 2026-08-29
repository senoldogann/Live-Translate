import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TranscriptHistory from '../TranscriptHistory';

const entries = [
    {
        id: 'a',
        original: 'Hello world',
        translated: 'Merhaba dünya',
        timestamp: 1_700_000_000_000,
        isFinal: true,
    },
    {
        id: 'b',
        original: 'How are you',
        translated: 'Nasılsın',
        timestamp: 1_700_000_060_000,
        isFinal: false,
    },
];

describe('TranscriptHistory', () => {
    let onClose: () => void;

    beforeEach(() => {
        onClose = vi.fn();
    });

    it('does not render anything when closed', () => {
        const { container } = render(
            <TranscriptHistory isOpen={false} transcripts={entries} onClose={onClose} />
        );
        expect(container.querySelector('.transcript-history-panel')).toBeNull();
    });

    it('renders the transcript list when open', () => {
        render(<TranscriptHistory isOpen={true} transcripts={entries} onClose={onClose} />);
        expect(screen.getByText('Merhaba dünya')).toBeInTheDocument();
        expect(screen.getByText(/Nasılsın/)).toBeInTheDocument();
    });

    it('marks partial entries and appends ellipsis', () => {
        render(<TranscriptHistory isOpen={true} transcripts={entries} onClose={onClose} />);
        const partialItem = screen.getByText(/Nasılsın/).closest('.transcript-item');
        expect(partialItem).toHaveClass('is-partial');
        expect(screen.getByText(/How are you/)).toHaveTextContent('...');
    });

    it('shows empty state when there are no transcripts', () => {
        render(<TranscriptHistory isOpen={true} transcripts={[]} onClose={onClose} />);
        expect(screen.getByText(/Henüz konuşma kaydı yok/)).toBeInTheDocument();
    });

    it('closes when the close button is clicked', () => {
        render(<TranscriptHistory isOpen={true} transcripts={entries} onClose={onClose} />);
        fireEvent.click(screen.getByTitle('Kapat'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes when clicking the backdrop', () => {
        render(<TranscriptHistory isOpen={true} transcripts={entries} onClose={onClose} />);
        fireEvent.click(screen.getByText('Merhaba dünya').closest('.transcript-history-overlay')!);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('formats timestamps as HH:MM', () => {
        render(<TranscriptHistory isOpen={true} transcripts={[entries[0]]} onClose={onClose} />);
        const date = new Date(1_700_000_000_000);
        const expected = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        expect(screen.getByText(expected)).toBeInTheDocument();
    });
});
