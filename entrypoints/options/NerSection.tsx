import { useEffect, useRef, useState } from "react";
import { downloadModel, isInstalled, removeModel } from "../../lib/ner-model";
import { NER_TOTAL_BYTES } from "../../lib/ner-manifest";
import { MSG } from "../../lib/messages";
import { t } from "../../lib/i18n";

const mb = (n: number) => `${Math.round(n / 1e6)} MB`;

type State =
  | { kind: "checking" }
  | { kind: "off" }
  | { kind: "downloading"; loaded: number }
  | { kind: "on" }
  | { kind: "error"; message: string };

/** Opt-in "better name detection". Nothing is requested until the user clicks. */
export default function NerSection() {
  const [state, setState] = useState<State>({ kind: "checking" });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    isInstalled().then((ok) => setState({ kind: ok ? "on" : "off" }));
  }, []);

  const notify = () => browser.runtime.sendMessage({ type: MSG.NER_RESET }).catch(() => {});

  async function install() {
    abort.current = new AbortController();
    setState({ kind: "downloading", loaded: 0 });
    try {
      await downloadModel((p) => setState({ kind: "downloading", loaded: p.loaded }), {
        signal: abort.current.signal,
      });
      // Ask the browser not to evict a 180 MB cache under storage pressure.
      void navigator.storage?.persist?.();
      setState({ kind: "on" });
      await notify();
    } catch (e) {
      const aborted = abort.current?.signal.aborted;
      setState(aborted ? { kind: "off" } : { kind: "error", message: (e as Error).message });
    }
  }

  async function remove() {
    await removeModel();
    setState({ kind: "off" });
    await notify();
  }

  const size = mb(NER_TOTAL_BYTES);
  return (
    <section>
      <h2>{t("nerTitle")}</h2>
      <p className="desc">{t("nerDesc")}</p>
      <div className="group pad">
        {state.kind === "off" && (
          <button className="btn primary" onClick={install}>{t("nerDownload", size)}</button>
        )}
        {state.kind === "downloading" && (
          <div role="status" className="ner-row">
            <progress value={state.loaded} max={NER_TOTAL_BYTES} aria-label={t("nerTitle")} />
            <span className="num">{mb(state.loaded)} / {size}</span>
            <button className="btn" onClick={() => abort.current?.abort()}>{t("nerCancel")}</button>
          </div>
        )}
        {state.kind === "on" && (
          <div role="status" className="ner-row">
            <span className="dot ok" aria-hidden="true" />
            <span className="grow">{t("nerInstalled", size)}</span>
            <button className="btn" onClick={remove}>{t("nerRemove")}</button>
          </div>
        )}
        {state.kind === "error" && (
          <div role="alert" className="ner-row">
            <span className="dot warn" aria-hidden="true" />
            <span className="grow">{t("nerFailed", state.message)}</span>
            <button className="btn" onClick={install}>{t("nerRetry")}</button>
          </div>
        )}
        {state.kind === "checking" && <span className="empty">…</span>}
      </div>
    </section>
  );
}
