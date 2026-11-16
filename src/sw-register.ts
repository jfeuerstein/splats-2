// Registers the offline service worker (production only). Never throws, never reloads the page.
export function registerSW(): void {
  try {
    if (!import.meta.env.PROD) return;
    if (!("serviceWorker" in navigator)) return;
    if (new URLSearchParams(location.search).has("nosw")) return;
    const go = () => { navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {}); };
    if (document.readyState === "complete") go(); else addEventListener("load", go, { once: true });
  } catch { /* ignore */ }
}
