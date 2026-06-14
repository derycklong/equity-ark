import { Component, ErrorInfo, ReactNode } from "react";
import { Link } from "react-router-dom";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App error:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-full flex items-center justify-center p-6">
          <div className="max-w-md w-full text-center space-y-4">
            <h1 className="text-2xl font-semibold">Something went wrong</h1>
            <p className="text-ink-dim text-sm">{this.state.error.message || "Unknown error"}</p>
            <div className="flex justify-center gap-2">
              <button
                onClick={() => this.setState({ error: null })}
                className="rounded-md border border-line bg-bg-card hover:bg-bg-soft px-4 py-2 text-sm"
              >
                Try again
              </button>
              <Link
                to="/"
                className="rounded-md border border-line bg-bg-card hover:bg-bg-soft px-4 py-2 text-sm"
              >
                Go home
              </Link>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
