import { useEffect, useRef, useState } from "react";
import { downloadModel, isInstalled, removeModel } from "../../lib/ner-model";
import { NER_TOTAL_BYTES } from "../../lib/ner-manifest";
import { MSG } from "../../lib/messages";

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

  return (
    <section className="section">
      <h2>Better name detection</h2>
      <p className="section-desc">
        Finds names the built-in list can miss (any language, unusual surnames). Runs entirely on
        this device. Your messages are never sent anywhere; only the model file is downloaded,
        once, from huggingface.co (pinned version, checksum verified).
      </p>
      {state.kind === "off" && (
        <button className="reset-btn" onClick={install}>
          Download model ({mb(NER_TOTAL_BYTES)})
        </button>
      )}
      {state.kind === "downloading" && (
        <div role="status">
          <progress value={state.loaded} max={NER_TOTAL_BYTES} style={{ width: "100%" }} />
          <div>
            {mb(state.loaded)} / {mb(NER_TOTAL_BYTES)}{" "}
            <button className="reset-btn" onClick={() => abort.current?.abort()}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {state.kind === "on" && (
        <div role="status">
          ✓ Installed ({mb(NER_TOTAL_BYTES)} on disk){" "}
          <button className="reset-btn" onClick={remove}>
            Remove
          </button>
        </div>
      )}
      {state.kind === "error" && (
        <div role="alert">
          Download failed: {state.message}{" "}
          <button className="reset-btn" onClick={install}>
            Retry
          </button>
        </div>
      )}
    </section>
  );
}
