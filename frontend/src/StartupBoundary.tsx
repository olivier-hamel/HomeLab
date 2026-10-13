import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { reportStartupError } from "./startup";

export class StartupBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportStartupError("React render error", `${error.stack || error.message}\n${info.componentStack || ""}`);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function StartupReady() {
  useEffect(() => { window.homeLabStartup?.complete(); }, []);
  return null;
}
