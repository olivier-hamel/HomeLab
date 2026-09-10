import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource-variable/geist-mono/wght.css";
import "./styles.css";
import { readTvMode, TvModeContext } from "./lib/tv";
import { installAbortSignalFallbacks } from "./lib/browser-compat";

installAbortSignalFallbacks();
const tvMode = readTvMode();
if (tvMode) document.documentElement.dataset.tvMode = "true";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TvModeContext.Provider value={tvMode}><App /></TvModeContext.Provider>
  </StrictMode>,
);
