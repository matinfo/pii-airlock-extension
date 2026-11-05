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
        <h1>{t("appName")} <span>{t("optTitle")}</span></h1>
        <span className={`saved ${saved ? "show" : ""}`} role="status">{saved ? t("optSaved") : ""}</span>
      </header>

      <section>
        <h2>{t("optMode")}</h2>
        <div className="cards" role="radiogroup" aria-label={t("optMode")}>
          {MODES.map((m) => (
            <label key={m} className={`card ${mode === m ? "on" : ""}`}>
              <input type="radio" name="mode" checked={mode === m} onChange={() => chooseMode(m)} />
              <strong>{t(`mode${cap(m)}`)}</strong>
              <span>{t(`mode${cap(m)}Hint`)}</span>
            </label>
          ))}
        </div>
      </section>

      <NerSection />

      <section>
        <h2>{t("optEntities")}</h2>
        <p className="desc">{t("optEntitiesDesc")}</p>
        <table>
          <thead>
            <tr><th>{t("colType")}</th><th>{t("colAction")}</th></tr>
          </thead>
          <tbody>
            {ENTITY_TYPES.map((type) => {
              const def = defaultDecisionFor(type, mode);
              return (
                <tr key={type}>
                  <td>{entityLabel(type)}</td>
                  <td>
                    <select
                      aria-label={entityLabel(type)}
                      value={overrides[type] ?? ""}
                      onChange={(e) => setOverride(type, e.target.value as Decision | "")}
                    >
                      <option value="">{t("actDefault")} · {t(actionKey(def))}</option>
                      {ACTIONS.map((a) => <option key={a.value} value={a.value}>{t(a.key)}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h2>{t("optLists")}</h2>
        <p className="desc">{t("optListsDesc")}</p>
        <div className="two">
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
        </div>
      </section>

      <section className="reset">
        <button className="btn" onClick={() => {
          setMode("auto"); setOverrides({});
          void saveSync({ mode: "auto", overrides: {} });
        }}>{t("optReset")}</button>
      </section>

      <footer>{t("optFooter")}</footer>
    </div>
  );
}

function ListBox({ title, items, sub, onRemove }: { title: string; items: string[]; sub?: string[]; onRemove: (i: number) => void }) {
  return (
    <div className="listbox">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="empty">{t("optEmpty")}</p>
      ) : (
        <ul>
          {items.map((v, i) => (
            <li key={`${v}-${i}`}>
              <span className="v">{v}{sub?.[i] && <small>{sub[i]}</small>}</span>
              <button className="link" onClick={() => onRemove(i)} aria-label={`${t("optRemove")}: ${v}`}>{t("optRemove")}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default App;
