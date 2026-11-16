// Menus and in-run chrome for Washline. Plain DOM, one injected <style>, no assets.

export interface RunCard { id: string; name: string; idea: string; best: number; plays: number }
export interface UiHooks {
  onPick(index: number): void;
  onRestart(): void;
  onMenu(): void;
  onTap?(): void;
}
export interface Ui {
  setPixelScale(cssPxPerGamePx: number): void;
  showMenu(cards: RunCard[], selected: number): void;
  hideMenu(): void;
  showRun(name: string, hint: string): void;
  hideHint(): void;
  hideRun(): void;
  setFill(fill: number): void;
  showResult(r: { name: string; fill: number; best: number; isBest: boolean; hasNext: boolean }): void;
  hideResult(): void;
  toast(text: string): void;
  readonly menuOpen: boolean;
  readonly resultOpen: boolean;
}

const RUN_COLORS = ['#d9623b', '#f0a23a', '#5fb56a', '#2f9c95', '#3b6fc4', '#e0568c'];
const CELLS = 10;

const CSS = `
.wl{position:absolute;inset:0;pointer-events:none;overflow:hidden;color:#2b2a4a;text-transform:uppercase;letter-spacing:.08em;
  font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700;line-height:1.2;
  --st:env(safe-area-inset-top,0px);--sb:env(safe-area-inset-bottom,0px);--sl:env(safe-area-inset-left,0px);--sr:env(safe-area-inset-right,0px)}
.wl *{box-sizing:border-box;margin:0;padding:0;border-radius:0;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
.wl .hid{visibility:hidden;opacity:0;pointer-events:none!important;transition:opacity .15s steps(3),visibility 0s .15s}
.wl .btn{pointer-events:auto;cursor:pointer;touch-action:manipulation}

/* picker */
.wl .menu{position:absolute;inset:0;background:rgba(244,239,230,.3);display:flex;flex-direction:column;pointer-events:auto;
  padding:calc(var(--st) + var(--px)*6) calc(var(--sr) + var(--px)*8) calc(var(--sb) + var(--px)*5) calc(var(--sl) + var(--px)*8);
  overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;transition:opacity .15s steps(3),visibility 0s}
.wl .menu.hid{transition:opacity .15s steps(3),visibility 0s .15s}
.wl .title{font-size:calc(var(--px)*13);letter-spacing:.2em;text-align:center;color:#2b2a4a;text-shadow:calc(var(--px)*1) calc(var(--px)*1) 0 #d9623b;margin-right:-.2em;flex:none}
.wl .sub{font-size:calc(var(--px)*5);letter-spacing:.3em;text-align:center;color:#2b2a4a;opacity:.7;margin:calc(var(--px)*2) 0 calc(var(--px)*6);flex:none}
.wl .list{display:flex;flex-direction:column;gap:calc(var(--px)*4);flex:1 0 auto}
.wl .card{flex:1 0 64px;max-height:calc(var(--px)*46);min-height:64px;background:#f4efe6;border:calc(var(--px)*1) solid #c9c6c4;
  box-shadow:calc(var(--px)*1.5) calc(var(--px)*1.5) 0 #c9c6c4;padding:calc(var(--px)*4) calc(var(--px)*5);display:flex;flex-direction:column;justify-content:center;gap:calc(var(--px)*1.5);touch-action:pan-y}
.wl .card.sel{border-color:#2b2a4a;box-shadow:calc(var(--px)*1.5) calc(var(--px)*1.5) 0 #2b2a4a}
.wl .card:active{transform:translate(calc(var(--px)*1),calc(var(--px)*1))}
.wl .row1{display:flex;align-items:baseline;gap:calc(var(--px)*3)}
.wl .num{font-size:calc(var(--px)*7);color:#a9aab3}
.wl .nm{font-size:calc(var(--px)*7.5);white-space:nowrap;overflow:hidden;text-overflow:clip}
.wl .idea{font-size:calc(var(--px)*5.5);letter-spacing:.04em;opacity:.8;font-weight:400;text-transform:none;white-space:nowrap;overflow:hidden}
.wl .row3{display:flex;align-items:center;gap:calc(var(--px)*3);margin-top:calc(var(--px)*1)}
.wl .pct{font-size:calc(var(--px)*6);min-width:calc(var(--px)*16);text-align:right;margin-left:auto}
.wl .pct.new{color:#2f9c95}
.wl .bar{display:flex;gap:calc(var(--px)*1);flex:none}
.wl .cell{width:calc(var(--px)*5);height:calc(var(--px)*5);background:#e3dccf}
.wl .bar.big .cell{width:calc(var(--px)*8);height:calc(var(--px)*8)}
.wl .foot{flex:none;text-align:center;font-size:calc(var(--px)*4.5);letter-spacing:.14em;opacity:.7;margin-top:calc(var(--px)*6)}

/* in-run */
.wl .rbtns{position:absolute;top:calc(var(--st) + var(--px)*4);right:calc(var(--sr) + var(--px)*4);display:flex;gap:calc(var(--px)*3)}
.wl .rb{width:44px;height:44px;display:flex;align-items:center;justify-content:center}
.wl .rb i{display:flex;align-items:center;justify-content:center;width:calc(var(--px)*16);height:calc(var(--px)*16);min-width:34px;min-height:34px;
  background:rgba(244,239,230,.78);border:calc(var(--px)*1) solid #2b2a4a;font-style:normal;font-size:calc(var(--px)*10);line-height:1;letter-spacing:0}
.wl .rb:active i{background:#f7d354}
.wl .fill{position:absolute;top:calc(var(--st) + var(--px)*7);right:calc(50% + var(--px)*8);font-size:calc(var(--px)*8);
  background:rgba(244,239,230,.7);padding:calc(var(--px)*1.5) calc(var(--px)*3);min-width:calc(var(--px)*22);text-align:right;letter-spacing:.04em}
.wl .hint{position:absolute;left:0;right:0;bottom:max(9%,calc(var(--sb) + 40px));display:flex;justify-content:center;padding:0 calc(var(--px)*10);transition:opacity .3s linear}
.wl .hint.hid{transition:opacity .3s linear,visibility 0s .3s}
.wl .plate{background:#f4efe6;border:calc(var(--px)*1) solid #2b2a4a;box-shadow:calc(var(--px)*1.5) calc(var(--px)*1.5) 0 #2b2a4a;padding:calc(var(--px)*3) calc(var(--px)*5);text-align:center;max-width:100%}
.wl .hn{font-size:calc(var(--px)*5);letter-spacing:.2em;color:#a9aab3;color:#8a4a3c}
.wl .ht{font-size:calc(var(--px)*6);margin-top:calc(var(--px)*1)}

/* toast */
.wl .toast{position:absolute;left:0;right:0;top:calc(var(--st) + var(--px)*30);display:flex;justify-content:center}
.wl .toast .plate{background:#f7d354;font-size:calc(var(--px)*6)}

/* result */
.wl .res{position:absolute;left:calc(var(--sl) + var(--px)*8);right:calc(var(--sr) + var(--px)*8);bottom:calc(var(--sb) + var(--px)*8);pointer-events:auto;
  background:#f4efe6;border:calc(var(--px)*1.5) solid #2b2a4a;box-shadow:calc(var(--px)*2) calc(var(--px)*2) 0 #2b2a4a;padding:calc(var(--px)*6);
  display:flex;flex-direction:column;align-items:center;gap:calc(var(--px)*3);transition:opacity .15s steps(3),visibility 0s}
.wl .res.hid{transition:opacity .15s steps(3),visibility 0s .15s}
.wl .rname{font-size:calc(var(--px)*5.5);letter-spacing:.2em;color:#8a4a3c}
.wl .big{font-size:calc(var(--px)*22);line-height:1;letter-spacing:.02em;text-shadow:calc(var(--px)*1.5) calc(var(--px)*1.5) 0 #f0a23a}
.wl .best{font-size:calc(var(--px)*6);padding:calc(var(--px)*1.5) calc(var(--px)*4);background:#e3dccf}
.wl .best.nb{background:#f7d354}
.wl .btns{display:flex;flex-direction:column;gap:calc(var(--px)*3);width:100%;margin-top:calc(var(--px)*2)}
.wl .b{display:flex;align-items:center;justify-content:center;min-height:52px;font-size:calc(var(--px)*7);border:calc(var(--px)*1) solid #2b2a4a;background:#e3dccf;
  box-shadow:calc(var(--px)*1.5) calc(var(--px)*1.5) 0 #2b2a4a;width:100%}
.wl .b:active{transform:translate(calc(var(--px)*1),calc(var(--px)*1));box-shadow:calc(var(--px)*.5) calc(var(--px)*.5) 0 #2b2a4a}
.wl .b.pri{min-height:60px;background:#d9623b;color:#ffffff;font-size:calc(var(--px)*9);text-shadow:calc(var(--px)*1) calc(var(--px)*1) 0 #2b2a4a}
.wl .b.nxt{background:#5fb56a}
`;

