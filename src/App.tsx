import { useEffect, useState } from "react";
import "./App.css";
import SessionSidebar, { type View } from "./components/SessionSidebar";
import Home from "./pages/Home";
import Transcript from "./pages/Transcript";
import Models from "./pages/Models";
import Settings from "./pages/Settings";

function App() {
  const [view, setView] = useState<View>("home");
  const [activeWorkId, setActiveWorkId] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  // Hide the default webview context menu app-wide; the session sidebar ships
  // its own right-click menu where it matters.
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  function openWork(id: string) {
    setActiveWorkId(id);
    setView("transcript");
    setNavOpen(false);
  }

  function startNew() {
    setActiveWorkId(null);
    setView("home");
    setNavOpen(false);
  }

  function go(v: View) {
    setView(v);
    setNavOpen(false);
  }

  return (
    <div className="flex min-h-screen bg-bg text-ink antialiased">
      <SessionSidebar
        view={view}
        activeWorkId={activeWorkId}
        onOpen={openWork}
        onNew={startNew}
        onGoModels={() => go("models")}
        onGoSettings={() => go("settings")}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 md:hidden">
          <button
            onClick={() => setNavOpen(true)}
            className="text-ink-muted hover:text-ink"
            aria-label="Open menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <span className="text-sm font-semibold tracking-tight">Transcriptor</span>
        </header>
        {view === "home" && <Home onOpen={openWork} onGoModels={() => go("models")} />}
        {view === "transcript" &&
          activeWorkId &&
          <Transcript workId={activeWorkId} onDelete={startNew} />}
        {view === "models" && <Models />}
        {view === "settings" && <Settings />}
      </div>
    </div>
  );
}

export default App;