"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#1a1a2e",
            color: "#ef4444",
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 12,
            padding: 32,
            textAlign: "center",
            lineHeight: 2,
          }}
        >
          <div>
            <div style={{ fontSize: 16, marginBottom: 16 }}>Something went wrong</div>
            <div style={{ color: "#94a3b8", fontSize: 10 }}>
              {this.state.error.message}
            </div>
            <button
              onClick={() => this.setState({ error: null })}
              style={{
                marginTop: 24,
                padding: "8px 24px",
                border: "3px solid #0f3460",
                background: "#16213e",
                color: "#e2e8f0",
                fontFamily: "inherit",
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
