/**
 * Shared (server-safe) helpers for the in-page "Summarize with AI" panel.
 *
 * The panel only ever receives the page's PUBLIC summary text (title,
 * description, TL;DR, about paragraphs). User files are never included.
 */

/** Compose the public summary text handed to the AI for one converter page. */
export function buildConverterSummaryText(opts: {
  title: string;
  description: string;
  from: string;
  to: string;
  aboutFrom: string;
  aboutTo: string;
  loadingNote?: string | null;
}): string {
  const parts = [
    `${opts.title}.`,
    opts.description,
    `TL;DR: Drop a ${opts.from} file, get a ${opts.to} file back in seconds. Free forever, no sign-up — and your file never leaves your device because the conversion runs in your browser.`,
    `About ${opts.from}: ${opts.aboutFrom}`,
    `About ${opts.to}: ${opts.aboutTo}`,
  ];
  if (opts.loadingNote) {
    parts.push(`Note: first use downloads a ~30 MB converter engine (one time); after that it is instant.`);
  }
  return parts.join(' ');
}
