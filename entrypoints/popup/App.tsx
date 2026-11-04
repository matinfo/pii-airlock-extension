import { useState, useEffect } from "react";
import logo from "~/assets/pii-airlock-logo.png";
import { MSG } from "~/lib/messages";
import "./App.css";

type Mode = "strict" | "permissive";

interface TabStatus {
  site: string;
  composerFound: boolean;
}

function App() {
  const [mode, setMode] = useState<Mode>("strict");
  const [scrubCount, setScrubCount] = useState(0);
  // null = no PII Airlock content script on this tab (not a supported site).
  const [tabStatus, setTabStatus] = useState<TabStatus | null>(null);

  useEffect(() => {
    browser.storage.sync.get({ mode: "strict" }).then((s) => setMode(s.mode as Mode));
    browser.storage.local.get({ scrubCount: 0 }).then((s) => setScrubCount(s.scrubCount as number));

    // Ask the tab's content script directly. No `tabs` permission needed, and
    // the answer is real: "composer found", not "hostname looks familiar".
    browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (tab?.id === undefined) return;
      try {
        const res = (await browser.tabs.sendMessage(tab.id, { type: MSG.STATUS })) as TabStatus | undefined;
        setTabStatus(res ?? null);
      } catch {
        setTabStatus(null); // no content script here
      }
    });
  }, []);

  const toggleMode = () => {
    const next: Mode = mode === "strict" ? "permissive" : "strict";
    setMode(next);
    browser.storage.sync.set({ mode: next });
  };

  const panicClear = () => {
    setScrubCount(0);
    browser.storage.local.set({ scrubCount: 0 });
    // Notify content scripts to clear in-memory mappings
    browser.tabs.query({}).then((tabs) => {
      tabs.forEach((tab) => {
        if (tab.id)
          browser.tabs
            .sendMessage(tab.id, { type: MSG.PANIC_CLEAR })
            .catch(() => {});
      });
    });
  };

  return (
    <div className="popup">
      <header>
        <img src={logo} alt="PII Airlock" className="logo" />
      </header>

      <div className={`protection-status ${tabStatus?.composerFound ? "on" : "off"}`}>
        <span className="status-dot" />
        <span className="status-label">
          {tabStatus === null
            ? "Not an AI chat site"
            : tabStatus.composerFound
              ? "Protection active"
              : "Not protected here"}
        </span>
      </div>

      <div className="site-status">
        {tabStatus === null ? (
          <span className="site-off">Open a supported AI chat to use PII Airlock.</span>
        ) : tabStatus.composerFound ? (
          <span className="site-on">
            ✅ Chat box found (<strong>{tabStatus.site}</strong>)
          </span>
        ) : (
          <span className="site-off">
            ⚠️ No chat box found. The site may have changed; messages here are not checked.
          </span>
        )}
      </div>

      <div className="mode-row">
        <span>Mode</span>
        <button className={`mode-btn ${mode}`} onClick={toggleMode}>
          {mode === "strict" ? "🛡 Strict" : "🔔 Permissive"}
        </button>
      </div>

      <div className="stats">
        <span className="stat-label">Items scrubbed (total)</span>
        <span className="stat-value">{scrubCount}</span>
      </div>

      <div className="actions">
        <button
          className="panic-btn"
          onClick={panicClear}
          title="Clear all in-memory mappings"
        >
          🗑 Clear mappings
        </button>
        <button
          className="options-btn"
          onClick={() => browser.runtime.openOptionsPage()}
        >
          <span>⚙</span> Options
        </button>
      </div>

      <footer>
        <span className="mode-desc">
          {mode === "strict"
            ? "Strict: high-risk PII needs your decision, names are scrubbed."
            : "Permissive: high-risk PII is scrubbed, names ask first."}
        </span>
      </footer>
    </div>
  );
}

export default App;
