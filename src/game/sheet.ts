// The hidden tuning sheet. Generated entirely from DEFS in src/tuning.ts.
import { DEFS, T, changedTuning, resetTuning, saveTuning, type TuneKey } from "../tuning";

export interface SheetHooks {
  onOpen?(): void;
  onClose?(): void;
  onChange?(key: string): void;
  actions?: { label: string; run(): void | Promise<void> }[];
  info?(): string;
}

export interface Sheet {
  open(): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
  setReport(text: string): void;
}

const GROUPS_KEY = "washline.sheet.groups";

const CSS = `
.wl-sheet{position:absolute;top:0;right:0;bottom:0;left:0;box-sizing:border-box;z-index:50;
  background:rgba(12,14,20,.86);color:#e8ecf4;font:13px/1.3 ui-monospace,Menlo,Consolas,monospace;
  overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;touch-action:pan-y;
  overscroll-behavior:contain;pointer-events:none;visibility:hidden;transform:translateY(8%);opacity:0;
  transition:transform .18s ease-out,opacity .18s ease-out,visibility 0s .18s;
  padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.wl-sheet.wl-open{pointer-events:auto;visibility:visible;transform:none;opacity:1;transition:transform .18s ease-out,opacity .18s ease-out}
.wl-sheet *{box-sizing:border-box}
.wl-sheet button{font:inherit;color:inherit;background:#2a3142;border:1px solid #444d66;border-radius:8px;
  min-height:44px;min-width:44px;padding:0 12px;touch-action:manipulation}
.wl-sheet button:active{background:#46517a}
.wl-bar{position:sticky;top:0;z-index:2;display:flex;gap:8px;padding:8px 10px;background:rgba(12,14,20,.96);border-bottom:1px solid #333b52}
.wl-bar button{flex:1}
.wl-bar .wl-warn{background:#7a2d2d;border-color:#c55}
.wl-top{padding:8px 10px}
.wl-actions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
.wl-actions button{flex:1 1 auto}
.wl-sheet pre,.wl-sheet textarea{margin:0 0 8px;padding:8px;background:#05070b;border:1px solid #333b52;border-radius:6px;
  color:#aef;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-all;
  -webkit-user-select:text;user-select:text;width:100%}
.wl-sheet textarea{min-height:96px;display:block;resize:vertical}
.wl-group>.wl-gh{display:flex;align-items:center;width:100%;min-height:48px;padding:0 12px;margin:0;border:0;border-radius:0;
  border-top:1px solid #333b52;background:#1a2030;text-align:left;font-weight:bold;letter-spacing:.04em}
.wl-gh span{flex:1}
.wl-gb{display:none}
.wl-group.wl-gopen>.wl-gb{display:block}
.wl-row{padding:6px 10px 8px;border-top:1px solid #222839;min-height:56px}
.wl-row.wl-ch{background:rgba(255,190,60,.09);border-left:3px solid #fb3;padding-left:7px}
.wl-head{display:flex;align-items:center;gap:6px;min-height:28px}
.wl-lab{flex:1;min-width:0}
.wl-val{font-weight:bold;color:#fff;min-width:3.5em;text-align:right}
.wl-rst{display:none;min-height:32px!important;min-width:32px!important;padding:0 6px!important;color:#fb3}
.wl-ch .wl-rst{display:inline-block}
.wl-ctl{display:flex;align-items:center;gap:6px}
.wl-ctl input[type=range]{flex:1;min-width:0;height:44px;margin:0;touch-action:pan-y}
.wl-seg{display:flex;gap:4px;flex-wrap:wrap}
.wl-seg button{flex:1 1 30%}
.wl-seg button.wl-on{background:#3b6fd8;border-color:#7aa2ff;color:#fff}
`;

