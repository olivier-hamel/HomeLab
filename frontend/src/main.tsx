import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource-variable/geist-mono/wght.css";
import "./styles.css";
import { readTvMode, TvModeContext } from "./lib/tv";
import { installAbortSignalFallbacks } from "./lib/browser-compat";
import { installNativeLifecycle, isNativeApp, prepareNativeApp } from "./native";
import NativeServerSetup from "./NativeServerSetup";

installAbortSignalFallbacks();

async function bootstrap() {
  const nativeState = await prepareNativeApp();
  if (nativeState === "redirecting") return;
  const nativeApp = isNativeApp();
  const tvMode = nativeApp || readTvMode();
  if (tvMode) document.documentElement.dataset.tvMode = "true";
  if (nativeApp) document.documentElement.dataset.nativeApp = "true";
  installNativeLifecycle();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {nativeState === "setup" ? <NativeServerSetup /> : <TvModeContext.Provider value={tvMode}><App /></TvModeContext.Provider>}
    </StrictMode>,
  );
}

void bootstrap();
