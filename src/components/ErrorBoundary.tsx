import { Component, type ErrorInfo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

// A render throw anywhere below unmounts the whole React tree, which reads as
// a blank window with no clue what happened. Priority #1 is "never crash or
// silently drop content" — so catch it, show what broke, and keep the
// transcript recoverable (it's already persisted in SQLite; only the view is
// gone). Reset re-mounts the subtree without reloading the app.
type Props = { children: ReactNode; onReset?: () => void };
type State = { error: Error | null; stack: string };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept in the webview console too, so devtools shows the component stack.
    console.error("Transcriptor render error:", error, info.componentStack);
    // Also to the activity log: the console dies with the window, the file
    // survives for the Settings viewer.
    invoke("log_ui_error", {
      message: `${error.name}: ${error.message} ${(info.componentStack ?? "").split("\n")[1]?.trim() ?? ""}`,
    }).catch(() => {});
    this.setState({ stack: info.componentStack ?? "" });
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    const detail = `${error.name}: ${error.message}\n${stack}`.trim();
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-xl rounded-md border border-border-subtle bg-panel p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-faint">
            Something broke while drawing this view
          </p>
          <p className="mt-2 text-sm text-ink">{error.message || String(error)}</p>
          <p className="mt-2 text-xs text-ink-muted">
            Your transcript is safe — it's stored in the library, not in this screen.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded border border-border-subtle bg-bg p-3 font-mono text-[10px] leading-relaxed text-ink-faint">
            {detail}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => {
                this.setState({ error: null, stack: "" });
                this.props.onReset?.();
              }}
              className="rounded-md border border-border-subtle px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
            >
              Back to library
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(detail)}
              className="rounded-md border border-border-subtle px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
            >
              Copy details
            </button>
          </div>
        </div>
      </div>
    );
  }
}
