import type { MetadataRoute } from 'next';
import { CONVERTERS, CATEGORIES } from '@/lib/converters/registry';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticPages = ['', '/all-converters', '/about', '/privacy', '/contact', '/gif-maker', '/tools/bulk-rename'].map((p) => ({
    url: p === '' ? `${SITE_URL}/` : `${SITE_URL}${p}/`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: p === '' ? 1 : 0.7,
  }));
  const categoryPages = CATEGORIES.map((c) => ({
    url: `${SITE_URL}/categories/${c.id}/`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));
  const converterPages = CONVERTERS.map((c) => ({
    url: `${SITE_URL}/convert/${c.id}/`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.9,
  }));
  return [...staticPages, ...categoryPages, ...converterPages];
}
