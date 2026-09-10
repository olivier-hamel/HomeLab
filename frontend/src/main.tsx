import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource-variable/geist-mono/wght.css";
import "./styles.css";
import { readTvMode, TvModeContext } from "./lib/tv";
import { installAbortSignalFallbacks } from "./lib/browser-compat";
import { installNativeLifecycle, isNativeApp, prepareNativeApp } from "./native";
import NativeServerSetup from "./NativeServerSetup";
import { reportStartupError, reportStartupStage } from "./startup";
import { StartupBoundary, StartupReady } from "./StartupBoundary";

async function bootstrap() {
  reportStartupStage("JavaScript loaded; installing browser fallbacks");
  installAbortSignalFallbacks();
  reportStartupStage("Preparing the native bridge");
  const nativeState = await prepareNativeApp(reportStartupStage);
  if (nativeState === "redirecting") return;
  const nativeApp = isNativeApp();
  const tvMode = nativeApp || readTvMode();
  if (tvMode) document.documentElement.dataset.tvMode = "true";
  if (nativeApp) document.documentElement.dataset.nativeApp = "true";
  reportStartupStage("Installing native lifecycle listeners");
  installNativeLifecycle();
  reportStartupStage(`Rendering React (${nativeState})`);
  createRoot(document.getElementById("root")!, {
    onUncaughtError: error => reportStartupError("React uncaught error", error),
  }).render(
    <StrictMode>
      <StartupBoundary>
        {nativeState === "setup" ? <NativeServerSetup /> : <TvModeContext.Provider value={tvMode}><App /></TvModeContext.Provider>}
        <StartupReady />
      </StartupBoundary>
    </StrictMode>,
  );
}

void bootstrap().catch(error => reportStartupError("Bootstrap failed", error));
