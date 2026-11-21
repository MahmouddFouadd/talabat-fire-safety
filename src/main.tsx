import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import { Capacitor } from "@capacitor/core";
import App from "./App";
import { I18nProvider } from "./lib/i18n";
import { AuthProvider } from "./lib/auth";
import { ToastProvider } from "./components/ui";
import "./index.css";

const theme = localStorage.getItem("fs-theme");
if (theme) document.documentElement.setAttribute("data-theme", theme);

// After a new deploy, a page opened earlier may ask for an old JS chunk that no longer exists (404).
// Reload once to pick up the new index.html instead of showing a broken screen. Drafts live in IndexedDB, so nothing is lost.
window.addEventListener("vite:preloadError", (e) => {
  const KEY = "fs-chunk-reload";
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 30_000) return;           // already tried: let the error show instead of looping
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* storage blocked: still try once */ }
  e.preventDefault();
  window.location.reload();
});

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } } });

if (Capacitor.isNativePlatform()) {
  import("./lib/native").then((m) => m.initNative());
} else {
  // PWA: prompt-based update so a technician never loses a half-filled form to a silent reload
  const update = registerSW({
    onNeedRefresh() { if (confirm(document.documentElement.lang === "ar" ? "فيه تحديث جديد. تحدّث دلوقتي؟" : "A new version is available. Update now?")) update(true); },
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider><App /></AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>
);
