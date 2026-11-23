import { App as CapApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { supabase } from "./supabase";

/** Android shell behaviour: status bar, splash, hardware back button. */
export async function initNative() {
  try { await StatusBar.setStyle({ style: Style.Dark }); await StatusBar.setBackgroundColor({ color: "#12302B" }); } catch { /* not supported */ }
  SplashScreen.hide().catch(() => undefined);
  // The Android WebView can be frozen in the background, so the token timer misses its slot.
  // Renew the session as soon as the app is back in front instead of on the next failed request.
  CapApp.addListener("appStateChange", ({ isActive }) => {
    if (isActive) supabase.auth.startAutoRefresh().catch(() => undefined);
    else supabase.auth.stopAutoRefresh().catch(() => undefined);
  });
  CapApp.addListener("backButton", ({ canGoBack }) => {
    const overlay = document.querySelector(".overlay");
    if (overlay) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return; }
    if (canGoBack && location.hash && !["#/admin", "#/tech"].includes(location.hash)) history.back();
    else CapApp.minimizeApp();
  });
}
