/**
 * Shared (server-safe) helpers for the "Summarize this page with AI" widget.
 */

export function buildSummaryPrompt(pageUrl: string, toolDesc: string): string {
  return (
    `Summarize this page: ${pageUrl}. ` +
    `In 5 short bullets: what tool is this (${toolDesc}), ` +
    `what does it convert from and to, is it free, ` +
    `do my files get uploaded anywhere, any limits I should know.`
  );
}
