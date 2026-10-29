/**
 * JSON-LD structured-data builders (SEO + AEO + GEO).
 * Rendered as <script type="application/ld+json"> in server pages.
 */
import { SITE_URL } from './site';
import { BRAND, TAGLINE, type Faq } from './converters/registry';

export function ldScript(data: unknown): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, '\\u003c') };
}

export interface WebAppData {
  id: string;
  title: string;
  description: string;
}

export function webApplicationJsonLd(d: WebAppData, urlPath: string): unknown {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: d.title,
    url: `${SITE_URL}${urlPath}`,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires a modern browser with WebAssembly support',
    description: `${d.description} Free forever, no sign-up. Your files never leave your device.`,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    isAccessibleForFree: true,
  };
}

export function faqPageJsonLd(faqs: Faq[]): unknown {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]): unknown {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function websiteOrgJsonLd(): unknown[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: BRAND,
      url: `${SITE_URL}/`,
      description: TAGLINE,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: BRAND,
      url: `${SITE_URL}/`,
      description: TAGLINE,
    },
  ];
}

export function howToJsonLd(name: string, description: string, steps: { name: string; text: string }[], url: string): unknown {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name,
    description,
    totalTime: 'PT2M',
    step: steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
      url: `${url}#step-${i + 1}`,
    })),
  };
}
