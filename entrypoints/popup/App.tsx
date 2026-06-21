import { useState, useEffect } from 'react';
import logo from '/icon/128.png';
import './App.css';

type Mode = 'strict' | 'permissive';

const AI_SITES = [
  'chatgpt.com', 'claude.ai', 'gemini.google.com',
  'copilot.microsoft.com', 'perplexity.ai', 'poe.com',
];

function App() {
  const [mode, setMode] = useState<Mode>('strict');
  const [scrubCount, setScrubCount] = useState(0);
  const [currentSite, setCurrentSite] = useState<string | null>(null);
  const [active, setActive] = useState(true);

  useEffect(() => {
    // Load settings
    browser.storage.sync.get({ mode: 'strict', scrubCount: 0 }).then((s) => {
      setMode(s.mode as Mode);
      setScrubCount(s.scrubCount as number);
    });

    // Get current tab hostname
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.url) {
        try {
          const host = new URL(tab.url).hostname;
          const matched = AI_SITES.find((s) => host.includes(s));
          setCurrentSite(matched ?? null);
        } catch { /* ignore */ }
      }
    });
  }, []);

  const toggleMode = () => {
    const next: Mode = mode === 'strict' ? 'permissive' : 'strict';
    setMode(next);
    browser.storage.sync.set({ mode: next });
  };

  const panicClear = () => {
    setScrubCount(0);
    browser.storage.sync.set({ scrubCount: 0 });
    // Notify content scripts to clear in-memory mappings
    browser.tabs.query({}).then((tabs) => {
      tabs.forEach((tab) => {
        if (tab.id) browser.tabs.sendMessage(tab.id, { type: 'PANIC_CLEAR' }).catch(() => {});
      });
    });
  };

  return (
    <div className="popup">
      <header>
        <img src={logo} alt="PII Airlock" className="logo" />
        <h1>PII Airlock</h1>
        <span className={`status-dot ${active ? 'on' : 'off'}`} title={active ? 'Active' : 'Paused'} />
      </header>

      <div className="site-status">
        {currentSite
          ? <span className="site-on">✅ Active on <strong>{currentSite}</strong></span>
          : <span className="site-off">⚠️ Not an AI chat site</span>
        }
      </div>

      <div className="mode-row">
        <span>Mode</span>
        <button className={`mode-btn ${mode}`} onClick={toggleMode}>
          {mode === 'strict' ? '🛡 Strict' : '🔔 Permissive'}
        </button>
      </div>

      <div className="stats">
        <span className="stat-label">Items scrubbed (session)</span>
        <span className="stat-value">{scrubCount}</span>
      </div>

      <div className="actions">
        <button className="panic-btn" onClick={panicClear} title="Clear all in-memory mappings">
          🗑 Clear mappings
        </button>
        <button className="options-btn" onClick={() => browser.runtime.openOptionsPage()}>
          ⚙ Options
        </button>
      </div>

      <footer>
        <span className="mode-desc">
          {mode === 'strict'
            ? 'Strict: blocks high-risk PII, auto-scrubs names.'
            : 'Permissive: warns on high-risk, allows names.'}
        </span>
      </footer>
    </div>
  );
}

export default App;
