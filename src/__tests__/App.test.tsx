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
    default: ({
        onToggleListening,
        onShowHistory,
    }: {
        onToggleListening: () => void;
        onShowHistory: () => void;
    }) => (
        <div>
            <button data-testid="toggle-listening" onClick={onToggleListening}>
                Toggle Listening
            </button>
            <button data-testid="toggle-history" onClick={onShowHistory}>
                Toggle History
            </button>
            <div data-testid="control-bar" />
        </div>
    )
}));

// Mock SetupWizard to avoid setup flow in tests
vi.mock('../components/SetupWizard', () => ({
    default: () => <div data-testid="setup-wizard" />
}));

// Mock useInteractiveZones hook
vi.mock('../hooks/useInteractiveZones', () => ({
    useInteractiveZones: () => { }
}));

describe('App Component', () => {
    let mockOnTranscriptUpdate: (data: any) => void;
    let mockOnEngineReady: () => void;
    let mockOnHistoryWindowState: ((isOpen: boolean) => void) | undefined;

    beforeEach(() => {
        mockOnTranscriptUpdate = vi.fn();
        mockOnEngineReady = vi.fn();
        mockOnHistoryWindowState = undefined;

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
            setListening: vi.fn(),
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
            updateHistoryWindow: vi.fn(),
            getConfig: vi.fn().mockResolvedValue({ isSetupComplete: true }),
            saveConfig: vi.fn().mockResolvedValue(true),
            validateApiKeys: vi.fn().mockResolvedValue({
                ok: true,
                deepgram: { ok: true, message: 'ok' },
                deepl: { ok: true, message: 'ok' },
            }),
            checkBlackhole: vi.fn().mockResolvedValue(true),
            openUrl: vi.fn(),
            onEngineReady: vi.fn((cb) => {
                mockOnEngineReady = cb;
                return vi.fn();
            }),
            onShowControlBar: vi.fn().mockReturnValue(vi.fn()),
            onEngineLog: vi.fn().mockReturnValue(vi.fn()),
            onHistoryWindowState: vi.fn((cb) => {
                mockOnHistoryWindowState = cb;
                return vi.fn();
            }),
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

    it('replays current engine settings after the backend restarts', async () => {
        render(<App />);

        await screen.findByTestId('siri-wave', {}, { timeout: 1000 });

        act(() => {
            mockOnEngineReady();
        });

        expect(window.electronAPI.setLanguage).toHaveBeenCalledWith('en');
        expect(window.electronAPI.setStreamingMode).toHaveBeenCalledWith(false);
        expect(window.electronAPI.setEngineType).toHaveBeenCalledWith('local');
        expect(window.electronAPI.toggleStealth).toHaveBeenCalledWith(false);
    });

    it('sends a real listening command when pause is toggled', async () => {
        render(<App />);

        await screen.findByTestId('siri-wave', {}, { timeout: 1000 });

        act(() => {
            screen.getByTestId('toggle-listening').click();
        });

        expect(window.electronAPI.setListening).toHaveBeenCalledWith(false);
    });

    it('opens the native history window and streams live partial plus final updates into it', async () => {
        render(<App />);

        await screen.findByTestId('siri-wave', {}, { timeout: 1000 });

        act(() => {
            screen.getByTestId('toggle-history').click();
        });

        expect(window.electronAPI.openHistoryWindow).toHaveBeenCalledWith([]);

        act(() => {
            mockOnHistoryWindowState?.(true);
        });

        act(() => {
            mockOnTranscriptUpdate({
                original: 'Live sentence',
                translated: 'Canli cumle (canli)',
                isFinal: false,
                timestamp: 1003,
            });
        });

        expect(window.electronAPI.updateHistoryWindow).toHaveBeenLastCalledWith([
            expect.objectContaining({
                original: 'Live sentence',
                translated: 'Canli cumle (canli)',
                isFinal: false,
            }),
        ]);

        act(() => {
            mockOnTranscriptUpdate({
                original: 'Live sentence',
                translated: 'Canli cumle',
                isFinal: true,
                timestamp: 1004,
            });
        });

        expect(window.electronAPI.updateHistoryWindow).toHaveBeenLastCalledWith([
            expect.objectContaining({
                original: 'Live sentence',
                translated: 'Canli cumle',
                isFinal: true,
            }),
        ]);
    });
});
