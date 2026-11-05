import { useEffect, useState } from "react";
import { MSG } from "~/lib/messages";
import { t } from "~/lib/i18n";
import type { Mode } from "~/lib/policy";
import { isInstalled } from "~/lib/ner-model";
import "./App.css";

interface TabStatus {
  site: string;
  host: string;
  composerFound: boolean;
  mode: Mode;
  siteOff: boolean;
  pausedUntil: number;
}

const MODES: Mode[] = ["auto", "review", "off"];
const modeLabel = (m: Mode) => t(`mode${m[0]!.toUpperCase()}${m.slice(1)}`);
const modeHint = (m: Mode) => t(`mode${m[0]!.toUpperCase()}${m.slice(1)}Hint`);

function Shield() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 5 6v5.5c0 4.3 2.9 7.6 7 9.5 4.1-1.9 7-5.2 7-9.5V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function App() {
  const [mode, setMode] = useState<Mode>("auto");
  const [sitesOff, setSitesOff] = useState<string[]>([]);
  const [pausedUntil, setPausedUntil] = useState(0);
  const [count, setCount] = useState(0);
  // null = no PII Airlock content script on this tab (not a supported site).
  const [tab, setTab] = useState<TabStatus | null>(null);
  const [cleared, setCleared] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [names, setNames] = useState<boolean | null>(null);

  useEffect(() => {
    browser.storage.sync.get({ mode: "auto", sitesOff: [] }).then((s) => {
      const m = s.mode as string;
      setMode(m === "review" || m === "off" ? m : "auto");
      setSitesOff(s.sitesOff as string[]);
    });
    browser.storage.local.get({ scrubCount: 0, pausedUntil: 0 }).then((s) => {
      setCount(s.scrubCount as number);
      setPausedUntil(s.pausedUntil as number);
    });
    browser.tabs.query({ active: true, currentWindow: true }).then(async ([tb]) => {
      if (tb?.id === undefined) return;
      try {
        setTab(((await browser.tabs.sendMessage(tb.id, { type: MSG.STATUS })) as TabStatus | undefined) ?? null);
      } catch {
        setTab(null);
      }
    });
    void isInstalled().then(setNames);
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const paused = pausedUntil > now;
  const siteOff = tab ? sitesOff.includes(tab.host) : false;

  const chooseMode = (m: Mode) => {
    setMode(m);
    void browser.storage.sync.set({ mode: m });
  };
  const toggleSite = () => {
    if (!tab) return;
    const next = siteOff ? sitesOff.filter((h) => h !== tab.host) : [...sitesOff, tab.host];
    setSitesOff(next);
    void browser.storage.sync.set({ sitesOff: next });
  };
  const togglePause = () => {
    const until = paused ? 0 : Date.now() + 3_600_000;
    setPausedUntil(until);
    void browser.storage.local.set({ pausedUntil: until });
  };
  const clearAll = () => {
    setCount(0);
    void browser.storage.local.set({ scrubCount: 0 });
    void browser.storage.local.remove("lists");
    browser.tabs.query({}).then((tabs) =>
      tabs.forEach((tb) => {
        if (tb.id) browser.tabs.sendMessage(tb.id, { type: MSG.PANIC_CLEAR }).catch(() => {});
      }),
    );
    setCleared(true);
    setTimeout(() => setCleared(false), 2000);
  };

  // One honest line: what is true on THIS tab right now.
  let status: { text: string; tone: "ok" | "warn" | "off" };
  if (!tab) status = { text: t("popUnsupported"), tone: "off" };
  else if (mode === "off") status = { text: t("popOff"), tone: "off" };
  else if (siteOff) status = { text: t("popSiteOff"), tone: "off" };
  else if (paused) status = { text: t("popPaused", new Date(pausedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })), tone: "off" };
  else if (!tab.composerFound) status = { text: t("popNoComposer"), tone: "warn" };
  else status = { text: t("popActive"), tone: "ok" };

  return (
    <main className="popup">
      <header>
        <span className="brand"><Shield /> {t("appName")}</span>
        <button className="link" onClick={() => browser.runtime.openOptionsPage()}>{t("popSettings")}</button>
      </header>

      <section className={`status ${status.tone}`} role="status">
        <span className="dot" aria-hidden="true" />
        <div>
          <div className="status-text">{status.text}</div>
          {tab && <div className="status-sub">{tab.host}</div>}
        </div>
      </section>

      {tab && (
        <label className="switch-row">
          <span>{t("popSiteToggle", tab.host)}</span>
          <button type="button" role="switch" aria-checked={!siteOff} className="switch" onClick={toggleSite}>
            <span className="knob" />
          </button>
        </label>
      )}

      <fieldset className="modes">
        <legend>{t("popMode")}</legend>
        <div className="seg">
          {MODES.map((m) => (
            <label key={m} className={mode === m ? "on" : ""}>
              <input type="radio" name="mode" checked={mode === m} onChange={() => chooseMode(m)} />
              {modeLabel(m)}
            </label>
          ))}
        </div>
        <p className="hint">{modeHint(mode)}</p>
      </fieldset>

      <button className="btn" onClick={togglePause} disabled={mode === "off"}>
        {paused ? t("popResume") : t("popPause")}
      </button>

      {names !== null && mode !== "off" && (
        <section className={`names ${names ? "on" : ""}`}>
          <div>
            <div className="status-text">{names ? t("popNamesOn") : t("popNamesOff")}</div>
            <div className="status-sub">{names ? t("popNamesOnSub") : t("popNamesOffSub")}</div>
          </div>
          {!names && (
            <button className="btn small" onClick={() => browser.tabs.create({ url: browser.runtime.getURL("/options.html#names" as never) })}>
              {t("popNamesCta")}
            </button>
          )}
        </section>
      )}

      <footer>
        <span>{t("popScrubbed", count)}</span>
        <button className="link" onClick={clearAll} title={t("popClearHint")}>
          {cleared ? t("popCleared") : t("popClear")}
        </button>
      </footer>
    </main>
  );
}

export default App;
