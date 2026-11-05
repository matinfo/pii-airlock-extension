import { useEffect, useState } from "react";
import { t, entityLabel } from "~/lib/i18n";
import { defaultDecisionFor, type Mode } from "~/lib/policy";
import type { Decision } from "~/lib/detection/types";
import type { Lists } from "~/lib/lists";
import NerSection from "./NerSection";
import "./App.css";

const ENTITY_TYPES = [
  "EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD", "IBAN_CODE", "SSN", "IP_ADDRESS", "IP_ADDRESS_PRIVATE",
  "CRYPTO", "SECRET_KEY", "PERSON", "LOCATION", "ORG", "DATE_OF_BIRTH", "FR_NIR", "CH_AHV", "FR_SIRET",
  "FR_SIREN", "DE_TAX_ID", "DE_TAX_NUMBER", "IT_VAT_CODE",
];

const MODES: Mode[] = ["auto", "review", "off"];
const cap = (m: string) => m[0]!.toUpperCase() + m.slice(1);

const ACTIONS: Array<{ value: Decision; key: string }> = [
  { value: "auto_scrub", key: "actReplace" },
  { value: "warn", key: "actAsk" },
  { value: "notify", key: "actNotice" },
  { value: "allow", key: "actAllow" },
];
const actionKey = (d: Decision) => ACTIONS.find((a) => a.value === (d === "block" ? "auto_scrub" : d))?.key ?? "actReplace";

function App() {
  const [mode, setMode] = useState<Mode>("auto");
  const [overrides, setOverrides] = useState<Record<string, Decision>>({});
  const [lists, setLists] = useState<Lists>({ allow: [], deny: [] });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    browser.storage.sync.get({ mode: "auto", overrides: {} }).then((s) => {
      const m = s.mode as string;
      setMode(m === "review" || m === "off" ? m : "auto");
      setOverrides(s.overrides as Record<string, Decision>);
    });
    browser.storage.local.get({ lists: { allow: [], deny: [] } }).then((s) => setLists(s.lists as Lists));
    const onChange = (c: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "local" && c.lists) setLists((c.lists.newValue as Lists) ?? { allow: [], deny: [] });
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, []);

  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };
  const saveSync = (patch: { mode?: Mode; overrides?: Record<string, Decision> }) =>
    browser.storage.sync.set(patch).then(flash);

  const chooseMode = (m: Mode) => { setMode(m); void saveSync({ mode: m }); };
  const setOverride = (type: string, v: Decision | "") => {
    const next = { ...overrides };
    if (v === "") delete next[type]; else next[type] = v;
    setOverrides(next);
    void saveSync({ overrides: next });
  };
  const saveLists = (next: Lists) => { setLists(next); void browser.storage.local.set({ lists: next }).then(flash); };

  return (
    <div className="options">
      <header>
        <span className="brand"><Shield /> {t("appName")} <span className="sub">{t("optTitle")}</span></span>
        <span className="saved" role="status">{saved ? t("optSaved") : ""}</span>
      </header>

      <section>
        <h2>{t("optMode")}</h2>
        <div className="group pad">
          <div className="seg" role="radiogroup" aria-label={t("optMode")}>
            {MODES.map((m) => (
              <label key={m} className={mode === m ? "on" : ""}>
                <input type="radio" name="mode" checked={mode === m} onChange={() => chooseMode(m)} />
                {t(`mode${cap(m)}`)}
              </label>
            ))}
          </div>
          <p className="hint">{t(`mode${cap(mode)}Hint`)}</p>
        </div>
      </section>

      <NerSection />

      <section id="languages">
        <h2>{t("langTitle")}</h2>
        <p className="desc">{t("langDesc")}</p>
        <ul className="group">
          {(["Structured", "Names", "Model"] as const).map((k) => (
            <li key={k} className="row lang">
              <span>{t(`lang${k}`)}</span>
              <span className="muted">{t(`lang${k}Val`)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{t("optEntities")}</h2>
        <p className="desc">{t("optEntitiesDesc")}</p>
        <ul className="group">
          {ENTITY_TYPES.map((type) => {
            const def = defaultDecisionFor(type, mode);
            return (
              <li key={type} className="row">
                <label htmlFor={`e-${type}`}>{entityLabel(type)}</label>
                <select
                  id={`e-${type}`}
                  value={overrides[type] ?? ""}
                  onChange={(e) => setOverride(type, e.target.value as Decision | "")}
                >
                  <option value="">{t("actDefault")} · {t(actionKey(def))}</option>
                  {ACTIONS.map((a) => <option key={a.value} value={a.value}>{t(a.key)}</option>)}
                </select>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2>{t("optLists")}</h2>
        <p className="desc">{t("optListsDesc")}</p>
        <ListBox
          title={t("optAllowed")}
          items={lists.allow}
          onRemove={(i) => saveLists({ ...lists, allow: lists.allow.filter((_, j) => j !== i) })}
        />
        <ListBox
          title={t("optAlways")}
          items={lists.deny.map((d) => d.value)}
          sub={lists.deny.map((d) => entityLabel(d.type))}
          onRemove={(i) => saveLists({ ...lists, deny: lists.deny.filter((_, j) => j !== i) })}
        />
      </section>

      <footer>
        <span>{t("optFooter")}</span>
        <button className="link" onClick={() => {
          setMode("auto"); setOverrides({});
          void saveSync({ mode: "auto", overrides: {} });
        }}>{t("optReset")}</button>
      </footer>
    </div>
  );
}

function ListBox({ title, items, sub, onRemove }: { title: string; items: string[]; sub?: string[]; onRemove: (i: number) => void }) {
  return (
    <div className="listbox">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="empty group pad">{t("optEmpty")}</p>
      ) : (
        <ul className="group">
          {items.map((v, i) => (
            <li key={`${v}-${i}`} className="row">
              <span className="v">{v}{sub?.[i] && <small>{sub[i]}</small>}</span>
              <button className="link" onClick={() => onRemove(i)} aria-label={`${t("optRemove")}: ${v}`}>{t("optRemove")}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Shield() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 5 6v5.5c0 4.3 2.9 7.6 7 9.5 4.1-1.9 7-5.2 7-9.5V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export default App;
