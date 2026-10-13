declare global {
  interface Window {
    homeLabStartup?: {
      stage(value: string): void;
      fail(kind: string, error: unknown): void;
      complete(): void;
    };
  }
}

export function reportStartupStage(stage: string): void {
  window.homeLabStartup?.stage(stage);
}

export function reportStartupError(kind: string, error: unknown): void {
  window.homeLabStartup?.fail(kind, error);
}
