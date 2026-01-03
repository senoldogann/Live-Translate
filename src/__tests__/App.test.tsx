import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../App';

// Mock dependencies
vi.mock('../components/SubtitleOverlay', () => ({
    default: vi.fn(({ original, translated, isFinal }) => (
        <div data-testid="subtitle-overlay">
            <span>{original}</span>
            <span>{translated}</span>
            <span data-testid="final-status">{isFinal ? 'FINAL' : 'PARTIAL'}</span>
        </div>
    ))
}));

// Mock SiriWave to avoid canvas issues in jsdom
vi.mock('../components/SiriWave', () => ({
    default: () => <div data-testid="siri-wave" />
}));

describe('App Component', () => {
    let mockOnTranscriptUpdate: any;

    beforeEach(() => {
        mockOnTranscriptUpdate = vi.fn();

        // Mock window.electronAPI
        window.electronAPI = {
            onTranscriptUpdate: (cb) => {
                mockOnTranscriptUpdate = cb;
                return vi.fn();
            },
            onAudioLevel: () => {
                return vi.fn();
            },
            updateInteractiveZones: vi.fn(),
            setWindowHeight: vi.fn(),
            toggleStealth: vi.fn(),
            setOpacity: vi.fn(),
            setStreamingMode: vi.fn(),
            getAppInfo: vi.fn().mockResolvedValue({} as any),
            moveWindow: vi.fn(),
            setIgnoreMouseEvents: vi.fn(),
            restartEngine: vi.fn(),
            quitApp: vi.fn(),
            forceFocus: vi.fn()
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders and handles partial -> final transcript flow without flickering', () => {
        render(<App />);

        // 1. Receive Partial
        act(() => {
            mockOnTranscriptUpdate({
                original: 'Hello',
                translated: 'Merhaba',
                isFinal: false,
                timestamp: 1000
            });
        });

        expect(screen.getByText('Merhaba')).toBeInTheDocument();
        expect(screen.getByTestId('final-status')).toHaveTextContent('PARTIAL');

        // 2. Receive Update to Partial
        act(() => {
            mockOnTranscriptUpdate({
                original: 'Hello World',
                translated: 'Merhaba Dünya',
                isFinal: false,
                timestamp: 1001
            });
        });

        expect(screen.getByText('Merhaba Dünya')).toBeInTheDocument();

        // 3. Receive Final
        act(() => {
            mockOnTranscriptUpdate({
                original: 'Hello World.',
                translated: 'Merhaba Dünya.',
                isFinal: true,
                timestamp: 1002
            });
        });

        expect(screen.getByText('Merhaba Dünya.')).toBeInTheDocument();
        expect(screen.getByTestId('final-status')).toHaveTextContent('FINAL');
    });
});
