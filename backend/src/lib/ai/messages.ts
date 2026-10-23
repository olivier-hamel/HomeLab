// Old persisted scan failures may still contain provider or model diagnostics.
// Normalize only technical errors; document titles, notes and contents stay intact.
export function publicAnalysisError(message: string): string {
  return /gemini|openai|gpt-\d|google ai studio/i.test(message)
    ? "L’analyse n’a pas pu être terminée. Ton document est conservé; relance le scan."
    : message;
}
