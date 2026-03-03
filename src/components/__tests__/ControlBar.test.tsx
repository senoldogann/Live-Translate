import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ControlBar from '../ControlBar';

describe('ControlBar Component', () => {
    // Mock callbacks
    const props = {
        isListening: true,
        isStealthMode: false,
        showOriginal: true,
        opacity: 0.9,
        fontSize: 18,
        onToggleListening: vi.fn(),
        onToggleStealth: vi.fn(),
        onToggleOriginal: vi.fn(),
        onOpacityChange: vi.fn(),
        onFontSizeChange: vi.fn(),
        onRestartEngine: vi.fn(),
        onShowHistory: vi.fn(),
        onToggleVisible: vi.fn(),
        onQuit: vi.fn(),
        isStreaming: false,
        onToggleStreaming: vi.fn(),
        isWordByWord: true,
        onToggleWordByWord: vi.fn(),
        language: 'en' as const,
        onLanguageChange: vi.fn(),
        engineType: 'local' as const,
        onEngineTypeChange: vi.fn(),
        onShowApiSettings: vi.fn()
    };

    it('renders correctly with default props', () => {
        render(<ControlBar {...props} />);

        // Assert mic button exists (listening state)
        expect(screen.getByRole('button', { name: /durakla/i })).toBeInTheDocument();
        // Assert stealth button
        expect(screen.getByRole('button', { name: /gizli moda dön/i })).toBeInTheDocument();
    });

    it('toggles listening state', () => {
        render(<ControlBar {...props} isListening={false} />);
        const btn = screen.getByRole('button', { name: /dinle/i });
        fireEvent.click(btn);
        expect(props.onToggleListening).toHaveBeenCalledTimes(1);
    });

    it('toggles word-by-word render mode', () => {
        render(<ControlBar {...props} isWordByWord={false} />);
        const btn = screen.getByRole('button', { name: /akıcı yazım kapalı/i });
        fireEvent.click(btn);
        expect(props.onToggleWordByWord).toHaveBeenCalledTimes(1);
    });

    it('changes opacity slider', () => {
        render(<ControlBar {...props} />);
        // Find slider by tooltip or class? Using container logic is tricky in testing-library with custom sliders.
        // Let's rely on finding by input type range
        const sliders = screen.getAllByRole('slider');
        const opacitySlider = sliders[0]; // First one is opacity

        fireEvent.change(opacitySlider, { target: { value: '0.5' } });
        expect(props.onOpacityChange).toHaveBeenCalledWith(0.5);
    });

    it('calls quit', () => {
        render(<ControlBar {...props} />);
        const quitBtn = screen.getByRole('button', { name: /kapat/i });
        fireEvent.click(quitBtn);
        expect(props.onQuit).toHaveBeenCalledTimes(1);
    });
});
