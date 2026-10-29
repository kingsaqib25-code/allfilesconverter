'use client';

/**
 * "Summarize this page with AI" — site-wide GEO widget.
 *
 * Copies a page-specific prompt to the clipboard AND opens the chosen AI.
 * Where a prefill URL pattern is known and safe (ChatGPT, Grok, Perplexity
 * `?q=`), the prompt is prefilled; for Gemini, Copilot, Claude and Meta AI
 * the homepage opens and the copied prompt is the fallback — so it works
 * regardless. Uses the visitor's own account/quota: zero API spend for us.
 */
import { useState } from 'react';

interface AiTarget {
  name: string;
  url: string;
}

const TARGETS: AiTarget[] = [
  { name: 'ChatGPT', url: 'https://chatgpt.com/?q=' },
  { name: 'Gemini', url: 'https://gemini.google.com/' },
  { name: 'Copilot', url: 'https://copilot.microsoft.com/' },
  { name: 'Grok', url: 'https://grok.com/?q=' },
  { name: 'Claude', url: 'https://claude.ai/new' },
  { name: 'Perplexity', url: 'https://www.perplexity.ai/search?q=' },
  { name: 'Meta AI', url: 'https://www.meta.ai/' },
];

/** Targets whose URL pattern safely prefills the prompt. */
const PREFILL = new Set(['ChatGPT', 'Grok', 'Perplexity']);

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* fall through to legacy method */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    /* clipboard unavailable — the AI still opens */
  }
  document.body.removeChild(ta);
}

export default function AiSummarize({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);

  const open = async (t: AiTarget) => {
    await copyText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 3000);
    const url = PREFILL.has(t.name) ? t.url + encodeURIComponent(prompt) : t.url;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="ai-sum" aria-label="Summarize this page with AI">
      <div className="ai-sum-head">
        <span aria-hidden="true">✨</span>
        <strong>Summarize this page with AI:</strong>
        {copied && <span className="ai-sum-copied">Prompt copied — paste it in the chat.</span>}
      </div>
      <div className="ai-sum-btns">
        {TARGETS.map((t) => (
          <button key={t.name} type="button" className="ai-btn" onClick={() => open(t)}>
            {t.name}
          </button>
        ))}
      </div>
      <p className="ai-sum-note">
        Uses your own AI account — the prompt is copied for you, nothing is sent by us.
      </p>
    </div>
  );
}
