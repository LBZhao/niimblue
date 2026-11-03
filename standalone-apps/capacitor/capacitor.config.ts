import { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.github.lbzhao.niimblue",
  appName: "NiimBlue LZ",
  webDir: "www",
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
    // The app is always dark: light status bar and gesture bar icons.
    SystemBars: {
      style: "DARK",
    },
  },
  android: {
    buildOptions: {
      releaseType: "APK",
      keystorePath: process.env.KEYSTORE_PATH,
      keystorePassword: process.env.KEYSTORE_PASSWORD,
      keystoreAlias: process.env.KEYSTORE_ALIAS,
      keystoreAliasPassword: process.env.KEYSTORE_ALIAS_PASSWORD,
      signingType: "apksigner",
    },
  },
  ios: {
    scheme: "NiimBlues",
  },
};

export default config;