function decimals(step: number): number {
  const s = String(step);
  if (s.includes("e-")) return parseInt(s.split("e-")[1], 10);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

function readGroups(): Record<string, boolean> {
  try {
    const o = JSON.parse(localStorage.getItem(GROUPS_KEY) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}
function writeGroups(g: Record<string, boolean>): void {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(g));
  } catch {
    /* ignore */
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string, parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export function createSheet(root: HTMLElement, hooks: SheetHooks = {}): Sheet {
  if (!document.getElementById("wl-sheet-style")) {
    const st = document.createElement("style");
    st.id = "wl-sheet-style";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const panel = el("div", "wl-sheet");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Tuning");
  // The game must never see events aimed at the sheet.
  for (const type of [
    "pointerdown", "pointermove", "pointerup", "pointercancel",
    "touchstart", "touchmove", "touchend", "touchcancel",
    "mousedown", "mouseup", "click", "wheel",
  ]) {
    panel.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
  }

  let isOpen = false;
  let timer = 0;

  // ---- top bar
  const bar = el("div", "wl-bar", undefined, panel);
  const closeBtn = el("button", "", "Close", bar);
  const resetAll = el("button", "", "Reset all", bar);
  const copyBtn = el("button", "", "Copy changes", bar);
  closeBtn.onclick = () => api.close();

  // ---- top area: actions, info, report, copy fallback
  const top = el("div", "wl-top", undefined, panel);
  const actionsBox = el("div", "wl-actions", undefined, top);
  for (const a of hooks.actions ?? []) {
    const b = el("button", "", a.label, actionsBox);
    b.onclick = async () => {
      try {
        await a.run();
      } catch (err) {
        api.setReport(`${a.label} failed: ${String(err)}`);
      }
    };
  }
  if (!hooks.actions?.length) actionsBox.style.display = "none";
  const infoPre = el("pre", "", "", top);
  infoPre.style.display = "none";
  const reportPre = el("pre", "", "", top);
  reportPre.style.display = "none";
  const copyArea = el("textarea", "", "", top);
  copyArea.readOnly = true;
  copyArea.style.display = "none";

  const refreshInfo = () => {
    if (!hooks.info) return;
    let t = "";
    try {
      t = hooks.info();
    } catch (err) {
      t = String(err);
    }
    infoPre.textContent = t;
    infoPre.style.display = t ? "" : "none";
  };

  // ---- reset all with confirm
  let confirmTimer = 0;
  const disarm = () => {
    clearTimeout(confirmTimer);
    confirmTimer = 0;
    resetAll.textContent = "Reset all";
    resetAll.classList.remove("wl-warn");
  };
  resetAll.onclick = () => {
    if (!confirmTimer) {
      resetAll.textContent = "Tap again";
      resetAll.classList.add("wl-warn");
      confirmTimer = window.setTimeout(disarm, 2000);
      return;
    }
    disarm();
    const before = changedTuning();
    resetTuning();
    refreshAll();
    for (const k of Object.keys(before)) hooks.onChange?.(k);
  };

  // ---- copy changes
  let copyLabelTimer = 0;
  copyBtn.onclick = async () => {
    const json = JSON.stringify(changedTuning());
    let ok = false;
    try {
      await navigator.clipboard.writeText(json);
      ok = true;
    } catch {
      /* standalone web apps can refuse */
    }
    if (ok) {
      copyArea.style.display = "none";
      copyBtn.textContent = "Copied";
      clearTimeout(copyLabelTimer);
      copyLabelTimer = window.setTimeout(() => (copyBtn.textContent = "Copy changes"), 1500);
    } else {
      copyArea.value = json;
      copyArea.style.display = "block";
      copyArea.focus();
      copyArea.select();
      copyArea.setSelectionRange(0, json.length);
    }
  };

  // ---- groups & rows, generated from DEFS
  const groupsState = readGroups();
  const refreshers: (() => void)[] = [];
  const groupEls = new Map<string, { box: HTMLElement; body: HTMLElement; arrow: HTMLElement }>();
  const keys = Object.keys(DEFS) as TuneKey[];

  for (const key of keys) {
    const def = DEFS[key] as readonly [number, number, number, number, string, string, (readonly string[])?];
    const [dflt, min, max, stepV, group, label, choices] = def;
    let g = groupEls.get(group);
    if (!g) {
      const box = el("div", "wl-group", undefined, panel);
      const head = el("button", "wl-gh", undefined, box);
      el("span", "", group, head);
      const arrow = el("b", "", "", head);
      const body = el("div", "wl-gb", undefined, box);
      const setOpen = (o: boolean) => {
        box.classList.toggle("wl-gopen", o);
        arrow.textContent = o ? "−" : "+";
      };
      setOpen(groupsState[group] ?? group === "Controls");
      head.onclick = () => {
        const o = !box.classList.contains("wl-gopen");
        setOpen(o);
        groupsState[group] = o;
        writeGroups(groupsState);
      };
      g = { box, body, arrow };
      groupEls.set(group, g);
    }

    const dec = decimals(stepV);
    const fmt = (v: number) => v.toFixed(dec);
    const row = el("div", "wl-row", undefined, g.body);
    const head = el("div", "wl-head", undefined, row);
    el("span", "wl-lab", label, head);
    const valEl = el("span", "wl-val", "", head);
    const rst = el("button", "wl-rst", "↺", head);
    rst.setAttribute("aria-label", `Reset ${label}`);

    const commit = (v: number) => {
      v = Math.min(max, Math.max(min, v));
      v = Number(v.toFixed(Math.max(dec, 6))); // kill float dust from step maths
      if (v === T[key]) return;
      T[key] = v;
      saveTuning();
      refresh();
      hooks.onChange?.(key);
    };

    let refresh: () => void;
    if (choices && choices.length) {
      const seg = el("div", "wl-seg", undefined, row);
      const btns = choices.map((name, i) => {
        const b = el("button", "", name, seg);
        b.onclick = () => commit(min + i * stepV);
        return b;
      });
      refresh = () => {
        const idx = Math.round((T[key] - min) / stepV);
        btns.forEach((b, i) => b.classList.toggle("wl-on", i === idx));
        valEl.textContent = "";
        row.classList.toggle("wl-ch", T[key] !== dflt);
      };
    } else {
      const ctl = el("div", "wl-ctl", undefined, row);
      const minus = el("button", "", "−", ctl);
      const slider = el("input", "", undefined, ctl);
      slider.type = "range";
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String(stepV);
      const plus = el("button", "", "+", ctl);
      minus.onclick = () => commit(T[key] - stepV);
      plus.onclick = () => commit(T[key] + stepV);
      slider.oninput = () => commit(parseFloat(slider.value));
      refresh = () => {
        slider.value = String(T[key]);
        valEl.textContent = fmt(T[key]);
        row.classList.toggle("wl-ch", T[key] !== dflt);
      };
    }
    rst.onclick = () => commit(dflt);
    refreshers.push(() => refresh());
    refresh();
  }

  function refreshAll() {
    for (const r of refreshers) r();
  }

  root.appendChild(panel);

  const api: Sheet = {
    get isOpen() {
      return isOpen;
    },
    open() {
      if (isOpen) return;
      isOpen = true;
      refreshAll();
      refreshInfo();
      panel.classList.add("wl-open");
      timer = window.setInterval(refreshInfo, 500);
      hooks.onOpen?.();
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      panel.classList.remove("wl-open");
      clearInterval(timer);
      disarm();
      hooks.onClose?.();
    },
    toggle() {
      if (isOpen) api.close();
      else api.open();
    },
    setReport(text: string) {
      reportPre.textContent = text;
      reportPre.style.display = text ? "" : "none";
    },
  };
  return api;
}

/**
 * Triple-tap in the top-left 72x72 px corner within 600 ms, the "T" key, or `?tune` in the URL.
 * Listens on window in the capture phase and never calls preventDefault.
 */
export function installSheetGesture(target: HTMLElement, sheet: Sheet): void {
  void target; // window capture is used so the game canvas cannot swallow the taps
  let taps: number[] = [];
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.clientX >= 72 || e.clientY >= 72) {
        taps = [];
        return;
      }
      const now = e.timeStamp || performance.now();
      taps = taps.filter((t) => now - t <= 600);
      taps.push(now);
      if (taps.length >= 3) {
        taps = [];
        if (!sheet.isOpen) sheet.open();
      }
    },
    { capture: true, passive: true },
  );
  window.addEventListener("keydown", (e) => {
    if (e.key !== "t" && e.key !== "T") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    sheet.toggle();
  });
  try {
    if (new URLSearchParams(location.search).has("tune")) sheet.open();
  } catch {
    /* ignore */
  }
}
