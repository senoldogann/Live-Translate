import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SiriWave from '../SiriWave';

// Mock canvas 2d context
const mockContext = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    scale: vi.fn(),
};

function mockCanvas() {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockContext) as any;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
}

describe('SiriWave', () => {
    const rafMock = vi.fn(() => 1);

    beforeEach(() => {
        mockCanvas();
        vi.clearAllMocks();
        // jsdom'da requestAnimationFrame yok — stub ile taklit et
        vi.stubGlobal('requestAnimationFrame', rafMock);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renders a canvas element with the given dimensions', () => {
        const { container } = render(<SiriWave width={320} height={64} isActive={true} />);
        const canvas = container.querySelector('canvas');
        expect(canvas).not.toBeNull();
        expect(canvas!.style.width).toBe('320px');
        expect(canvas!.style.height).toBe('64px');
    });

    it('runs the animation loop while active', () => {
        render(<SiriWave isActive={true} />);
        expect(rafMock).toHaveBeenCalled();
    });

    it('draws to the 2d context', () => {
        render(<SiriWave isActive={true} amplitude={0.5} />);
        expect(mockContext.clearRect).toHaveBeenCalled();
    });

    it('hides the wrapper when inactive', () => {
        const { container } = render(<SiriWave isActive={false} />);
        const wrapper = container.firstChild as HTMLElement;
        expect(wrapper.style.display).toBe('none');
    });
});
