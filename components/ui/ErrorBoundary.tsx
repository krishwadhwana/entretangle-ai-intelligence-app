"use client";

import { Component, type ReactNode } from "react";

// Contains a render crash to a single view instead of white-screening the
// whole app. Reset it by changing `resetKey` (e.g. the active view id), so
// switching away from a broken view recovers automatically.
export default class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: unknown; fallback?: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm font-medium text-neutral-800">
              This view couldn’t render here.
            </p>
            <p className="max-w-sm text-xs text-neutral-500">
              It may be too heavy for this screen. Try a larger window, or
              switch to another view and back.
            </p>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="mt-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:border-indigo-400"
            >
              Retry
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
