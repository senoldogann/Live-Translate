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

// Mock ControlBar to simplify testing
vi.mock('../components/ControlBar', () => ({
    default: () => <div data-testid="control-bar" />
}));

// Mock SetupWizard to avoid setup flow in tests
vi.mock('../components/SetupWizard', () => ({
    default: () => <div data-testid="setup-wizard" />
}));

// Mock useInteractiveZones hook
vi.mock('../hooks/useInteractiveZones', () => ({
    useInteractiveZones: () => {}
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
            forceFocus: vi.fn(),
            setLanguage: vi.fn(),
            setEngineType: vi.fn(),
            openHistoryWindow: vi.fn(),
            getConfig: vi.fn().mockResolvedValue({ isSetupComplete: true }),
            saveConfig: vi.fn().mockResolvedValue(true),
            checkBlackhole: vi.fn().mockResolvedValue(true),
            openUrl: vi.fn()
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders and handles partial -> final transcript flow without flickering', async () => {
        render(<App />);

        // Wait for app to load (should show SiriWave initially)
        await screen.findByTestId('siri-wave', {}, { timeout: 1000 });

        // 1. Receive Partial - this should trigger speech active state
        act(() => {
            mockOnTranscriptUpdate({
                original: 'Hello',
                translated: 'Merhaba',
                isFinal: false,
                timestamp: 1000
            });
        });

        // Now subtitle overlay should be visible (wait for state update)
        await screen.findByTestId('subtitle-overlay', {}, { timeout: 1000 });
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
