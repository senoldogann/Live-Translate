/**
 * Error Boundary Component
 *
 * Catches uncaught React rendering errors and displays a recovery UI
 * instead of a blank white screen. Critical for production stability.
 */

import React from 'react';

interface Props {
    children: React.ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false, error: null };

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        console.error('[ErrorBoundary] Uncaught UI error:', error, errorInfo.componentStack);
    }

    handleReload = (): void => {
        this.setState({ hasError: false, error: null });
        window.location.reload();
    };

    handleRestart = (): void => {
        window.electronAPI?.restartEngine();
        this.setState({ hasError: false, error: null });
    };

    render(): React.ReactNode {
        if (this.state.hasError) {
            return (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100vh',
                    background: 'rgba(0,0,0,0.9)',
                    color: '#fff',
                    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                    padding: '24px',
                    textAlign: 'center',
                }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
                    <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>
                        Something went wrong
                    </h2>
                    <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.6)', marginBottom: '24px', maxWidth: '400px' }}>
                        An unexpected error occurred in the UI. You can try reloading the window or restarting the engine.
                    </p>
                    {this.state.error && (
                        <pre style={{
                            fontSize: '11px',
                            color: 'rgba(255,255,255,0.4)',
                            background: 'rgba(255,255,255,0.05)',
                            padding: '12px',
                            borderRadius: '8px',
                            maxWidth: '500px',
                            overflow: 'auto',
                            marginBottom: '24px',
                            textAlign: 'left',
                        }}>
                            {this.state.error.message}
                        </pre>
                    )}
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button
                            onClick={this.handleReload}
                            style={{
                                padding: '10px 20px',
                                borderRadius: '8px',
                                border: '1px solid rgba(255,255,255,0.2)',
                                background: 'rgba(255,255,255,0.1)',
                                color: '#fff',
                                cursor: 'pointer',
                                fontSize: '14px',
                            }}
                        >
                            🔄 Reload Window
                        </button>
                        <button
                            onClick={() => window.electronAPI?.quitApp()}
                            style={{
                                padding: '10px 20px',
                                borderRadius: '8px',
                                border: '1px solid rgba(239,68,68,0.4)',
                                background: 'rgba(239,68,68,0.2)',
                                color: '#ff6b6b',
                                cursor: 'pointer',
                                fontSize: '14px',
                            }}
                        >
                            ✕ Quit App
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;