export function createUi(root: HTMLElement, hooks: UiHooks): Ui {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const el = (cls: string, tag = 'div', text?: string): HTMLElement => {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const wl = el('wl');
  wl.style.setProperty('--px', '2px');
  root.appendChild(wl);

  let lastAct = 0;
  /** Activate on pointerup (down and up on the same element), guarded against double fire. */
  function bind(target: HTMLElement, fn: () => void): void {
    let armed = false;
    target.addEventListener('pointerdown', (e) => { e.stopPropagation(); armed = true; });
    target.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    target.addEventListener('pointercancel', () => { armed = false; });
    target.addEventListener('pointerleave', () => { armed = false; });
    target.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      if (!armed) return;
      armed = false;
      const now = performance.now();
      if (now - lastAct < 350) return;
      lastAct = now;
      hooks.onTap?.();
      fn();
    });
  }

  function makeBar(big = false): { bar: HTMLElement; cells: HTMLElement[] } {
    const bar = el(big ? 'bar big' : 'bar');
    const cells: HTMLElement[] = [];
    for (let i = 0; i < CELLS; i++) { const c = el('cell'); bar.appendChild(c); cells.push(c); }
    return { bar, cells };
  }
  function paintBar(cells: HTMLElement[], frac: number, color: string): void {
    const n = Math.round(Math.max(0, Math.min(1, frac)) * CELLS);
    for (let i = 0; i < cells.length; i++) cells[i].style.background = i < n ? color : '';
  }
  const pctText = (f: number): string => Math.round(Math.max(0, Math.min(1, f)) * 100) + '%';

  // ---- picker
  const menu = el('menu hid');
  const title = el('title', 'div', 'WASHLINE');
  const sub = el('sub', 'div', 'FILL THE STREETS');
  const list = el('list');
  const foot = el('foot', 'div', 'HOLD TO SWING · LET GO TO FLY');
  menu.append(title, sub, list, foot);
  wl.appendChild(menu);
  interface CardView { root: HTMLElement; num: HTMLElement; nm: HTMLElement; idea: HTMLElement; cells: HTMLElement[]; pct: HTMLElement }
  const cardViews: CardView[] = [];
  let menuOpen = false;

  function ensureCard(i: number): CardView {
    let v = cardViews[i];
    if (v) return v;
    const root = el('card btn');
    const row1 = el('row1');
    const num = el('num');
    const nm = el('nm');
    row1.append(num, nm);
    const idea = el('idea');
    const row3 = el('row3');
    const { bar, cells } = makeBar();
    const pct = el('pct');
    row3.append(bar, pct);
    root.append(row1, idea, row3);
    list.appendChild(root);
    bind(root, () => { if (menuOpen) hooks.onPick(i); });
    v = { root, num, nm, idea, cells, pct };
    cardViews[i] = v;
    return v;
  }

  // ---- in-run
  const rbtns = el('rbtns hid');
  const bRestart = el('rb btn', 'div');
  bRestart.setAttribute('role', 'button');
  bRestart.setAttribute('aria-label', 'Restart');
  bRestart.appendChild(el('', 'i', '↻'));
  const bMenu = el('rb btn', 'div');
  bMenu.setAttribute('role', 'button');
  bMenu.setAttribute('aria-label', 'Runs');
  bMenu.appendChild(el('', 'i', '≡'));
  rbtns.append(bRestart, bMenu);
  bind(bRestart, () => hooks.onRestart());
  bind(bMenu, () => hooks.onMenu());
  const fillEl = el('fill hid', 'div', '0%');
  const hint = el('hint hid');
  const hintPlate = el('plate');
  const hn = el('hn');
  const ht = el('ht');
  hintPlate.append(hn, ht);
  hint.appendChild(hintPlate);
  const toastEl = el('toast hid');
  const toastPlate = el('plate');
  toastEl.appendChild(toastPlate);
  wl.append(rbtns, fillEl, hint, toastEl);

  let lastFill = -1;
  let toastTimer = 0;

  // ---- result
  const res = el('res hid');
  const rName = el('rname');
  const rBig = el('big');
  const { bar: rBar, cells: rCells } = makeBar(true);
  const rBest = el('best');
  const btns = el('btns');
  const bAgain = el('b pri btn', 'div', 'AGAIN');
  const bNext = el('b nxt btn', 'div', 'NEXT RUN');
  const bRuns = el('b btn', 'div', 'RUNS');
  btns.append(bAgain, bNext, bRuns);
  res.append(rName, rBig, rBar, rBest, btns);
  wl.appendChild(res);
  let resultOpen = false;
  bind(bAgain, () => { if (resultOpen) hooks.onRestart(); });
  bind(bNext, () => { if (resultOpen) hooks.onPick(-1); });
  bind(bRuns, () => { if (resultOpen) hooks.onMenu(); });

  const ui: Ui = {
    setPixelScale(n: number) {
      wl.style.setProperty('--px', (n > 0 ? n : 2) + 'px');
    },
    showMenu(cards, selected) {
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const v = ensureCard(i);
        const color = RUN_COLORS[i % RUN_COLORS.length];
        v.num.textContent = String(i + 1);
        v.nm.textContent = c.name;
        v.idea.textContent = c.idea;
        const played = c.plays > 0 && c.best > 0;
        paintBar(v.cells, played ? c.best : 0, color);
        v.pct.textContent = played ? pctText(c.best) : 'NEW';
        v.pct.classList.toggle('new', !played);
        v.root.classList.toggle('sel', i === selected);
      }
      for (let i = cards.length; i < cardViews.length; i++) cardViews[i].root.style.display = 'none';
      for (let i = 0; i < cards.length; i++) cardViews[i].root.style.display = '';
      menu.scrollTop = 0;
      menuOpen = true;
      menu.classList.remove('hid');
    },
    hideMenu() { menuOpen = false; menu.classList.add('hid'); },
    showRun(name, text) {
      hn.textContent = name;
      ht.textContent = text;
      rbtns.classList.remove('hid');
      fillEl.classList.remove('hid');
      hint.classList.remove('hid');
      lastFill = -1;
      ui.setFill(0);
    },
    hideHint() { hint.classList.add('hid'); },
    hideRun() {
      rbtns.classList.add('hid');
      fillEl.classList.add('hid');
      hint.classList.add('hid');
    },
    setFill(f) {
      const n = Math.round(Math.max(0, Math.min(1, f)) * 100);
      if (n === lastFill) return;
      lastFill = n;
      fillEl.textContent = n + '%';
    },
    showResult(r) {
      rName.textContent = r.name;
      rBig.textContent = pctText(r.fill);
      const idx = Math.max(0, cardViews.findIndex((v) => v.nm.textContent === r.name));
      paintBar(rCells, r.fill, RUN_COLORS[idx % RUN_COLORS.length]);
      rBest.textContent = r.isBest ? 'NEW BEST' : 'BEST ' + pctText(r.best);
      rBest.classList.toggle('nb', r.isBest);
      bNext.style.display = r.hasNext ? '' : 'none';
      resultOpen = true;
      res.classList.remove('hid');
    },
    hideResult() { resultOpen = false; res.classList.add('hid'); },
    toast(text) {
      toastPlate.textContent = text;
      toastEl.classList.remove('hid');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toastEl.classList.add('hid'), 2000);
    },
    get menuOpen() { return menuOpen; },
    get resultOpen() { return resultOpen; },
  };
  return ui;
}
