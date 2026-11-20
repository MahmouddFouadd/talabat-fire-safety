import { App as CapApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";

/** Android shell behaviour: status bar, splash, hardware back button. */
export async function initNative() {
  try { await StatusBar.setStyle({ style: Style.Dark }); await StatusBar.setBackgroundColor({ color: "#48101D" }); } catch { /* not supported */ }
  SplashScreen.hide().catch(() => undefined);
  CapApp.addListener("backButton", ({ canGoBack }) => {
    const overlay = document.querySelector(".overlay");
    if (overlay) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return; }
    if (canGoBack && location.hash && !["#/admin", "#/tech"].includes(location.hash)) history.back();
    else CapApp.minimizeApp();
  });
}
