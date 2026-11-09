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

/** True when `url` matches a content-script pattern from the manifest. */
function isSupportedUrl(url: string): boolean {
  const patterns = browser.runtime.getManifest().content_scripts?.flatMap((c) => c.matches ?? []) ?? [];
  return patterns.some((m) => {
    const re = new RegExp("^" + m.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    return re.test(url);
  });
}

function Shield() {
  return <img src={browser.runtime.getURL("/icon/48.png" as never)} width={20} height={20} alt="" aria-hidden="true" />;
}

function App() {
  const [mode, setMode] = useState<Mode>("auto");
  const [sitesOff, setSitesOff] = useState<string[]>([]);
  const [pausedUntil, setPausedUntil] = useState(0);
  const [count, setCount] = useState(0);
  // null = no PII Airlock content script on this tab (not a supported site).
  const [tab, setTab] = useState<TabStatus | null>(null);
  // Supported site, but the content script never loaded here (tab opened before
  // install/update): the page is NOT protected until it is reloaded.
  const [staleTabId, setStaleTabId] = useState<number | null>(null);
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
        if (tb.url && isSupportedUrl(tb.url)) setStaleTabId(tb.id);
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
  if (!tab && staleTabId !== null) status = { text: t("popReload"), tone: "warn" };
  else if (!tab) status = { text: t("popUnsupported"), tone: "off" };
  else if (mode === "off") status = { text: t("popOff"), tone: "off" };
  else if (siteOff) status = { text: t("popSiteOff"), tone: "off" };
  else if (paused) status = { text: t("popPaused", new Date(pausedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })), tone: "off" };
  else if (!tab.composerFound) status = { text: t("popNoComposer"), tone: "warn" };
  else status = { text: t("popActive"), tone: "ok" };

  return (
    <main className="popup">
      <header>
        <span className="brand"><Shield /> {t("appName")}</span>
        <button className="link icon-btn" title={t("popSettings")} aria-label={t("popSettings")} onClick={() => browser.runtime.openOptionsPage()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>

      <section className={`status ${status.tone}`} role="status">
        <span className="dot" aria-hidden="true" />
        <div>
          <div className="status-text">{status.text}</div>
          {tab && <div className="status-sub">{tab.host}</div>}
        </div>
      </section>

      {staleTabId !== null && (
        <button className="btn" onClick={() => { void browser.tabs.reload(staleTabId); window.close(); }}>
          {t("popReloadBtn")}
        </button>
      )}

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

      {names === true && mode !== "off" && (
        <div className="names-on" title={t("popNamesOnSub")}>
          <span className="dot" aria-hidden="true" />
          {t("popNamesOn")}
        </div>
      )}

      {names === false && mode !== "off" && (
        <section className="names">
          <div>
            <div className="status-text">{t("popNamesOff")}</div>
            <div className="status-sub">{t("popNamesOffSub")}</div>
          </div>
          <button className="btn small" onClick={() => browser.tabs.create({ url: browser.runtime.getURL("/options.html#names" as never) })}>
            {t("popNamesCta")}
          </button>
        </section>
      )}

      <footer>
        <span>{t("popScrubbed", count)}</span>
        <button className="link btn" onClick={clearAll} title={t("popClearHint")}>
          {cleared ? t("popCleared") : t("popClear")}
        </button>
      </footer>
    </main>
  );
}

export default App;
