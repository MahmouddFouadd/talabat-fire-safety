import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "com.talabatmart.firesafety",
  appName: "Fire Safety Management",
  webDir: "dist",
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 900, backgroundColor: "#12302B", showSpinner: false },
    StatusBar: { style: "DARK", backgroundColor: "#12302B" }
  }
};
export default config;
