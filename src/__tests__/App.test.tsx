import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../App';

// Mock dependencies
vi.mock('../components/SubtitleOverlay', () => ({
    default: vi.fn(({ original, translated, isFinal }) => (
        <div data-testid="subtitle-overlay">
            <span data-testid="overlay-original">{original}</span>
            <span data-testid="overlay-translated">{translated}</span>
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
        onShowApiSettings,
        onShowUsageGuide,
    }: {
        onToggleListening: () => void;
        onShowHistory: () => void;
        onShowApiSettings: () => void;
        onShowUsageGuide: () => void;
    }) => (
        <div>
            <button data-testid="toggle-listening" onClick={onToggleListening}>
                Toggle Listening
            </button>
            <button data-testid="toggle-history" onClick={onShowHistory}>
                Toggle History
            </button>
            <button data-testid="open-settings" onClick={onShowApiSettings}>
                Open Settings
            </button>
            <button data-testid="open-usage-guide" onClick={onShowUsageGuide}>
                Open Usage Guide
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
    let mockOnApiSettingsUpdated: ((config: any) => void) | undefined;

    beforeEach(() => {
        mockOnTranscriptUpdate = vi.fn();
        mockOnEngineReady = vi.fn();
        mockOnHistoryWindowState = undefined;
        mockOnApiSettingsUpdated = undefined;

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
            openApiSettingsWindow: vi.fn(),
            saveApiSettingsWindow: vi.fn(),
            openUsageGuideWindow: vi.fn(),
            closeCurrentWindow: vi.fn(),
            getConfig: vi.fn().mockResolvedValue({ isSetupComplete: true }),
            saveConfig: vi.fn().mockResolvedValue(true),
            validateApiKeys: vi.fn().mockResolvedValue({
                ok: true,
                azureSpeech: { ok: true, message: 'ok' },
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
            onApiSettingsUpdated: vi.fn((cb) => {
                mockOnApiSettingsUpdated = cb;
                return vi.fn();
            }),
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
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

        await waitFor(() => {
            expect(screen.getByText('Merhaba Dünya')).toBeInTheDocument();
        }, { timeout: 1000 });

        // 3. Receive Final
        act(() => {
            mockOnTranscriptUpdate({
                original: 'Hello World.',
                translated: 'Merhaba Dünya.',
                isFinal: true,
                timestamp: 1002
            });
        });

        await waitFor(() => {
            expect(screen.getByText('Merhaba Dünya.')).toBeInTheDocument();
            expect(screen.getByTestId('final-status')).toHaveTextContent('FINAL');
        }, { timeout: 1000 });
    });

    it('syncs visible screenshot mode to Electron on initial mount', async () => {
        render(<App />);

        await screen.findByTestId('siri-wave', {}, { timeout: 1000 });

        expect(window.electronAPI.toggleStealth).toHaveBeenCalledWith(false);
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

    it('shows the new preview immediately on a single overlay line', async () => {
        render(<App />);

        await screen.findByTestId('siri-wave', {}, { timeout: 1000 });

        act(() => {
            mockOnTranscriptUpdate({
                original: 'Stable sentence',
                translated: 'Net cumle',
                isFinal: true,
                timestamp: 1100,
            });
        });

        await screen.findByTestId('subtitle-overlay', {}, { timeout: 1000 });
        expect(screen.getByTestId('overlay-translated')).toHaveTextContent('Net cumle');

        act(() => {
            mockOnTranscriptUpdate({
                original: 'Preview sentence',
                translated: 'Taslak cumle',
                isFinal: false,
                timestamp: 1101,
            });
        });

        await waitFor(() => {
            expect(screen.getByTestId('overlay-original')).toHaveTextContent('Preview sentence');
            expect(screen.getByTestId('overlay-translated')).toHaveTextContent('Taslak cumle');
        }, { timeout: 1000 });
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

    it('does not duplicate transcript history when the same final update arrives twice', async () => {
        render(<App />);

        await screen.findByTestId('siri-wave', {}, { timeout: 1000 });

        act(() => {
            screen.getByTestId('toggle-history').click();
        });

        act(() => {
            mockOnHistoryWindowState?.(true);
        });

        act(() => {
            mockOnTranscriptUpdate({
                original: 'Repeated sentence',
                translated: 'Tekrarlanan cumle',
                isFinal: false,
                timestamp: 2001,
            });
        });

        act(() => {
            mockOnTranscriptUpdate({
                original: 'Repeated sentence',
                translated: 'Tekrarlanan cumle',
                isFinal: true,
                timestamp: 2002,
            });
        });

        act(() => {
            mockOnTranscriptUpdate({
                original: 'Repeated sentence',
                translated: 'Tekrarlanan cumle',
                isFinal: true,
                timestamp: 2003,
            });
        });

        expect(window.electronAPI.updateHistoryWindow).toHaveBeenLastCalledWith([
            expect.objectContaining({
                original: 'Repeated sentence',
                translated: 'Tekrarlanan cumle',
                isFinal: true,
            }),
        ]);
    });

    it('opens native utility windows and keeps API settings state in sync', async () => {
        render(<App />);

        await screen.findByTestId('siri-wave', {}, { timeout: 1000 });

        act(() => {
            screen.getByTestId('open-settings').click();
        });

        expect(window.electronAPI.openApiSettingsWindow).toHaveBeenCalledWith({
            azureSpeechKey: '',
            azureSpeechRegion: '',
            deepgramKey: '',
            deeplKey: '',
        });

        act(() => {
            mockOnApiSettingsUpdated?.({
                isSetupComplete: true,
                engineType: 'cloud',
                azureSpeechKey: 'azure-key',
                azureSpeechRegion: 'francecentral',
                deepgramKey: 'dg-key',
                deeplKey: 'deepl-key',
            });
        });

        act(() => {
            screen.getByTestId('open-settings').click();
            screen.getByTestId('open-usage-guide').click();
        });

        expect(window.electronAPI.openApiSettingsWindow).toHaveBeenLastCalledWith({
            azureSpeechKey: 'azure-key',
            azureSpeechRegion: 'francecentral',
            deepgramKey: 'dg-key',
            deeplKey: 'deepl-key',
        });
        expect(window.electronAPI.openUsageGuideWindow).toHaveBeenCalledTimes(1);
    });
});
