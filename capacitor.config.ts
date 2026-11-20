import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "com.talabatmart.firesafety",
  appName: "Fire Safety Management",
  webDir: "dist",
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 900, backgroundColor: "#48101D", showSpinner: false },
    StatusBar: { style: "DARK", backgroundColor: "#48101D" }
  }
};
export default config;
