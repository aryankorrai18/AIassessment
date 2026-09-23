import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" role="alert" style={{ maxWidth: 560 }}>
        <h2>Something went wrong on this page</h2>
        <p className="muted">{this.state.error.message}</p>
        <button className="btn secondary" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
