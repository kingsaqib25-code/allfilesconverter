import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-static';

/**
 * AI crawlers are explicitly welcome: the whole site (tools, llms.txt,
 * llms-full.txt, structured data) is built so assistants like ChatGPT,
 * Copilot, Grok, Claude, Perplexity, Bing and Apple AI can understand it.
 * Nothing AI-related is disallowed anywhere.
 */
const AI_CRAWLERS = [
  'GPTBot', // OpenAI crawler
  'ChatGPT-User', // ChatGPT user browsing
  'ClaudeBot', // Anthropic crawler
  'Claude-Web', // Anthropic user browsing
  'PerplexityBot', // Perplexity AI
  'Applebot', // Apple Search
  'Applebot-Extended', // Apple AI training
  'Google-Extended', // Google AI training
  'Bingbot', // Bing / Copilot
  'Bytespider', // TikTok/ByteDance AI
  'CCBot', // Common Crawl (AI training data)
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/' },
      ...AI_CRAWLERS.map((ua) => ({ userAgent: ua, allow: '/' })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
