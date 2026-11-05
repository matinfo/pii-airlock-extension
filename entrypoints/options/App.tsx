import { useEffect, useState, type FormEvent } from "react";
import { t, entityLabel } from "~/lib/i18n";
import { defaultDecisionFor, type Mode } from "~/lib/policy";
import type { Decision } from "~/lib/detection/types";
import { MAX_LIST_ENTRIES, MAX_VALUE_LENGTH, cleanListValue, type Lists } from "~/lib/lists";
import NerSection from "./NerSection";
import "./App.css";

const ENTITY_TYPES = [
  "EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD", "IBAN_CODE", "SSN", "IP_ADDRESS", "IP_ADDRESS_PRIVATE",
  "CRYPTO", "SECRET_KEY", "PERSON", "LOCATION", "ORG", "DATE_OF_BIRTH", "FR_NIR", "CH_AHV", "FR_SIRET",
  "FR_SIREN", "DE_TAX_ID", "DE_TAX_NUMBER", "IT_VAT_CODE",
];

/** Kinds offered for "Always replace" (the token the value gets). */
const DENY_TYPES = ["PERSON", "ORG", "LOCATION", "SECRET_KEY", "EMAIL_ADDRESS", "PHONE_NUMBER", "IBAN_CODE", "CREDIT_CARD"];

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
          desc={t("optAllowedDesc")}
          placeholder={t("optAllowedPh")}
          items={lists.allow}
          onAdd={(value) => {
            if (lists.allow.length >= MAX_LIST_ENTRIES || lists.allow.some((v) => v.toLowerCase() === value.toLowerCase())) return;
            saveLists({ allow: [...lists.allow, value], deny: lists.deny.filter((d) => d.value.toLowerCase() !== value.toLowerCase()) });
          }}
          onRemove={(i) => saveLists({ ...lists, allow: lists.allow.filter((_, j) => j !== i) })}
        />
        <ListBox
          title={t("optAlways")}
          desc={t("optAlwaysDesc")}
          placeholder={t("optAlwaysPh")}
          types={DENY_TYPES}
          items={lists.deny.map((d) => d.value)}
          sub={lists.deny.map((d) => entityLabel(d.type))}
          onAdd={(value, type) => {
            if (lists.deny.length >= MAX_LIST_ENTRIES || lists.deny.some((d) => d.value.toLowerCase() === value.toLowerCase())) return;
            saveLists({ allow: lists.allow.filter((v) => v.toLowerCase() !== value.toLowerCase()), deny: [...lists.deny, { value, type: type ?? "PERSON" }] });
          }}
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

function ListBox({ title, desc, placeholder, types, items, sub, onAdd, onRemove }: {
  title: string; desc: string; placeholder: string; types?: string[];
  items: string[]; sub?: string[];
  onAdd: (value: string, type?: string) => void; onRemove: (i: number) => void;
}) {
  const [value, setValue] = useState("");
  const [type, setType] = useState(types?.[0] ?? "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = cleanListValue(value);
    if (!v) return;
    onAdd(v, types ? type : undefined);
    setValue("");
  };
  return (
    <div className="listbox">
      <h3>{title}</h3>
      <p className="desc">{desc}</p>
      <form className="add" onSubmit={submit}>
        <input
          type="text" value={value} placeholder={placeholder} maxLength={MAX_VALUE_LENGTH}
          aria-label={title} onChange={(e) => setValue(e.target.value)}
        />
        {types && (
          <select value={type} aria-label={t("optAsKind")} onChange={(e) => setType(e.target.value)}>
            {types.map((k) => <option key={k} value={k}>{entityLabel(k)}</option>)}
          </select>
        )}
        <button className="btn primary" type="submit" disabled={!cleanListValue(value)}>{t("optAdd")}</button>
      </form>
      {value.trim() !== "" && !cleanListValue(value) && <p className="hint warn-text" role="status">{t("optInvalid")}</p>}
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
  return <img src={browser.runtime.getURL("/icon/48.png" as never)} width={20} height={20} alt="" aria-hidden="true" />;
}

export default App;
