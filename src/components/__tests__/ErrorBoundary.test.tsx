import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ErrorBoundary from '../ErrorBoundary';

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
    if (shouldThrow) {
        throw new Error('boom');
    }
    return <div>healthy child</div>;
}

describe('ErrorBoundary', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

    beforeEach(() => {
        consoleSpy.mockClear();
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { reload: vi.fn() },
        });
        window.electronAPI = {
            restartEngine: vi.fn(),
            quitApp: vi.fn(),
        } as any;
    });

    it('renders children when no error occurs', () => {
        render(
            <ErrorBoundary>
                <Bomb shouldThrow={false} />
            </ErrorBoundary>
        );
        expect(screen.getByText('healthy child')).toBeInTheDocument();
    });

    it('shows the error UI when a child throws', () => {
        render(
            <ErrorBoundary>
                <Bomb shouldThrow={true} />
            </ErrorBoundary>
        );
        expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
        expect(screen.getByText('boom')).toBeInTheDocument();
    });

    it('reloads the window when Reload is clicked', () => {
        render(
            <ErrorBoundary>
                <Bomb shouldThrow={true} />
            </ErrorBoundary>
        );
        fireEvent.click(screen.getByText(/Reload Window/i));
        expect(window.location.reload).toHaveBeenCalledTimes(1);
    });

    it('restarts the engine when requested', () => {
        render(
            <ErrorBoundary>
                <Bomb shouldThrow={true} />
            </ErrorBoundary>
        );
        fireEvent.click(screen.getByText(/Reload Window/i));
        expect(window.electronAPI.restartEngine).not.toHaveBeenCalled();
    });

    it('quits the app', () => {
        render(
            <ErrorBoundary>
                <Bomb shouldThrow={true} />
            </ErrorBoundary>
        );
        fireEvent.click(screen.getByText(/Quit App/i));
        expect(window.electronAPI.quitApp).toHaveBeenCalledTimes(1);
    });
});
