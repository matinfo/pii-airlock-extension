import { useState, useEffect } from "react";
import icon from "~/assets/pii-airlock-icon.png";
import "./App.css";

type Mode = "strict" | "permissive";
type Decision = "allow" | "notify" | "warn" | "auto_scrub" | "block";

interface Settings {
  mode: Mode;
  overrides: Record<string, Decision>;
  scrubCount: number;
}

interface EntityConfig {
  type: string;
  label: string;
  tier: "high" | "medium" | "low";
  description: string;
}

const ENTITIES: EntityConfig[] = [
  {
    type: "EMAIL_ADDRESS",
    label: "Email address",
    tier: "high",
    description: "e.g. alice@example.com",
  },
  {
    type: "PHONE_NUMBER",
    label: "Phone number",
    tier: "high",
    description: "e.g. +1 555 867 5309",
  },
  {
    type: "CREDIT_CARD",
    label: "Credit card",
    tier: "high",
    description: "Validated with Luhn check",
  },
  {
    type: "IBAN_CODE",
    label: "IBAN",
    tier: "high",
    description: "International bank account number",
  },
  {
    type: "SSN",
    label: "Social security number",
    tier: "high",
    description: "US SSN format",
  },
  {
    type: "IP_ADDRESS",
    label: "IP address",
    tier: "high",
    description: "IPv4 and IPv6",
  },
  {
    type: "CRYPTO",
    label: "Crypto address",
    tier: "high",
    description: "Bitcoin, Ethereum addresses",
  },
  {
    type: "SECRET_KEY",
    label: "Secret key / token",
    tier: "high",
    description: "Bearer, sk-, ghp_, passwords",
  },
  {
    type: "PERSON",
    label: "Person name",
    tier: "medium",
    description: "Detected by NLP (English)",
  },
  {
    type: "LOCATION",
    label: "Location",
    tier: "medium",
    description: "City, country, address (English)",
  },
  {
    type: "ORG",
    label: "Organisation",
    tier: "medium",
    description: "Company, institution (English)",
  },
  {
    type: "DATE_OF_BIRTH",
    label: "Date of birth",
    tier: "low",
    description: "Only when preceded by DOB label",
  },
];

const DECISION_LABELS: Record<Decision, string> = {
  allow: "Allow (skip)",
  notify: "Notify (passive pill)",
  warn: "Warn (banner, can override)",
  auto_scrub: "Auto-scrub",
  block: "Block (must act)",
};

const TIER_COLORS: Record<string, string> = {
  high: "#e53e3e",
  medium: "#d97706",
  low: "#2f855a",
};

const DEFAULT_SETTINGS: Settings = {
  mode: "strict",
  overrides: {},
  scrubCount: 0,
};

// Ordered from most to least restrictive (for the <select>)
const DECISIONS: Decision[] = [
  "block",
  "auto_scrub",
  "warn",
  "notify",
  "allow",
];

function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    browser.storage.sync
      .get(DEFAULT_SETTINGS as unknown as Record<string, unknown>)
      .then((s) => setSettings(s as unknown as Settings));
  }, []);

  function save(next: Settings) {
    setSettings(next);
    browser.storage.sync
      .set(next as unknown as Record<string, unknown>)
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      });
  }

  function setMode(mode: Mode) {
    save({ ...settings, mode });
  }

  function setOverride(entityType: string, decision: Decision | "") {
    const overrides = { ...settings.overrides };
    if (decision === "") {
      delete overrides[entityType];
    } else {
      overrides[entityType] = decision;
    }
    save({ ...settings, overrides });
  }

  function resetAll() {
    save({ ...DEFAULT_SETTINGS, scrubCount: settings.scrubCount });
  }

  return (
    <div className="options">
      <header>
        <div className="header-title">
          <img src={icon} alt="" className="logo" />
          <h1>PII Airlock — Options</h1>
        </div>
        {saved && <span className="saved-badge">✓ Saved</span>}
      </header>

      {/* Mode */}
      <section className="section">
        <h2>Detection mode</h2>
        <div className="mode-options">
          {(["strict", "permissive"] as Mode[]).map((m) => (
            <label
              key={m}
              className={`mode-card ${settings.mode === m ? "active" : ""}`}
            >
              <input
                type="radio"
                name="mode"
                value={m}
                checked={settings.mode === m}
                onChange={() => setMode(m)}
              />
              <div className="mode-card-body">
                <strong>
                  {m === "strict" ? "🛡 Strict (recommended)" : "🔔 Permissive"}
                </strong>
                <span>
                  {m === "strict"
                    ? "Blocks high-risk PII. Auto-scrubs names and locations."
                    : "Warns on high-risk PII. Allows names and locations through."}
                </span>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* Entity overrides */}
      <section className="section">
        <h2>Per-entity policy</h2>
        <p className="section-desc">
          Override the default action for specific entity types. Leave blank to
          use the mode default.
        </p>
        <table className="entity-table">
          <thead>
            <tr>
              <th>Entity</th>
              <th>Tier</th>
              <th>Default action</th>
              <th>Override</th>
            </tr>
          </thead>
          <tbody>
            {ENTITIES.map((e) => {
              const defaultDecision =
                e.tier === "high"
                  ? settings.mode === "strict"
                    ? "block"
                    : "auto_scrub"
                  : e.tier === "medium"
                    ? settings.mode === "strict"
                      ? "auto_scrub"
                      : "warn"
                    : settings.mode === "strict"
                      ? "warn"
                      : "notify";

              const override = settings.overrides[e.type];

              return (
                <tr key={e.type} className={override ? "overridden" : ""}>
                  <td>
                    <span className="entity-label">{e.label}</span>
                    <span className="entity-desc">{e.description}</span>
                  </td>
                  <td>
                    <span
                      className="tier-badge"
                      style={{ color: TIER_COLORS[e.tier] }}
                    >
                      {e.tier}
                    </span>
                  </td>
                  <td>
                    <span className="default-decision">
                      {DECISION_LABELS[defaultDecision]}
                    </span>
                  </td>
                  <td>
                    <select
                      value={override ?? ""}
                      onChange={(ev) =>
                        setOverride(e.type, ev.target.value as Decision | "")
                      }
                    >
                      <option value="">(use default)</option>
                      {DECISIONS.map((d) => (
                        <option key={d} value={d}>
                          {DECISION_LABELS[d]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Stats */}
      <section className="section stats-section">
        <h2>Statistics</h2>
        <div className="stat-row">
          <span>Total items scrubbed (all sessions)</span>
          <strong>{settings.scrubCount}</strong>
        </div>
      </section>

      {/* Reset */}
      <section className="section">
        <h2>Reset</h2>
        <button className="reset-btn" onClick={resetAll}>
          Reset all settings to defaults
        </button>
      </section>

      <footer>
        <span>PII Airlock — open source, no data leaves your browser.</span>
        <a
          href="https://github.com/matinfo/pii-airlock-extension"
          target="_blank"
          rel="noopener"
        >
          <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor" aria-label="GitHub">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
              0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
              -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
              .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
              -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27
              .68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12
              .51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48
              0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        </a>
      </footer>
    </div>
  );
}

export default App;
