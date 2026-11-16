// Registers the offline service worker (production only). Never throws, never reloads the page.
export function registerSW(): void {
  try {
    if (!import.meta.env.PROD) return;
    if (!("serviceWorker" in navigator)) return;
    if (new URLSearchParams(location.search).has("nosw")) return;
    const go = () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).then((reg) => {
        // A Home Screen app is resumed far more often than relaunched: look for a new build then.
        document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
      }).catch(() => {});
    };
    if (document.readyState === "complete") go(); else addEventListener("load", go, { once: true });
  } catch { /* ignore */ }
}
