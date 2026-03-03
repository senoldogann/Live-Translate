import { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import ApiKeyModal from '../components/ApiKeyModal';

vi.mock('framer-motion', () => ({
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: {
        div: forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((props, ref) => (
            <div ref={ref} {...props} />
        )),
    },
}));

describe('ApiKeyModal', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('keeps the modal open when API validation fails', async () => {
        const onClose = vi.fn();
        const onSave = vi.fn().mockResolvedValue({
            ok: false,
            message: 'Deepgram anahtari gecersiz.',
        });

        render(
            <ApiKeyModal
                isOpen={true}
                onClose={onClose}
                onSave={onSave}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Kaydet ve Uygula' }));

        await act(async () => {
            await Promise.resolve();
        });

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Deepgram anahtari gecersiz.')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('closes after successful validation and save', async () => {
        vi.useFakeTimers();

        const onClose = vi.fn();
        const onSave = vi.fn().mockResolvedValue({
            ok: true,
            message: 'API anahtarlari dogrulandi.',
        });

        render(
            <ApiKeyModal
                isOpen={true}
                onClose={onClose}
                onSave={onSave}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Kaydet ve Uygula' }));

        await act(async () => {
            await Promise.resolve();
        });

        expect(screen.getByText('API anahtarlari dogrulandi.')).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(400);
        });

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
