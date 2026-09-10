import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ca.olivierhamel.homelab",
  appName: "HomeLab TV",
  webDir: "dist",
  server: {
    // The first-run screen accepts a user-selected LAN/tailnet host. Once the
    // app reaches that host, the dashboard and /api remain same-origin.
    allowNavigation: ["*"],
  },
};

export default config;
