import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="page-wrap">
      <h1 className="page-title">Something broke.</h1>
      <p className="subtle" style={{ fontSize: 13 }}>{this.state.error.message}</p>
      <button className="primary-btn" onClick={() => { location.hash = '#/'; location.reload(); }}>Reload</button>
    </main>;
  }
}

createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
