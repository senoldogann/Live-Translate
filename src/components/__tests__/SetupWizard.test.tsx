import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SetupWizard from '../SetupWizard';

function mockDevices(hasBlackhole: boolean) {
    const devices = [
        { kind: 'audioinput', label: 'MacBook Pro Microphone', groupId: 'mic' },
        ...(hasBlackhole
            ? [{ kind: 'audiooutput', label: 'BlackHole 2ch', groupId: 'blackhole-group' }]
            : []),
    ];
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { enumerateDevices: vi.fn().mockResolvedValue(devices) },
    });
}

/** Adım 1 (hoş geldin) → adım 2 (ses) geçişi: 'Next'/'İleri' tıkla ve bekle. */
async function gotoStep2() {
    await act(async () => {
        fireEvent.click(screen.getByText(/Next|İleri/i));
    });
    // checkBh async bitince durum render edilir; çağıran test waitFor ile bekler
}

describe('SetupWizard', () => {
    const onComplete = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        window.electronAPI = {
            checkBlackhole: vi.fn().mockResolvedValue(false),
            saveConfig: vi.fn().mockResolvedValue(true),
            openUrl: vi.fn(),
        } as any;
        mockDevices(false);
    });

    it('starts on the welcome step with language selection', () => {
        render(<SetupWizard onComplete={onComplete} />);
        expect(screen.getByText(/Welcome/i)).toBeInTheDocument();
        expect(screen.getByText(/English/i)).toBeInTheDocument();
        expect(screen.getByText('Türkçe')).toBeInTheDocument();
    });

    it('switches UI language to Turkish when selected', async () => {
        render(<SetupWizard onComplete={onComplete} />);
        fireEvent.click(screen.getByText('Türkçe'));
        await act(async () => {
            fireEvent.click(screen.getByText('İleri'));
        });
        await waitFor(() => {
            expect(screen.getByText(/Sistem Sesi Kurulumu/i)).toBeInTheDocument();
        });
    });

    it('shows BlackHole instructions when the driver is missing', async () => {
        render(<SetupWizard onComplete={onComplete} />);
        await gotoStep2();

        await waitFor(() => {
            expect(screen.getByText(/BlackHole 2ch Not Found/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/Download \(Free\)/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /check again/i })).toBeInTheDocument();
    });

    it('re-checks BlackHole when the button is pressed', async () => {
        render(<SetupWizard onComplete={onComplete} />);
        await gotoStep2();

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /check again/i })).toBeInTheDocument();
        });

        mockDevices(true);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /check again/i }));
        });

        await waitFor(() => {
            expect(screen.getByText(/BlackHole 2ch Found/i)).toBeInTheDocument();
        });
    });

    it('advances to engine mode after BlackHole is found', async () => {
        mockDevices(true);
        render(<SetupWizard onComplete={onComplete} />);
        await gotoStep2();

        await waitFor(() => {
            expect(screen.getByText(/BlackHole 2ch Found/i)).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByText(/Next/i));
        });
        await waitFor(() => {
            expect(screen.getByText(/Engine Mode/i)).toBeInTheDocument();
        });
    });

    it('selects cloud mode and keeps model section hidden', async () => {
        mockDevices(true);
        render(<SetupWizard onComplete={onComplete} />);
        await gotoStep2();

        await waitFor(() => {
            expect(screen.getByText(/BlackHole 2ch Found/i)).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByText(/Next/i));
        });
        await waitFor(() => {
            expect(screen.getByText(/Engine Mode/i)).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText(/Cloud \(Azure\)/i));
        expect(screen.queryByText(/Whisper Model Size/i)).not.toBeInTheDocument();

        fireEvent.click(screen.getByText(/Local \(Privacy\)/i));
        expect(screen.getByText(/Whisper Model Size/i)).toBeInTheDocument();
    });

    it('selects a Whisper model', async () => {
        mockDevices(true);
        render(<SetupWizard onComplete={onComplete} />);
        await gotoStep2();

        await waitFor(() => {
            expect(screen.getByText(/BlackHole 2ch Found/i)).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByText(/Next/i));
        });
        await waitFor(() => {
            expect(screen.getByText(/Whisper Model Size/i)).toBeInTheDocument();
        });
        await act(async () => {
            fireEvent.click(screen.getByText(/Tiny \(fastest\)/i));
        });
        expect(screen.getByText(/Tiny \(fastest\)/i).className).toContain('active');
    });

    it('finishes and saves the configuration', async () => {
        mockDevices(true);
        render(<SetupWizard onComplete={onComplete} />);
        await gotoStep2();

        await waitFor(() => {
            expect(screen.getByText(/BlackHole 2ch Found/i)).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByText(/Next/i)); // step 3
        });
        await act(async () => {
            fireEvent.click(screen.getByText(/Next/i)); // step 4
        });

        await waitFor(() => {
            expect(screen.getByText(/Setup Complete!/i)).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByText(/Finish & Start/i));
        });

        await waitFor(() => {
            expect(window.electronAPI.saveConfig).toHaveBeenCalledWith(
                expect.objectContaining({
                    isSetupComplete: true,
                    engineType: 'local',
                    whisperModel: 'small',
                    hasCloudProvider: false,
                })
            );
            expect(onComplete).toHaveBeenCalledTimes(1);
        });
    });
});
