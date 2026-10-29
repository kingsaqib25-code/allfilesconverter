/**
 * Central converter registry for All Files Converter.
 *
 * Every converter on the site is one entry here. Adding a new converter =
 * 1. write its convert() implementation (new file under src/lib/converters/),
 * 2. add one entry below.
 *
 * A future video/audio module (ffmpeg.wasm) plugs in exactly this way:
 * new file src/lib/converters/media.ts + new entries referencing it.
 * Nothing else in the app needs to change — pages, sitemap and the
 * homepage widget are all generated from this registry.
 *
 * All convert() functions run 100% on-device in the visitor's browser
 * (File/Blob/Canvas/WebAssembly). No uploads, no API routes, no server.
 */

import { convertImage } from './image';
import { convertHeic } from './heic';
import {
  mdToHtml,
  txtToMd,
  htmlToTxt,
  csvToJson,
  jsonToCsv,
  jsonToYaml,
  yamlToJson,
  tomlToJson,
  xmlToJson,
} from './text';
import { convertSubtitle, type SubExt } from './subtitle';

export type Category = 'image' | 'text' | 'data' | 'subtitle' | 'video' | 'audio' | 'pdf';

/** Per-conversion options forwarded from the widget (quality sliders etc.). */
export type ConvertOptions = Record<string, string | number>;

/** Declarative widget control rendered above the Convert button. */
export interface OptionDef {
  id: string;
  label: string;
  type: 'slider' | 'select';
  min?: number;
  max?: number;
  step?: number;
  default: string | number;
  choices?: { value: string; label: string }[];
  hint?: string;
}

export const IMAGE_QUALITY_OPTION: OptionDef = {
  id: 'quality',
  label: 'Quality',
  type: 'slider',
  min: 1,
  max: 100,
  default: 92,
  hint: 'Lower = smaller file',
};

export const VIDEO_CRF_OPTION: OptionDef = {
  id: 'crf',
  label: 'Quality',
  type: 'select',
  default: '23',
  choices: [
    { value: '18', label: 'High quality (larger file)' },
    { value: '23', label: 'Balanced' },
    { value: '28', label: 'Small file' },
  ],
};

export const AUDIO_BITRATE_OPTION: OptionDef = {
  id: 'bitrate',
  label: 'Bitrate',
  type: 'select',
  default: '192k',
  choices: [
    { value: '128k', label: '128 kbps — smaller file' },
    { value: '192k', label: '192 kbps — balanced' },
    { value: '320k', label: '320 kbps — best quality' },
  ],
};

export interface Faq {
  q: string;
  a: string;
}

export interface ConvertResult {
  blob: Blob;
  filename: string;
}

export interface ConverterEntry {
  id: string; // e.g. 'heic-to-jpg' — also the /convert/[pair]/ URL slug
  from: string; // 'HEIC'
  to: string; // 'JPG'
  fromExts: string[]; // ['heic', 'heif']
  toExt: string; // 'jpg'
  category: Category;
  title: string; // 'HEIC to JPG Converter'
  description: string; // 1-2 unique lines, used for meta description
  faqs: Faq[]; // 3 base; flagship pages carry 6-8
  /** Optional for entries with a custom widget (pdf/merge) that calls module functions directly. */
  convert?: (file: File, opts?: ConvertOptions) => Promise<ConvertResult>;
  /** Declarative option controls rendered by the widget (quality slider etc.). */
  options?: OptionDef[];
  /** Which widget renders this entry: default single-file, pdf (custom PDF UI), merge (multi-file). */
  widget?: 'default' | 'pdf' | 'merge' | 'edit';
  /** Extra categories this converter is listed under (one page, linked from each). */
  alsoIn?: Category[];
  /** Shown while a heavy engine (ffmpeg.wasm) initializes. */
  loadingNote?: string;
  /** "When to use this conversion" section (every page). */
  useCases: string[];
  /** Flagship SEO+AEO+GEO treatment: expanded FAQs, use cases, HowTo schema. */
  flagship?: boolean;
  /** 1-2 lines: what the SOURCE format is (unique per page). */
  aboutFrom: string;
  /** 1-2 lines: what the TARGET format is (unique per page). */
  aboutTo: string;
  /** One practical tip for this exact conversion. */
  tip: string;
}

export interface CategoryMeta {
  id: Category;
  name: string;
  tagline: string;
  description: string;
}

export const BRAND = 'All Files Converter';
export const TAGLINE = 'Free file converter. Your files never leave your device.';

export const CATEGORIES: CategoryMeta[] = [
  {
    id: 'pdf',
    name: 'PDF Converters',
    tagline: 'Convert PDF to JPG, JPG to PDF, merge, split and compress PDFs.',
    description:
      'Free online PDF tools that run entirely in your browser. Turn JPG, PNG, WebP, GIF, BMP and HEIC images, TXT, Markdown and CSV files into PDF documents — or convert PDF to JPG/PNG images, merge, split, compress and edit PDFs, and extract text — your documents are never uploaded anywhere.',
  },
  {
    id: 'image',
    name: 'Image Converters',
    tagline: 'Convert photos and graphics between PNG, JPG, WebP, AVIF, HEIC and more.',
    description:
      'Free online image converters that run entirely in your browser. Change PNG to JPG, WebP to PNG, HEIC to JPG and more — including PNG to PDF, JPG to PDF, WebP to PDF, GIF to PDF, BMP to PDF and HEIC to PDF for documents — your photos are never uploaded anywhere.',
  },
  {
    id: 'text',
    name: 'Text Converters',
    tagline: 'Turn Markdown into HTML, strip HTML to plain text, and more.',
    description:
      'Free online text converters. Convert Markdown to a styled HTML page, extract clean text from HTML, turn plain text into Markdown — or save TXT and Markdown files as PDF documents — all on your device.',
  },
  {
    id: 'data',
    name: 'Data Converters',
    tagline: 'Swap between JSON, CSV, YAML, TOML and XML in one click.',
    description:
      'Free online data-format converters for developers and analysts. Convert JSON to CSV, CSV to JSON, JSON to YAML, YAML to JSON, TOML to JSON and XML to JSON — or turn a CSV spreadsheet into a printable PDF table — parsed locally, never uploaded.',
  },
  {
    id: 'subtitle',
    name: 'Subtitle Converters',
    tagline: 'Convert subtitle files between SRT, WebVTT, ASS and SSA.',
    description:
      'Free online subtitle converters. Switch SRT to WebVTT for the web, to ASS for styled karaoke subtitles, or between any of SRT, VTT, ASS and SSA — all in your browser.',
  },
  {
    id: 'video',
    name: 'Video Converters',
    tagline: 'Convert MP4, MOV, MKV, WebM and more — or pull MP3 audio out of any video.',
    description:
      'Free online video converters that run entirely in your browser. Convert MOV to MP4, MKV to MP4, WebM to MP4, extract MP3 audio from video, and make GIFs — your videos are never uploaded anywhere.',
  },
  {
    id: 'audio',
    name: 'Audio Converters',
    tagline: 'Convert WAV, FLAC, OGG, M4A and AAC to MP3 — and back.',
    description:
      'Free online audio converters. Turn WAV, FLAC, OGG, M4A, AAC or WMA into universal MP3s at 192 kbps, or convert MP3 back to WAV — all on your device, nothing uploaded.',
  },
];

const FREE_FAQ = (from: string, to: string): Faq => ({
  q: `Is the ${from} to ${to} converter really free?`,
  a: `Yes. Every converter on ${BRAND} is free forever — no sign-up, no watermarks, no limits on how many files you convert.`,
});

const PRIVACY_FAQ: Faq = {
  q: 'Are my files uploaded to a server?',
  a: `No. The conversion runs entirely in your browser on your own device using built-in web technology. Your files never leave your device — there is nothing to upload to, because ${BRAND} has no servers that process files.`,
};

interface PairSpec {
  id: string;
  from: string;
  to: string;
  fromExts: string[];
  toExt: string;
  category: Category;
  blurb: string;
  faqQ: string;
  faqA: string;
  convert?: (file: File, opts?: ConvertOptions) => Promise<ConvertResult>;
  options?: OptionDef[];
  widget?: 'default' | 'pdf' | 'merge' | 'edit';
  /** Extra categories this converter is listed under (one page, linked from each). */
  alsoIn?: Category[];
  loadingNote?: string;
  /** 1-2 lines: what the SOURCE format is (unique per page). */
  aboutFrom: string;
  /** 1-2 lines: what the TARGET format is (unique per page). */
  aboutTo: string;
  /** 2-3 concrete, pair-specific use cases. */
  useCases: string[];
  /** One practical tip for this exact conversion. */
  tip: string;
  /** Extra FAQs for flagship pages (appended before the free + privacy FAQs). */
  extraFaqs?: Faq[];
  flagship?: boolean;
  /** Override the auto "X to Y Converter" title (for merge/split tools). */
  title?: string;
}

const qualityOf = (opts?: ConvertOptions): number => {
  const q = Number(opts?.quality ?? 92);
  return Math.min(100, Math.max(1, isFinite(q) ? q : 92)) / 100;
};

const img = (toExt: string) => (file: File, opts?: ConvertOptions) =>
  convertImage(file, toExt, qualityOf(opts));
const heic = (toExt: 'jpg' | 'png') => async (file: File, opts?: ConvertOptions) => {
  // heic2any handles its own quality; wire the slider through when supported.
  const mod = await import('./heic');
  return mod.convertHeic(file, toExt, qualityOf(opts));
};
const sub = (fromExt: SubExt, toExt: SubExt) => (file: File) =>
  convertSubtitle(file, fromExt, toExt);

// ---- Video/audio (ffmpeg.wasm, lazy-loaded) ----
// The module is dynamically imported inside each convert call, so the ~30MB
// engine only ever loads when a visitor actually uses a media converter.
import type { ArgBuilder } from './video';

const FFMPEG_NOTE = 'Preparing converter… (~30 MB one-time download)';

const PDF_ENGINE_NOTE = 'Loading the PDF engine… (one-time download)';

const vid =
  (buildArgs: ArgBuilder, outExt: string, mime: string, loadingNote = FFMPEG_NOTE) =>
  async (file: File, opts?: ConvertOptions) => {
    const mod = await import('./video');
    return mod.convertMedia(file, buildArgs, outExt, mime, opts);
  };

const vgif = () => async (file: File) => {
  const mod = await import('./video');
  // Simple one-click version: first 10 seconds at 480px / 10fps.
  // For trimming and full control there is the /gif-maker/ flagship page.
  return mod.videoToGif(file, {
    start: 0,
    duration: 10,
    width: 480,
    fps: 10,
    quality: 'standard',
  });
};

// Shared ffmpeg recipes (quality/bitrate come from widget options when present)
const TO_MP3: ArgBuilder = (i, o, opts) => ['-i', i, '-vn', '-b:a', String(opts?.bitrate ?? '192k'), o];
const TO_MP4: ArgBuilder = (i, o, opts) => [
  '-i',
  i,
  '-c:v',
  'libx264',
  '-crf',
  String(opts?.crf ?? '23'),
  '-preset',
  'veryfast',
  '-c:a',
  'aac',
  o,
];
const TO_WEBM: ArgBuilder = (i, o, opts) => [
  '-i',
  i,
  '-c:v',
  'libvpx-vp9',
  '-crf',
  String(opts?.crf ?? '30'),
  '-b:v',
  '0',
  '-c:a',
  'libopus',
  o,
];
const TO_WAV: ArgBuilder = (i, o) => ['-i', i, o];

const PAIRS: PairSpec[] = [
  // ---------------- IMAGE (canvas) ----------------
  {
    id: 'png-to-jpg', from: 'PNG', to: 'JPG', fromExts: ['png'], toExt: 'jpg', category: 'image',
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Turn PNG screenshots, logos and graphics into much smaller JPG files. Perfect when a PNG is too big to email or upload — same picture, a fraction of the size.',
    faqQ: 'Will converting PNG to JPG reduce quality?',
    faqA: 'JPG uses lossy compression, so files get dramatically smaller with only a tiny, usually invisible quality change. If your PNG has transparency, note that JPG does not support it — transparent areas become white.',
    aboutFrom: 'PNG stores every pixel losslessly, which keeps screenshots and logos razor-sharp. The trade-off is size — PNGs are often several megabytes, too heavy for email attachments and quick uploads.',
    aboutTo: 'JPG is the world’s most compatible image format. Its lossy compression squeezes photos and graphics down to a fraction of their size, and it opens on every phone, computer, website and app ever made.',
    useCases: [
      'Emailing screenshots without hitting attachment size limits',
      'Converting PNG graphics for upload forms that only accept JPG',
      'Shrinking website images for faster page loads',
    ],
    tip: 'PNG transparency becomes a white background in JPG. If your image has a transparent background you need to keep, convert to WebP instead.',
    extraFaqs: [
      {
        q: 'What quality setting is used for the JPG?',
        a: 'High quality (92%) — screenshots and graphics look identical to the PNG while files shrink 60–80%.',
      },
      {
        q: 'Can I convert back to PNG later?',
        a: 'Yes, but the small JPG quality loss is permanent. Keep the original PNG if pixel-perfection might matter later.',
      },
      {
        q: 'Why is JPG better for email?',
        a: 'Email providers cap attachment sizes — a 5 MB PNG often becomes a 700 KB JPG that sails through.',
      },
      {
        q: 'Does it work for photos too?',
        a: 'Absolutely — though photos usually start as JPG already. This converter shines on PNG screenshots, logos and graphics.',
      },
    ],
    flagship: true,
    convert: img('jpg'),
  },
  {
    id: 'png-to-webp', from: 'PNG', to: 'WebP', fromExts: ['png'], toExt: 'webp', category: 'image',
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Convert PNG images to WebP, the modern format that keeps transparency while shrinking files by 25–35%. Ideal for faster websites and smaller uploads.',
    faqQ: 'Why convert PNG to WebP instead of JPG?',
    faqA: 'WebP keeps transparency like PNG but compresses far better — typically 25–35% smaller than PNG and even smaller than JPG at similar quality. All modern browsers display WebP natively.',
    aboutFrom: 'PNG is the default for crisp screenshots and graphics because it never degrades quality. But it barely compresses, so PNG files are bulky — a real problem on the web.',
    aboutTo: 'WebP is Google’s modern image format: 25–35% smaller than PNG or JPG at the same visual quality, with transparency support. Every modern browser displays it natively.',
    useCases: [
      'Speeding up a website by replacing PNG images with WebP',
      'Keeping screenshot transparency while cutting file size',
      'Preparing images for platforms that prefer WebP uploads',
    ],
    tip: 'Compare the WebP side-by-side with your PNG at 100% zoom — you won’t see a difference, but the file will be roughly a third of the size.',
    extraFaqs: [
      {
        q: 'Will the WebP keep my PNG’s transparency?',
        a: 'Yes — unlike JPG, WebP fully supports transparency, so logos and UI graphics convert perfectly.',
      },
      {
        q: 'Do all browsers support WebP now?',
        a: 'All modern ones do — Chrome, Edge, Firefox, Safari 14+ and every mobile browser from recent years. Only truly ancient browsers miss it.',
      },
    ],
    convert: img('webp'),
  },
  {
    id: 'png-to-avif', from: 'PNG', to: 'AVIF', fromExts: ['png'], toExt: 'avif', category: 'image',
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Convert PNG to AVIF, the cutting-edge image format with the best compression available today. Great for web developers squeezing every kilobyte.',
    faqQ: 'My browser says AVIF is not supported. What now?',
    faqA: 'AVIF encoding needs a recent browser — Chrome or Edge work best. If yours does not support it, convert to WebP instead: nearly as small and supported everywhere.',
    aboutFrom: 'PNG preserves images pixel-for-pixel, transparency included. That perfection is expensive in bandwidth — a single PNG screenshot can outweigh an entire page of text.',
    aboutTo: 'AVIF is the newest image format, squeezing 20–30% smaller files than even WebP at the same quality. Best when every kilobyte counts and your audience uses modern browsers.',
    useCases: [
      'Maximum compression for hero images on performance-critical sites',
      'Archiving graphics at the smallest size without visible loss',
      'Testing next-gen formats for a portfolio or tech blog',
    ],
    tip: 'AVIF encoding needs a recent browser (Chrome or Edge recommended). If you see a ‘not supported’ message, WebP is the safe fallback at nearly the same size.',
    extraFaqs: [
      {
        q: 'Is AVIF better than WebP?',
        a: 'For compression, yes — typically 20–30% smaller at equal quality. For compatibility, WebP still wins. Use AVIF when your audience is on modern browsers.',
      },
      {
        q: 'Why does AVIF conversion take longer?',
        a: 'AVIF’s superior compression comes from heavier math — encoding takes a few seconds longer than WebP, but viewing the result is instant.',
      },
    ],
    convert: img('avif'),
  },
  {
    id: 'jpg-to-png', from: 'JPG', to: 'PNG', fromExts: ['jpg', 'jpeg'], toExt: 'png', category: 'image',
    blurb: 'Convert JPG photos to PNG when you need lossless quality or plan to edit further. Note: this will not restore quality already lost to JPG compression — but it stops further loss.',
    faqQ: 'Does JPG to PNG improve image quality?',
    faqA: 'No — conversion cannot recover detail that JPG compression already removed. But PNG is lossless, so editing and re-saving a PNG will not degrade it further the way re-saving a JPG does.',
    aboutFrom: 'JPG is the universal photo format — tiny files that open everywhere. Its lossy compression is tuned for photos, but every re-save shaves off a little more quality.',
    aboutTo: 'PNG is completely lossless: once your image is a PNG, editing and re-saving it never degrades it further. The safe format for graphics you plan to keep editing.',
    useCases: [
      'Freezing a JPG at its current quality before heavy editing',
      'Converting photos for software that requires PNG input',
      'Preparing images for print workflows that prefer lossless files',
    ],
    tip: 'Converting JPG to PNG stops further quality loss, but it can’t restore detail the JPG already discarded — and the PNG will be much bigger.',
    extraFaqs: [
      {
        q: 'Will my photo look better as a PNG?',
        a: 'No — conversion can’t invent detail that JPG compression removed. The benefit is that future edits and saves won’t degrade it further.',
      },
      {
        q: 'Why is the PNG so much bigger?',
        a: 'PNG stores every pixel exactly with no lossy shortcuts. Expect 3–5x the JPG’s file size — that’s the price of lossless.',
      },
    ],
    convert: img('png'),
  },
  {
    id: 'jpg-to-webp', from: 'JPG', to: 'WebP', fromExts: ['jpg', 'jpeg'], toExt: 'webp', category: 'image',
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Shrink JPG photos into WebP files that look identical but load faster. The easiest win for bloggers and shop owners speeding up their pages.',
    faqQ: 'How much smaller is WebP than JPG?',
    faqA: 'Typically 25–35% smaller at the same visual quality. A 500 KB JPG often becomes a 320–370 KB WebP with no visible difference.',
    aboutFrom: 'JPG has been the web’s photo format for 30 years: small files, universal support. But it’s showing its age — modern formats beat it by 25–35% at the same quality.',
    aboutTo: 'WebP is the modern replacement for JPG on the web: noticeably smaller files at identical visual quality, supported by every current browser.',
    useCases: [
      'Cutting a blog’s image weight by a third with zero visible change',
      'Speeding up product photos on an online store',
      'Converting camera JPGs before uploading to a WebP-friendly CMS',
    ],
    tip: 'WebP at default quality is visually identical to your JPG. If you’re converting photos for the web, just convert — no settings to agonize over.',
    extraFaqs: [
      {
        q: 'How much smaller, really?',
        a: '25–35% smaller at the same visual quality is typical — a 900 KB photo often becomes about 600 KB.',
      },
      {
        q: 'Is WebP safe for client work?',
        a: 'Yes — all modern browsers support it. Only worry if your audience includes Internet Explorer, which is vanishingly rare now.',
      },
      {
        q: 'Does converting affect SEO?',
        a: 'Positively — smaller images mean faster pages, and page speed is a ranking factor. Keep descriptive filenames.',
      },
      {
        q: 'Should I delete the JPGs after converting?',
        a: 'Keep originals archived somewhere. WebP is excellent going forward, but JPG masters cost little to keep and protect you.',
      },
    ],
    flagship: true,
    convert: img('webp'),
  },
  {
    id: 'jpg-to-avif', from: 'JPG', to: 'AVIF', fromExts: ['jpg', 'jpeg'], toExt: 'avif', category: 'image',
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Convert JPG photos to AVIF for the smallest possible file at high quality. Best for modern browsers and performance-obsessed websites.',
    faqQ: 'My browser says AVIF is not supported. What now?',
    faqA: 'AVIF encoding needs a recent browser — Chrome or Edge work best. If yours does not support it, convert to WebP instead: nearly as small and supported everywhere.',
    aboutFrom: 'JPG’s compression was designed in the 1990s. It still works everywhere, but it leaves a lot of efficiency on the table compared to modern codecs.',
    aboutTo: 'AVIF applies video-codec-grade compression to still images, beating JPG by 40–50% at the same quality. The catch: you need a modern browser to create AVIF files.',
    useCases: [
      'Squeezing maximum quality into minimum bytes for a photography portfolio',
      'Future-proofing an image archive at the smallest sizes available today',
      'A/B testing page speed with next-gen image formats',
    ],
    tip: 'Encode in Chrome or Edge — Firefox and Safari display AVIF but encoding support varies. WebP is the fallback if your browser can’t encode AVIF.',
    extraFaqs: [
      {
        q: 'AVIF vs WebP — which should I choose?',
        a: 'AVIF for the absolute smallest files when your audience uses current browsers; WebP when you want small files plus near-universal support.',
      },
      {
        q: 'Do phones display AVIF?',
        a: 'Recent iPhones (iOS 16+) and Android phones (Android 12+) display AVIF in their browsers. Older phones may not.',
      },
    ],
    convert: img('avif'),
  },
  {
    id: 'webp-to-png', from: 'WebP', to: 'PNG', fromExts: ['webp'], toExt: 'png', category: 'image',
    blurb: 'Convert WebP images back to PNG for maximum compatibility — older software, editors and platforms that do not understand WebP yet.',
    faqQ: 'Why would I convert WebP back to PNG?',
    faqA: 'Some desktop editors, print services and older platforms still do not accept WebP. PNG opens everywhere, so converting back is the safe choice when compatibility matters more than file size.',
    aboutFrom: 'WebP is the efficient modern format — small files, great quality. But some desktop software, print services and older platforms still don’t recognize it.',
    aboutTo: 'PNG is the compatibility king for lossless images: it opens in every editor, viewer and operating system, no questions asked.',
    useCases: [
      'Opening a downloaded WebP in an old photo editor',
      'Sending images to a print shop that only accepts PNG or JPG',
      'Converting WebP assets for software with no WebP support',
    ],
    tip: 'The PNG will be bigger than your WebP — that’s normal. You’re trading file size for universal compatibility.',
    extraFaqs: [
      {
        q: 'Do I lose quality converting WebP to PNG?',
        a: 'No — PNG is lossless, so whatever quality your WebP had is preserved exactly. The conversion itself adds no degradation.',
      },
      {
        q: 'Why is the PNG bigger than the WebP?',
        a: 'WebP’s compression is simply more advanced. PNG keeps every pixel perfectly but needs more bytes to do it — often 30–50% more.',
      },
    ],
    convert: img('png'),
  },
  {
    id: 'webp-to-jpg', from: 'WebP', to: 'JPG', fromExts: ['webp'], toExt: 'jpg', category: 'image',
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Turn WebP images into universally compatible JPGs. Handy when a site or app rejects WebP uploads — JPG works absolutely everywhere.',
    faqQ: 'Does WebP to JPG lose transparency?',
    faqA: 'Yes — JPG has no transparency, so transparent areas become white. If you need to keep transparency, convert to PNG instead.',
    aboutFrom: 'WebP looks great at tiny file sizes, but the wider world — email clients, old phones, upload forms — still speaks JPG first.',
    aboutTo: 'JPG remains the lowest-common-denominator image format: if a system accepts images at all, it accepts JPG.',
    useCases: [
      'Uploading a WebP image to a site that rejects it',
      'Emailing downloaded WebP images to anyone',
      'Converting WebP to JPG for maximum compatibility',
    ],
    tip: 'Watch out for transparency: WebP can have it, JPG can’t. Transparent areas turn white — convert to PNG instead if transparency matters.',
    extraFaqs: [
      {
        q: 'Will I lose the transparency?',
        a: 'Yes — JPG can’t do transparency, so transparent areas become white. Use WebP to PNG instead if transparency matters.',
      },
      {
        q: 'Is the quality the same?',
        a: 'At high quality settings the difference is invisible for photos and typical graphics.',
      },
      {
        q: 'Why do sites still reject WebP?',
        a: 'Some upload validators and older systems were built before WebP existed and never updated their allowed-formats list.',
      },
      {
        q: 'JPG or PNG as the target?',
        a: 'JPG for the smallest files; PNG if you need transparency or plan to edit further.',
      },
    ],
    flagship: true,
    convert: img('jpg'),
  },
  {
    id: 'webp-to-avif', from: 'WebP', to: 'AVIF', fromExts: ['webp'], toExt: 'avif', category: 'image',
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Move from WebP to AVIF for even better compression. For image-heavy sites where every kilobyte of bandwidth counts.',
    faqQ: 'Is AVIF really better than WebP?',
    faqA: 'Yes, AVIF typically compresses 20–30% better than WebP at the same quality. The trade-off is slower encoding and slightly narrower support — which is why we check your browser first.',
    aboutFrom: 'WebP already beats JPG and PNG on size. AVIF is the next step on the same ladder — the newest codec squeezing files smaller still.',
    aboutTo: 'AVIF typically compresses 20–30% better than WebP at equal quality, making it today’s champion for pure file-size efficiency.',
    useCases: [
      'Pushing already-optimized site images even smaller',
      'Preparing assets for AVIF-first image CDNs',
      'Experimenting with next-gen formats on a tech-savvy audience',
    ],
    tip: 'Gains over WebP are real but modest (~20–30%). Worth it for image-heavy pages; for a handful of images, WebP is already excellent.',
    extraFaqs: [
      {
        q: 'Is it worth converting WebP to AVIF?',
        a: 'For large image libraries and performance-critical sites, yes — the savings add up. For occasional images, WebP’s wider support may matter more.',
      },
      {
        q: 'Which browsers can create AVIF files here?',
        a: 'Chrome and Edge encode AVIF reliably. If your browser shows ‘not supported’, your WebP is already a great result.',
      },
    ],
    convert: img('avif'),
  },
  {
    id: 'gif-to-png', from: 'GIF', to: 'PNG', fromExts: ['gif'], toExt: 'png', category: 'image',
    blurb: 'Extract a still frame from a GIF as a crisp PNG image. We convert the first frame — perfect for thumbnails and previews.',
    faqQ: 'Does this convert the whole animation?',
    faqA: 'No — a PNG is a still image, so we convert the first frame of the GIF. For the full animation, keep it as a GIF or convert to WebP.',
    aboutFrom: 'GIF is the classic animation format — and a decent way to share short loops. But as a still-image source it’s limited to 256 colors.',
    aboutTo: 'PNG captures the frame losslessly at full color depth — perfect for thumbnails, previews and documents.',
    useCases: [
      'Grabbing a clean thumbnail from an animated GIF',
      'Extracting a still for a presentation slide',
      'Saving a GIF frame as a high-quality static image',
    ],
    tip: 'We convert the first frame — for most GIFs that’s the representative still.',
    extraFaqs: [
      {
        q: 'Which frame becomes the PNG?',
        a: 'The first frame of the animation. For most GIFs that’s the intended preview image.',
      },
      {
        q: 'Will the PNG have the GIF’s 256-color limit?',
        a: 'The PNG supports full color, but it can only preserve colors that were in the GIF frame — it can’t add detail that wasn’t there.',
      },
    ],
    convert: img('png'),
  },
  {
    id: 'gif-to-jpg', from: 'GIF', to: 'JPG', fromExts: ['gif'], toExt: 'jpg', category: 'image',
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Turn a GIF frame into a compact JPG. Useful when you need a lightweight still from an animation for a document or post.',
    faqQ: 'Does this convert the whole animation?',
    faqA: 'No — JPG is a still format, so we convert the first frame. The result is a small, widely compatible photo-style image.',
    aboutFrom: 'GIFs are everywhere as reactions and memes. When you need a lightweight still from one — for a document, post or thumbnail — JPG is the compact choice.',
    aboutTo: 'JPG compresses the still frame far smaller than the GIF’s own frame data — ideal for embedding in pages and documents.',
    useCases: [
      'Making a lightweight preview image from a meme GIF',
      'Extracting a still for a blog post',
      'Creating a compact thumbnail from an animation',
    ],
    tip: 'JPG suits photographic GIF frames; for flat cartoon graphics with sharp edges, PNG keeps edges crisper.',
    extraFaqs: [
      {
        q: 'Does it convert the whole animation?',
        a: 'No — JPG is a still format, so we convert the first frame. Keep the GIF itself if you need the motion.',
      },
      {
        q: 'JPG or PNG for a GIF still?',
        a: 'JPG for photos and complex frames (smaller file); PNG for flat graphics, text or logos (sharper edges).',
      },
    ],
    convert: img('jpg'),
  },
  {
    id: 'gif-to-webp', from: 'GIF', to: 'WebP', fromExts: ['gif'], toExt: 'webp', category: 'image',
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Convert GIFs to WebP stills at a fraction of the size. Great for previews and thumbnails taken from animations.',
    faqQ: 'Why convert GIF to WebP?',
    faqA: 'Even as a still, WebP compresses far better than GIF — often 50%+ smaller — while keeping full color. We convert the first frame of the animation.',
    aboutFrom: 'Animated GIFs are charming but technically ancient — huge files for what they show. Even a single frame carries GIF’s inefficient 256-color encoding.',
    aboutTo: 'WebP stores the still at full color in a fraction of the bytes — modern, tiny, and supported everywhere current.',
    useCases: [
      'Replacing GIF thumbnails with tiny WebP stills on a website',
      'Extracting high-quality stills from animations',
      'Shrinking preview images without visible quality loss',
    ],
    tip: 'WebP stills are often 50%+ smaller than the equivalent GIF frame — a quick win anywhere you show GIF previews.',
    extraFaqs: [
      {
        q: 'Can WebP keep the animation?',
        a: 'WebP does support animation, but this tool extracts a still — the first frame. For animated output, keep the GIF or make a video.',
      },
      {
        q: 'Why is the WebP so much smaller?',
        a: 'GIF’s compression dates to 1987 and is capped at 256 colors. WebP uses modern techniques — the size difference is dramatic even for one frame.',
      },
    ],
    convert: img('webp'),
  },
  {
    id: 'bmp-to-png', from: 'BMP', to: 'PNG', fromExts: ['bmp', 'dib'], toExt: 'png', category: 'image',
    blurb: 'Convert bulky BMP files to efficient PNGs with zero quality loss. BMPs are uncompressed — PNG keeps every pixel and slashes the size.',
    faqQ: 'How much smaller will my BMP become?',
    faqA: 'Often 50–70% smaller with identical pixels. BMP stores every pixel raw; PNG compresses that data losslessly, so nothing visual changes at all.',
    aboutFrom: 'BMP is Windows’ raw bitmap format — every pixel stored uncompressed. Simple, ancient, and enormous: a single screenshot can be tens of megabytes.',
    aboutTo: 'PNG keeps every pixel bit-for-bit identical while compressing the data losslessly — the same image at a fraction of the size.',
    useCases: [
      'Archiving old BMP screenshots without wasting disk space',
      'Converting BMPs for use on the web',
      'Preparing BMP images for any modern software',
    ],
    tip: 'Expect 50–70% smaller files with zero visual change — one of the safest conversions on the site.',
    extraFaqs: [
      {
        q: 'Is anything lost converting BMP to PNG?',
        a: 'Nothing at all. PNG’s compression is lossless — every pixel is preserved exactly.',
      },
      {
        q: 'Where do BMP files even come from?',
        a: 'Mostly old Windows software, scanners and legacy systems. If you found a BMP, it’s probably been sitting around for years.',
      },
    ],
    convert: img('png'),
  },
  {
    id: 'bmp-to-jpg', from: 'BMP', to: 'JPG', fromExts: ['bmp', 'dib'], toExt: 'jpg', category: 'image',
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Shrink huge BMP files down to small JPGs for sharing and the web. The fastest way to make a BMP emailable.',
    faqQ: 'Will I lose quality converting BMP to JPG?',
    faqA: 'JPG is lossy, so there is a small quality trade-off — but BMPs are so large that the size saving (often 90%+) is worth it for photos and screenshots meant for sharing.',
    aboutFrom: 'BMP files are uncompressed bitmaps — simple but gigantic. They’re the number-one ‘why is this file so big’ image format.',
    aboutTo: 'JPG’s lossy compression is the fastest route from a 20 MB BMP to an emailable photo.',
    useCases: [
      'Making an old BMP small enough to email',
      'Converting BMP scans for web upload',
      'Shrinking BMP screenshots for sharing',
    ],
    tip: 'For photos and scans the quality loss is invisible; for sharp text screenshots, PNG keeps text crisper than JPG.',
    extraFaqs: [
      {
        q: 'How much smaller will the JPG be?',
        a: 'Often 90%+ smaller. A 15 MB BMP commonly becomes a 1–2 MB JPG — that’s what lossy compression does to uncompressed sources.',
      },
      {
        q: 'BMP to JPG or BMP to PNG?',
        a: 'JPG for photos and the smallest files; PNG for screenshots with text, or when you can’t afford any quality loss.',
      },
    ],
    convert: img('jpg'),
  },
  {
    id: 'bmp-to-webp', from: 'BMP', to: 'WebP', fromExts: ['bmp', 'dib'], toExt: 'webp', category: 'image',
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Convert BMP to WebP for the best of both worlds: dramatically smaller files with excellent quality for web use.',
    faqQ: 'BMP to WebP or BMP to PNG — which should I pick?',
    faqA: 'Pick WebP for the web (smallest), PNG when you need lossless editing or maximum compatibility. Both are big upgrades over BMP.',
    aboutFrom: 'BMP’s uncompressed pixels make it the heaviest common image format — the worst starting point for sharing or the web.',
    aboutTo: 'WebP gives you the best of both worlds: near-lossless quality options at dramatically smaller sizes than BMP.',
    useCases: [
      'Modernizing a folder of old BMP images',
      'Preparing BMP graphics for a website',
      'Getting maximum quality per byte from legacy images',
    ],
    tip: 'Going BMP to WebP directly skips the JPG step some people do in between — one conversion, best result.',
    extraFaqs: [
      {
        q: 'Is WebP better than PNG for BMP conversion?',
        a: 'For file size, yes — WebP is typically 25–30% smaller than PNG. For absolute lossless archiving, PNG is the purist’s choice.',
      },
      {
        q: 'Will old software open the WebP?',
        a: 'Modern browsers and editors will. Truly ancient software won’t — use PNG for maximum compatibility with old tools.',
      },
    ],
    convert: img('webp'),
  },

  // ---------------- HEIC (heic2any) ----------------
  {
    id: 'heic-to-jpg', from: 'HEIC', to: 'JPG', fromExts: ['heic'], toExt: 'jpg', category: 'image',
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Convert iPhone HEIC photos to JPG so they open everywhere — Windows, Android, email and the web. The fix for "my iPhone photo will not upload".',
    faqQ: 'Why do my iPhone photos need converting?',
    faqA: 'iPhones save photos as HEIC by default, which many Windows apps, websites and older devices cannot open. Converting to JPG makes the photo universally compatible.',
    aboutFrom: 'HEIC is Apple’s efficient photo format — roughly half the size of JPG at the same quality. iPhones have saved photos as HEIC by default since 2017.',
    aboutTo: 'JPG is the universal fallback: bigger than HEIC, but readable by every device, app and website on earth.',
    tip: 'Converting at high quality keeps the photo visually identical — and your original HEIC file is never modified.',
    convert: heic('jpg'),
    flagship: true,
    useCases: [
      'Emailing iPhone photos to people on Windows',
      'Uploading to websites and forms that reject HEIC files',
      'Sharing in WhatsApp or Telegram without compatibility warnings',
      'Saving photos in a format every device will still open in ten years',
    ],
    extraFaqs: [
      {
        q: 'Why won\u2019t my HEIC photo open on Windows?',
        a: 'Windows needs an extra paid HEVC codec to open HEIC, and most PCs don\u2019t have it. Converting to JPG sidesteps the problem entirely — JPG opens everywhere with no extra software.',
      },
      {
        q: 'Will converting HEIC to JPG lose quality?',
        a: 'Barely. We convert at high quality (92%), so any difference is invisible in normal viewing. Your original HEIC file is never touched — the JPG is a new download.',
      },
      {
        q: 'Can I convert several HEIC photos at once?',
        a: 'Right now each conversion handles one file at a time — drop a photo, convert, download, repeat. It takes a few seconds per photo.',
      },
      {
        q: 'How do I stop my iPhone saving HEIC in the future?',
        a: 'On your iPhone go to Settings \u2192 Camera \u2192 Formats and choose "Most Compatible". New photos will save as JPG — but this won\u2019t change photos you already took.',
      },
      {
        q: 'Does this work for HEIC files from cameras or drones, not just iPhones?',
        a: 'Yes — any valid HEIC or HEIF file converts the same way, no matter which device created it.',
      },
    ],
  },
  {
    id: 'heic-to-png', from: 'HEIC', to: 'PNG', fromExts: ['heic'], toExt: 'png', category: 'image',
    blurb: 'Convert HEIC photos to lossless PNG when quality matters most — for editing, design work or archiving your iPhone shots.',
    faqQ: 'HEIC to PNG or HEIC to JPG?',
    faqA: 'JPG for sharing and small files; PNG when you plan to edit the photo or need every bit of quality preserved. PNG files are larger.',
    aboutFrom: 'HEIC is Apple’s efficient photo format — half the size of JPG at the same quality. But outside Apple devices, support is patchy.',
    aboutTo: 'PNG preserves your photo losslessly, making it the right choice when you plan to edit, print, or archive the shot.',
    useCases: [
      'Converting iPhone photos before editing in Photoshop',
      'Archiving HEIC shots in a lossless format',
      'Preparing HEIC photos for print',
    ],
    tip: 'PNGs from HEIC are big — that’s the price of lossless. For everyday sharing, HEIC to JPG gives much smaller files.',
    extraFaqs: [
      {
        q: 'HEIC to PNG or HEIC to JPG?',
        a: 'PNG for editing, printing and archiving (lossless, larger). JPG for sharing and everyday use (smaller, still excellent).',
      },
      {
        q: 'Does the PNG keep the photo’s full resolution?',
        a: 'Yes — every pixel converts at full resolution. Nothing is downscaled.',
      },
    ],
    convert: heic('png'),
  },
  {
    id: 'heif-to-jpg', from: 'HEIF', to: 'JPG', fromExts: ['heif'], toExt: 'jpg', category: 'image',
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Convert HEIF images to JPG for universal compatibility. Same idea as HEIC — HEIF is simply the format name without the "container" distinction.',
    faqQ: 'What is the difference between HEIC and HEIF?',
    faqA: 'HEIF is the format standard; HEIC is HEIF using HEVC compression — what iPhones actually produce. Both open the same way here: drop the file and convert.',
    aboutFrom: 'HEIF is the underlying standard behind Apple’s HEIC photos — extremely efficient, but unreadable by most Windows apps and websites.',
    aboutTo: 'JPG is the universal fallback: slightly bigger than HEIF, but opens absolutely everywhere.',
    useCases: [
      'Opening HEIF images on a Windows PC',
      'Uploading HEIF photos to web forms',
      'Sharing HEIF images with Android users',
    ],
    tip: 'HEIC and HEIF are siblings — if your iPhone file says .HEIF instead of .HEIC, this is the right converter.',
    extraFaqs: [
      {
        q: 'What’s the difference between HEIC and HEIF?',
        a: 'HEIF is the format standard; HEIC is HEIF using HEVC compression — what iPhones actually produce. Both convert the same way here.',
      },
      {
        q: 'Will I lose quality?',
        a: 'A negligible amount at high quality — invisible in normal viewing. The original file is never modified.',
      },
    ],
    convert: heic('jpg'),
  },
  {
    id: 'heif-to-png', from: 'HEIF', to: 'PNG', fromExts: ['heif'], toExt: 'png', category: 'image',
    blurb: 'Convert HEIF images to lossless PNG for editing and archiving without any further quality loss.',
    faqQ: 'Will the PNG be much bigger than my HEIF?',
    faqA: 'Yes — HEIF is extremely efficient, so the PNG will be several times larger. That is the price of a lossless, universally editable file.',
    aboutFrom: 'HEIF packs photos incredibly small using modern compression. The price of that efficiency: most non-Apple software can’t open it.',
    aboutTo: 'PNG trades file size for universality and lossless quality — the safe, editable, archivable result.',
    useCases: [
      'Editing HEIF photos in desktop software',
      'Converting HEIF for a design project',
      'Lossless archiving of HEIF originals',
    ],
    tip: 'Expect the PNG to be several times larger than your HEIF — HEIF is one of the most efficient formats ever made.',
    extraFaqs: [
      {
        q: 'Why is the PNG so much bigger than my HEIF?',
        a: 'HEIF’s compression is state-of-the-art; PNG is lossless and much older. A 4–6x size gap is normal.',
      },
      {
        q: 'Should I keep the original HEIF too?',
        a: 'If storage allows, yes — it’s your smallest full-quality original. The PNG is your editable working copy.',
      },
    ],
    convert: heic('png'),
  },

  // ---------------- TEXT ----------------
  {
    id: 'md-to-html', from: 'Markdown', to: 'HTML', fromExts: ['md', 'markdown'], toExt: 'html', category: 'text',
    blurb: 'Turn a Markdown file into a clean, styled HTML page you can open in any browser or paste into a CMS. Headings, lists, links and code blocks all convert properly.',
    faqQ: 'What does the HTML output look like?',
    faqA: 'A complete, valid HTML document with your Markdown rendered as proper headings, paragraphs, lists and code blocks — ready to open, print or publish.',
    aboutFrom: 'Markdown is the plain-text writing format developers and writers love: # headings, **bold**, lists — readable as-is, but not a finished web page.',
    aboutTo: 'HTML is the web’s native language. Markdown rendered to HTML becomes a proper page you can open, print, or paste into any CMS.',
    useCases: [
      'Turning README-style notes into a shareable web page',
      'Converting Markdown drafts for pasting into WordPress',
      'Previewing Markdown as a formatted document',
    ],
    tip: 'The output is a complete HTML document — open it directly in your browser to see your formatted page.',
    extraFaqs: [
      {
        q: 'Does it handle code blocks?',
        a: 'Yes — fenced code blocks render as proper pre/code blocks, great for documentation.',
      },
      {
        q: 'Can I style the HTML output?',
        a: 'The HTML is clean and semantic, so drop it into any stylesheet or CMS theme and it picks up your styles.',
      },
    ],
    convert: mdToHtml,
  },
  {
    id: 'html-to-txt', from: 'HTML', to: 'TXT', fromExts: ['html', 'htm'], toExt: 'txt', category: 'text',
    blurb: 'Strip an HTML page down to clean plain text. Perfect for extracting article content from saved web pages without the tags, scripts or styling.',
    faqQ: 'Does it keep the readable text in order?',
    faqA: 'Yes — scripts and styles are removed, block elements become line breaks, and you get the visible text in reading order as a plain .txt file.',
    aboutFrom: 'HTML pages mix content with markup — tags, scripts, styles. Sometimes you just want the words.',
    aboutTo: 'Plain text is the universal readable format: no formatting, no code, just the content in reading order.',
    useCases: [
      'Extracting article text from a saved web page',
      'Stripping a newsletter’s HTML for plain-text archiving',
      'Getting clean text from HTML for analysis',
    ],
    tip: 'Scripts, styles and navigation chrome are removed — what remains is the visible text in reading order.',
    extraFaqs: [
      {
        q: 'Does it keep links?',
        a: 'No — link URLs are dropped and only the link text remains. Keep the HTML itself if you need the destinations.',
      },
      {
        q: 'What about tables?',
        a: 'Table cell text is extracted in order, but the table structure isn’t preserved — the result reads as flowing text.',
      },
    ],
    convert: htmlToTxt,
  },
  {
    id: 'txt-to-md', from: 'TXT', to: 'Markdown', fromExts: ['txt'], toExt: 'md', category: 'text',
    blurb: 'Convert plain text to Markdown format in one click. A quick starting point before you add headings and formatting in any Markdown editor.',
    faqQ: 'Does it add formatting automatically?',
    faqA: 'It converts your text into a valid Markdown file as-is. You can then add # headings, **bold** and lists in seconds with any Markdown editor.',
    aboutFrom: 'Plain text is where most writing starts — quick notes, drafts, pasted content with no formatting at all.',
    aboutTo: 'Markdown adds lightweight structure (# headings, lists, emphasis) that renders beautifully in editors, GitHub and documentation tools.',
    useCases: [
      'Preparing notes for a Markdown-based wiki',
      'Starting a README from plain-text drafts',
      'Moving text into Obsidian or similar note apps',
    ],
    tip: 'The conversion gives you a valid Markdown file as-is — then add # headings and **bold** in seconds with any Markdown editor.',
    extraFaqs: [
      {
        q: 'Does it auto-detect headings?',
        a: 'No — it converts your text faithfully as-is. Adding # marks for headings takes seconds and keeps you in control.',
      },
      {
        q: 'Why convert TXT to Markdown at all?',
        a: 'Markdown renders with formatting on GitHub, in note apps and docs sites — plain .txt files never do.',
      },
    ],
    convert: txtToMd,
  },

  // ---------------- DATA ----------------
  {
    id: 'json-to-csv', from: 'JSON', to: 'CSV', fromExts: ['json'], toExt: 'csv', category: 'data',
    blurb: 'Convert a JSON array of objects into a CSV spreadsheet that opens in Excel and Google Sheets. The fastest way to make API data human-readable.',
    faqQ: 'What shape of JSON works best?',
    faqA: 'An array of objects with consistent keys — like [{"name":"A"},{"name":"B"}]. A single object also works; it becomes a one-row CSV.',
    aboutFrom: 'JSON is the data format of APIs and JavaScript — nested, precise, and unreadable to non-developers.',
    aboutTo: 'CSV is the spreadsheet format: rows and columns that open in Excel and Google Sheets, readable by anyone.',
    useCases: [
      'Turning API responses into a spreadsheet for analysis',
      'Sharing JSON data with colleagues who use Excel',
      'Preparing data for tools that import CSV',
    ],
    tip: 'Works best with an array of objects sharing the same keys — each object becomes one spreadsheet row.',
    extraFaqs: [
      {
        q: 'What if my JSON is nested?',
        a: 'Nested objects are flattened with dot notation (address.city), so no data is lost — though deep nesting is easier to read as JSON.',
      },
      {
        q: 'How are commas inside values handled?',
        a: 'Properly quoted per CSV rules — values with commas or quotes are wrapped so spreadsheets parse them correctly.',
      },
    ],
    convert: jsonToCsv,
  },
  {
    id: 'csv-to-json', from: 'CSV', to: 'JSON', fromExts: ['csv'], toExt: 'json', category: 'data',
    blurb: 'Convert a CSV spreadsheet into structured JSON for APIs, scripts and databases. Handles quoted fields and commas inside cells correctly.',
    faqQ: 'Does the first row become the keys?',
    faqA: 'Yes — the header row becomes the JSON keys, and every following row becomes an object. Empty headers get safe names like column_1.',
    aboutFrom: 'CSV is how the world shares tabular data — simple, but dumb: no types, no structure beyond rows.',
    aboutTo: 'JSON gives that data structure: typed values, nesting, and a format every API and programming language understands.',
    useCases: [
      'Feeding spreadsheet data into a web app or API',
      'Converting exports for a JavaScript project',
      'Turning CSV logs into structured JSON for processing',
    ],
    tip: 'The first row becomes your JSON keys — make sure your CSV has a clean header row before converting.',
    extraFaqs: [
      {
        q: 'Are numbers kept as numbers?',
        a: 'Yes — numeric cells become JSON numbers, not strings, so your data stays computable.',
      },
      {
        q: 'What about empty cells?',
        a: 'Empty cells become null, preserving the row structure without inventing data.',
      },
    ],
    convert: csvToJson,
  },
  {
    id: 'json-to-yaml', from: 'JSON', to: 'YAML', fromExts: ['json'], toExt: 'yaml', category: 'data',
    blurb: 'Convert JSON config into readable YAML for Docker Compose, Kubernetes, CI pipelines and app settings.',
    faqQ: 'Why convert JSON to YAML?',
    faqA: 'YAML is far easier for humans to read and edit than JSON — no braces or quotes everywhere. Most DevOps tools accept YAML configs natively.',
    aboutFrom: 'JSON is precise but noisy — braces, quotes and commas everywhere make it tiring to read and edit by hand.',
    aboutTo: 'YAML is the human-friendly config format: clean indentation, no clutter — the native language of Docker Compose and Kubernetes.',
    useCases: [
      'Converting JSON configs for Kubernetes manifests',
      'Making API data editable as a config file',
      'Preparing Docker Compose files from JSON sources',
    ],
    tip: 'Watch indentation in the YAML output — YAML is whitespace-sensitive, unlike JSON.',
    extraFaqs: [
      {
        q: 'Is YAML just prettier JSON?',
        a: 'Mostly — YAML is a superset of JSON, so data converts exactly. The win is readability.',
      },
      {
        q: 'Can YAML do everything JSON can?',
        a: 'For data, yes. Note that comments can’t round-trip back to JSON, since JSON has no comments.',
      },
    ],
    convert: jsonToYaml,
  },
  {
    id: 'yaml-to-json', from: 'YAML', to: 'JSON', fromExts: ['yaml', 'yml'], toExt: 'json', category: 'data',
    blurb: 'Convert YAML config files to JSON for APIs, JavaScript apps and tools that only speak JSON.',
    faqQ: 'Will comments in my YAML survive?',
    faqA: 'No — JSON has no comments, so they are dropped. The data itself converts exactly, including nested objects and arrays.',
    aboutFrom: 'YAML is great for humans editing configs — but most APIs, and all of JavaScript’s native tooling, speak JSON.',
    aboutTo: 'JSON is the machine format: strict, unambiguous, parseable by every language’s standard library.',
    useCases: [
      'Converting Kubernetes configs for programmatic processing',
      'Turning YAML settings into JSON for a JS app',
      'Validating YAML by viewing it as strict JSON',
    ],
    tip: 'Anchors and aliases in YAML are resolved during conversion — the JSON holds the final expanded values.',
    extraFaqs: [
      {
        q: 'Do YAML comments survive?',
        a: 'No — JSON has no comment syntax, so comments are dropped. The data converts exactly.',
      },
      {
        q: 'What happens to multi-line strings?',
        a: 'They become JSON strings with escaped line breaks — the breaks are preserved, just encoded.',
      },
    ],
    convert: yamlToJson,
  },
  {
    id: 'toml-to-json', from: 'TOML', to: 'JSON', fromExts: ['toml'], toExt: 'json', category: 'data',
    blurb: 'Convert TOML config files (Cargo.toml, pyproject.toml and friends) into JSON for processing in any language.',
    faqQ: 'What is TOML used for?',
    faqA: 'TOML is the config format behind Rust\'s Cargo, Python\'s pyproject.toml and many other tools. Converting to JSON makes it easy to read programmatically.',
    aboutFrom: 'TOML is the config format of Rust’s Cargo, Python’s pyproject.toml and many modern tools — minimal, obvious, and typed.',
    aboutTo: 'JSON makes that config readable by any language or tool without a TOML parser.',
    useCases: [
      'Reading pyproject.toml data in a JavaScript tool',
      'Converting Cargo.toml for analysis scripts',
      'Bridging TOML configs into JSON-based pipelines',
    ],
    tip: 'TOML dates convert to ISO strings in JSON — parse them with your language’s date handling.',
    extraFaqs: [
      {
        q: 'What is TOML mainly used for?',
        a: 'Configuration files — most famously Cargo.toml (Rust) and pyproject.toml (Python). It’s designed to be obvious to humans.',
      },
      {
        q: 'Does anything get lost?',
        a: 'TOML’s types — integers, floats, booleans, datetimes, arrays, tables — all map cleanly to JSON. Only comments are dropped.',
      },
    ],
    convert: tomlToJson,
  },
  {
    id: 'xml-to-json', from: 'XML', to: 'JSON', fromExts: ['xml'], toExt: 'json', category: 'data',
    blurb: 'Convert XML documents into clean JSON. Attributes are kept under @attributes so nothing is lost in translation.',
    faqQ: 'How are XML attributes handled?',
    faqA: 'Attributes are preserved in an "@attributes" object, repeated elements become arrays, and text content lands in "#text" — so the JSON round-trips your data faithfully.',
    aboutFrom: 'XML is the venerable data format of enterprises, RSS feeds and Office files — verbose, but structured.',
    aboutTo: 'JSON is XML’s lean successor for data exchange: the same structure with a fraction of the noise.',
    useCases: [
      'Converting RSS/XML feeds for a JavaScript app',
      'Modernizing legacy XML exports',
      'Turning SOAP-style responses into workable JSON',
    ],
    tip: 'Check the @attributes objects in the output — that’s where XML attributes live, so nothing is silently dropped.',
    extraFaqs: [
      {
        q: 'How are repeated elements handled?',
        a: 'They become JSON arrays automatically — an <item> repeated three times becomes an array of three objects.',
      },
      {
        q: 'What about XML namespaces?',
        a: 'Namespace prefixes stay in the key names (e.g. dc:title), so namespaced documents remain distinguishable.',
      },
    ],
    convert: xmlToJson,
  },

  // ---------------- SUBTITLES ----------------
  {
    id: 'srt-to-vtt', from: 'SRT', to: 'WebVTT', fromExts: ['srt'], toExt: 'vtt', category: 'subtitle',
    blurb: 'Convert SRT subtitles to WebVTT for HTML5 video players. VTT is the web standard — required for <track> captions that work in every browser.',
    faqQ: 'Why do I need WebVTT instead of SRT?',
    faqA: 'Browsers only accept WebVTT for native <video> captions via the <track> element. SRT will not load there — this conversion fixes that in one click.',
    aboutFrom: 'SRT is the universal subtitle format — plain numbered cues with timestamps. Nearly every player and platform accepts it.',
    aboutTo: 'WebVTT is the web’s caption standard: the only format browsers accept natively for video captions via the track element.',
    useCases: [
      'Adding captions to an HTML5 video player',
      'Publishing accessible video on the web',
      'Converting subtitles for web embedding',
    ],
    tip: 'Name the .vtt file the same as your video and add a captions track — browsers pick it up automatically.',
    extraFaqs: [
      {
        q: 'Do I need to change the timestamps?',
        a: 'No — timestamps convert precisely; only the header format and separators change.',
      },
      {
        q: 'Can I style WebVTT captions?',
        a: 'Yes — WebVTT supports basic styling with ::cue CSS, unlike SRT. The text converts first; style it afterwards.',
      },
    ],
    convert: sub('srt', 'vtt'),
  },
  {
    id: 'vtt-to-srt', from: 'WebVTT', to: 'SRT', fromExts: ['vtt'], toExt: 'srt', category: 'subtitle',
    blurb: 'Convert WebVTT captions back to SRT, the universal subtitle format that video players, editors and YouTube all accept.',
    faqQ: 'Do I lose anything converting VTT to SRT?',
    faqA: 'Styling tags (like <b> or <i>) are stripped since SRT is plain text — but timing and text stay exactly the same.',
    aboutFrom: 'WebVTT powers web video captions, but outside browsers it’s the odd one out — many desktop players and editors prefer SRT.',
    aboutTo: 'SRT is the lingua franca of subtitles: YouTube, VLC, Premiere and virtually everything else accept it.',
    useCases: [
      'Using web captions in VLC or another desktop player',
      'Uploading captions to platforms that want SRT',
      'Editing web captions in subtitle software',
    ],
    tip: 'Styling tags like <b> are stripped since SRT is plain text — timing and dialogue stay exact.',
    extraFaqs: [
      {
        q: 'Will I lose the caption positioning?',
        a: 'Yes — SRT has no positioning, so VTT position cues are dropped. Text and timing are preserved.',
      },
      {
        q: 'Is SRT still relevant?',
        a: 'Very — it’s the most widely supported subtitle format in existence, which is exactly why people convert to it.',
      },
    ],
    convert: sub('vtt', 'srt'),
  },
  {
    id: 'srt-to-ass', from: 'SRT', to: 'ASS', fromExts: ['srt'], toExt: 'ass', category: 'subtitle',
    blurb: 'Convert SRT to ASS for styled subtitles — custom fonts, colors, positioning and karaoke effects that SRT cannot do.',
    faqQ: 'What does ASS give me that SRT does not?',
    faqA: 'Styling: fonts, colors, screen position, outlines and karaoke timing. Your text and timing carry over; you can then style it in Aegisub or any ASS editor.',
    aboutFrom: 'SRT handles plain dialogue well, but it’s style-blind: no fonts, no colors, no positioning.',
    aboutTo: 'ASS (Advanced SubStation Alpha) is the styled subtitle format — fonts, colors, screen positions, outlines and karaoke effects.',
    useCases: [
      'Styling fansub releases with custom fonts',
      'Creating karaoke-timed lyrics',
      'Positioning dialogue for overlapping speakers',
    ],
    tip: 'Your text and timing carry over; open the ASS in Aegisub to apply styles — that’s where ASS shines.',
    extraFaqs: [
      {
        q: 'What’s the difference between ASS and SSA?',
        a: 'ASS is the newer, more capable version. SSA is its predecessor — pick ASS unless a specific old tool demands SSA.',
      },
      {
        q: 'Will my video player show the styles?',
        a: 'VLC, MPV and most anime players render ASS styles fully. Some smart TVs and phones may show plain text.',
      },
    ],
    convert: sub('srt', 'ass'),
  },
  {
    id: 'ass-to-srt', from: 'ASS', to: 'SRT', fromExts: ['ass'], toExt: 'srt', category: 'subtitle',
    blurb: 'Convert styled ASS subtitles to plain SRT for maximum compatibility with players and platforms that ignore styling.',
    faqQ: 'What happens to the styling?',
    faqA: 'Styling codes are removed — SRT cannot carry them. The dialogue text and its exact timing are preserved.',
    aboutFrom: 'ASS subtitles carry rich styling — great for fansubs, but many platforms and devices ignore all of it.',
    aboutTo: 'SRT strips everything down to timed dialogue: the format that works absolutely everywhere.',
    useCases: [
      'Uploading fansub dialogue to YouTube',
      'Playing styled subs on a device that ignores styling',
      'Simplifying subtitles for editing',
    ],
    tip: 'Dialogue text and exact timing are preserved — only the styling codes are removed.',
    extraFaqs: [
      {
        q: 'Do I lose dialogue?',
        a: 'No — every line of dialogue converts with its timing. Only fonts, colors and positioning are dropped.',
      },
      {
        q: 'What about karaoke timing?',
        a: 'Per-syllable karaoke timing is simplified to plain per-line cues, since SRT stores one start/end time per line.',
      },
    ],
    convert: sub('ass', 'srt'),
  },
  {
    id: 'srt-to-ssa', from: 'SRT', to: 'SSA', fromExts: ['srt'], toExt: 'ssa', category: 'subtitle',
    blurb: 'Convert SRT to SSA, the classic SubStation Alpha format still used by older fansub tooling and players.',
    faqQ: 'SSA or ASS — which should I choose?',
    faqA: 'ASS is the newer version with more features; SSA is its predecessor. Pick SSA only if your specific tool asks for it — otherwise ASS is the safer choice.',
    aboutFrom: 'SRT is the modern plain-text subtitle standard — simple, universal, style-free.',
    aboutTo: 'SSA is the classic SubStation Alpha format from the fansub era — still required by some older encoders and scripts.',
    useCases: [
      'Feeding subtitles to legacy fansub tooling',
      'Matching an old tutorial’s required format',
      'Archiving subs in the classic format',
    ],
    tip: 'Only choose SSA if your tool specifically asks for it — ASS is the better modern choice for styled subtitles.',
    extraFaqs: [
      {
        q: 'SSA or ASS — which should I pick?',
        a: 'ASS, unless your tool explicitly requires SSA. ASS supports everything SSA does, plus more.',
      },
      {
        q: 'Is SSA obsolete?',
        a: 'Mostly — but ‘mostly’ isn’t ‘entirely’, which is why this converter exists.',
      },
    ],
    convert: sub('srt', 'ssa'),
  },
  {
    id: 'ssa-to-srt', from: 'SSA', to: 'SRT', fromExts: ['ssa'], toExt: 'srt', category: 'subtitle',
    blurb: 'Convert SSA subtitles to plain SRT for universal player support. Text and timing preserved, styling removed.',
    faqQ: 'Will karaoke timing survive?',
    faqA: 'No — SRT stores one start and end time per line, so per-syllable karaoke timing is simplified to plain cues.',
    aboutFrom: 'SSA is the older styled subtitle format — expressive, but increasingly unsupported outside niche players.',
    aboutTo: 'SRT is the safe universal choice: every player, editor and platform from the last 20 years accepts it.',
    useCases: [
      'Modernizing an old SSA subtitle collection',
      'Uploading legacy subs to YouTube',
      'Simplifying styled subs for mobile playback',
    ],
    tip: 'Karaoke timing becomes plain cues — the words and their timing stay, the per-syllable effects go.',
    extraFaqs: [
      {
        q: 'Will the text stay in sync?',
        a: 'Yes — start and end times convert precisely. Only styling and override codes are dropped.',
      },
      {
        q: 'Can I get the styling back later?',
        a: 'Not automatically — the style data is discarded. Keep your original SSA file if you might need it.',
      },
    ],
    convert: sub('ssa', 'srt'),
  },
  {
    id: 'vtt-to-ass', from: 'WebVTT', to: 'ASS', fromExts: ['vtt'], toExt: 'ass', category: 'subtitle',
    blurb: 'Convert WebVTT web captions to styled ASS subtitles for desktop players and fansub workflows.',
    faqQ: 'Do VTT positioning cues carry over?',
    faqA: 'Text and timing carry over exactly; VTT-specific positioning is simplified since ASS uses its own style system.',
    aboutFrom: 'WebVTT is built for browsers, with only basic styling. Desktop fansub workflows expect much more.',
    aboutTo: 'ASS brings full styling to your captions: fonts, colors, positioning and effects for players like VLC and MPV.',
    useCases: [
      'Restyling web captions for a fansub release',
      'Moving browser captions into Aegisub for editing',
      'Adding karaoke effects to web video captions',
    ],
    tip: 'Text and timing transfer exactly — then style freely in Aegisub, which is built for ASS.',
    extraFaqs: [
      {
        q: 'Do VTT cue settings carry over?',
        a: 'Text and timing do; VTT-specific positioning is simplified since ASS uses its own style system.',
      },
      {
        q: 'Why not go straight to SRT?',
        a: 'If you want styling, ASS is the destination. SRT is the choice when you want maximum compatibility instead.',
      },
    ],
    convert: sub('vtt', 'ass'),
  },
  {
    id: 'ass-to-vtt', from: 'ASS', to: 'WebVTT', fromExts: ['ass'], toExt: 'vtt', category: 'subtitle',
    blurb: 'Convert styled ASS subtitles to WebVTT for use in HTML5 video players on the web.',
    faqQ: 'What happens to ASS styling?',
    faqA: 'ASS style codes are stripped — WebVTT carries text and timing. The result works natively with the <track> element in browsers.',
    aboutFrom: 'ASS is the desktop styling king — but browsers don’t speak it. Web video needs WebVTT.',
    aboutTo: 'WebVTT is the native web caption format, working with the track element in every browser.',
    useCases: [
      'Publishing fansubbed video on the web',
      'Converting styled subs for an HTML5 player',
      'Making ASS dialogue work in browser-based courses',
    ],
    tip: 'ASS style codes are stripped — what remains is clean timed text that browsers render natively.',
    extraFaqs: [
      {
        q: 'Can browsers show ASS styling?',
        a: 'No — browsers only render WebVTT, and even then with limited styling. Convert first, then optionally style with ::cue CSS.',
      },
      {
        q: 'Is any dialogue lost?',
        a: 'None — every line converts with precise timing.',
      },
    ],
    convert: sub('ass', 'vtt'),
  },
  {
    id: 'vtt-to-ssa', from: 'WebVTT', to: 'SSA', fromExts: ['vtt'], toExt: 'ssa', category: 'subtitle',
    blurb: 'Convert WebVTT captions to SSA format for legacy subtitling tools that expect SubStation Alpha.',
    faqQ: 'When would I need VTT to SSA?',
    faqA: 'Rarely — usually when an old encoder or fansub script only accepts SSA. For the web, keep VTT; for modern styling, use ASS.',
    aboutFrom: 'WebVTT is modern and web-native; SSA is a legacy desktop format. Rarely do they meet — but some old tools insist.',
    aboutTo: 'SSA satisfies those legacy encoders and scripts that predate both WebVTT and ASS.',
    useCases: [
      'Feeding web captions to an old encoder',
      'Matching a legacy workflow’s format requirement',
      'Rare archival conversions',
    ],
    tip: 'This is a niche conversion — double-check your tool really wants SSA and not ASS or SRT.',
    extraFaqs: [
      {
        q: 'When would I actually need this?',
        a: 'Almost never — usually an old encoder or script that only accepts SSA. For anything else, SRT or ASS is the better target.',
      },
      {
        q: 'Does timing stay accurate?',
        a: 'Yes — timestamps convert precisely regardless of how unusual the format pair is.',
      },
    ],
    convert: sub('vtt', 'ssa'),
  },
  {
    id: 'ssa-to-vtt', from: 'SSA', to: 'WebVTT', fromExts: ['ssa'], toExt: 'vtt', category: 'subtitle',
    blurb: 'Convert SSA subtitles to WebVTT so they play as native captions in HTML5 video.',
    faqQ: 'Is any timing lost?',
    faqA: 'No — start and end times convert precisely. Only styling and override codes are dropped.',
    aboutFrom: 'SSA belongs to the desktop fansub era; the web never adopted it.',
    aboutTo: 'WebVTT brings those subtitles to browsers as native track captions.',
    useCases: [
      'Putting legacy subtitle collections on the web',
      'Converting old fansubs for HTML5 video',
      'Web publishing of SSA archives',
    ],
    tip: 'Styling and override codes are dropped — browsers render the clean timed text.',
    extraFaqs: [
      {
        q: 'Is any timing lost?',
        a: 'No — start and end times convert precisely. Only styling is dropped.',
      },
      {
        q: 'Why not convert SSA to SRT instead?',
        a: 'If the destination is the web, VTT is the native choice. For desktop players and YouTube, SRT is equivalent.',
      },
    ],
    convert: sub('ssa', 'vtt'),
  },
  {
    id: 'ass-to-ssa', from: 'ASS', to: 'SSA', fromExts: ['ass'], toExt: 'ssa', category: 'subtitle',
    blurb: 'Downgrade ASS subtitles to the older SSA format for tools that predate ASS support.',
    faqQ: 'What is lost going from ASS to SSA?',
    faqA: 'Newer ASS-only features (like advanced karaoke and some overrides) are simplified. Plain dialogue converts perfectly.',
    aboutFrom: 'ASS is SSA’s more capable successor — but a few ancient tools only understand the original.',
    aboutTo: 'SSA is the predecessor format: simpler, older, and exactly what those tools expect.',
    useCases: [
      'Downgrading subs for a pre-ASS-era tool',
      'Matching an old guide’s required format',
      'Legacy compatibility fixes',
    ],
    tip: 'This is a downgrade — keep your ASS original, since SSA can’t hold its advanced features.',
    extraFaqs: [
      {
        q: 'What exactly is lost?',
        a: 'ASS-only features like advanced karaoke and some override codes are simplified. Plain dialogue converts perfectly.',
      },
      {
        q: 'Why does this tool exist?',
        a: 'Because somewhere out there, a 15-year-old encoder still demands SSA — and now you can feed it.',
      },
    ],
    convert: sub('ass', 'ssa'),
  },
  {
    id: 'ssa-to-ass', from: 'SSA', to: 'ASS', fromExts: ['ssa'], toExt: 'ass', category: 'subtitle',
    blurb: 'Upgrade SSA subtitles to modern ASS format, unlocking better styling support in current players and editors.',
    faqQ: 'Why upgrade SSA to ASS?',
    faqA: 'ASS is supported by everything that supports SSA, plus more styling features. It is a strict upgrade with no downside.',
    aboutFrom: 'SSA was great for its time, but ASS does everything it does, better.',
    aboutTo: 'ASS is the modern styled subtitle standard — better tooling, better player support, more features.',
    useCases: [
      'Modernizing an old subtitle collection',
      'Unlocking better styling in current editors',
      'Standardizing on ASS for a fansub group',
    ],
    tip: 'This is a strict upgrade with no downside — everything that reads SSA reads ASS.',
    extraFaqs: [
      {
        q: 'Why upgrade SSA to ASS?',
        a: 'ASS is supported everywhere SSA is, plus better styling features and modern editor support. There’s no reason to stay on SSA.',
      },
      {
        q: 'Does the upgrade change my timing?',
        a: 'Not at all — it’s a format upgrade, your cues stay exactly as they were.',
      },
    ],
    convert: sub('ssa', 'ass'),
  },

  // ---------------- VIDEO (ffmpeg.wasm) ----------------
  {
    id: 'mp4-to-mp3', from: 'MP4', to: 'MP3', fromExts: ['mp4'], toExt: 'mp3', category: 'video',
    options: [AUDIO_BITRATE_OPTION],
    blurb: 'Extract the audio from any MP4 video as a high-quality MP3. Perfect for saving podcast audio, lectures, music and voice from video files.',
    faqQ: 'What audio quality do I get?',
    faqA: '192 kbps MP3 — transparent quality for music and voice that sounds identical to the original for the vast majority of listeners.',
    aboutFrom: 'MP4 is the universal video container — video and audio bundled together. Often you only want the audio.',
    aboutTo: 'MP3 is the universal audio format: tiny files that play on every device, car stereo and app ever made.',
    useCases: [
      'Saving podcast audio from a video file',
      'Extracting lecture audio for offline listening',
      'Ripping audio from screen recordings for editing',
    ],
    tip: 'We encode at 192 kbps — transparent quality for music and voice, at roughly 1.4 MB per minute.',
    extraFaqs: [
      {
        q: 'What audio quality do I get?',
        a: '192 kbps MP3 — indistinguishable from the original for the vast majority of listeners, including music.',
      },
      {
        q: 'How big will the MP3 be?',
        a: 'About 1.4 MB per minute of audio. A 10-minute video’s audio becomes roughly a 14 MB MP3.',
      },
      {
        q: 'Can I extract audio from a 2-hour video?',
        a: 'Yes, as long as the file stays under ~500 MB — beyond that browsers tend to run out of memory.',
      },
      {
        q: 'Does it keep the video too?',
        a: 'No — the video track is discarded and only the audio is kept. That’s exactly what makes the file so much smaller.',
      },
    ],
    flagship: true,
    convert: vid(TO_MP3, 'mp3', 'audio/mpeg'),
    loadingNote: FFMPEG_NOTE,
  },
  {
    id: 'mov-to-mp4', from: 'MOV', to: 'MP4', fromExts: ['mov'], toExt: 'mp4', category: 'video',
    options: [VIDEO_CRF_OPTION],
    blurb: 'Convert Apple MOV videos to universal MP4 so they play on Windows, Android, smart TVs and every video editor.',
    faqQ: 'Will I lose quality converting MOV to MP4?',
    faqA: 'Visually, no. We re-encode with H.264 at CRF 23 — the sweet spot where compression is strong but artifacts are invisible in normal viewing.',
    aboutFrom: 'MOV is Apple’s QuickTime container — the default from iPhones and Macs. Great quality, but Windows and web players sometimes choke on it.',
    aboutTo: 'MP4 with H.264 is the one video format that plays absolutely everywhere: every browser, phone, TV and editor.',
    useCases: [
      'Making iPhone videos playable on Windows',
      'Converting MOV for YouTube upload',
      'Preparing Mac screen recordings for sharing',
    ],
    tip: 'We re-encode with H.264 at CRF 23 — visually identical to your MOV at a much friendlier file size.',
    extraFaqs: [
      {
        q: 'Will I lose quality?',
        a: 'Visually, no — CRF 23 is the sweet spot where compression is strong but artifacts are invisible in normal viewing.',
      },
      {
        q: 'Why not just rename .mov to .mp4?',
        a: 'Renaming doesn’t change the actual video data and often breaks playback. Real conversion re-encodes properly.',
      },
    ],
    convert: vid(TO_MP4, 'mp4', 'video/mp4'),
    loadingNote: FFMPEG_NOTE,
  },
  {
    id: 'mkv-to-mp4', from: 'MKV', to: 'MP4', fromExts: ['mkv'], toExt: 'mp4', category: 'video',
    options: [VIDEO_CRF_OPTION],
    blurb: 'Convert MKV videos to MP4 for playback on phones, smart TVs, tablets and anything that refuses Matroska files.',
    faqQ: 'What happens to subtitles or extra audio tracks in my MKV?',
    faqA: 'The main video and audio tracks convert. Extra audio tracks, subtitles and chapters are not carried into the MP4.',
    aboutFrom: 'MKV (Matroska) is the enthusiast’s container — it holds anything: multiple audio tracks, subtitles, chapters. But phones, TVs and browsers often refuse it.',
    aboutTo: 'MP4 is the compatibility container: one video track, one audio track, plays everywhere from iPhones to smart TVs.',
    useCases: [
      'Making downloaded MKV movies play on a smart TV',
      'Converting MKV for iPhone/Android playback',
      'Preparing MKV for video editors that prefer MP4',
    ],
    tip: 'Extra audio tracks and subtitles in the MKV aren’t carried over — the main video and audio tracks convert.',
    extraFaqs: [
      {
        q: 'What happens to subtitles in my MKV?',
        a: 'They’re not carried into the MP4 — extract them separately if you need them.',
      },
      {
        q: 'How long does conversion take?',
        a: 'Roughly proportional to video length — a 2-minute clip takes well under a minute on a modern laptop.',
      },
    ],
    convert: vid(TO_MP4, 'mp4', 'video/mp4'),
    loadingNote: FFMPEG_NOTE,
  },
  {
    id: 'webm-to-mp4', from: 'WebM', to: 'MP4', fromExts: ['webm'], toExt: 'mp4', category: 'video',
    options: [VIDEO_CRF_OPTION],
    blurb: 'Convert WebM videos to MP4 for editing in Premiere, DaVinci or CapCut — and for playback on devices that ignore WebM.',
    faqQ: 'Where do WebM files usually come from?',
    faqA: 'Mostly browsers: screen recordings, downloaded web videos, and some Android apps save video as WebM.',
    aboutFrom: 'WebM is the web’s open video format — efficient and royalty-free, but poorly supported outside browsers.',
    aboutTo: 'MP4/H.264 is the safe universal format for sharing, editing and uploading anywhere.',
    useCases: [
      'Converting WebM screen recordings for Premiere or DaVinci',
      'Making WebM clips editable in mobile apps',
      'Uploading WebM to platforms that want MP4',
    ],
    tip: 'WebM uses VP9/Opus internally; we transcode to H.264/AAC — the combination every editor and platform expects.',
    extraFaqs: [
      {
        q: 'Where do WebM files come from?',
        a: 'Mostly browsers — screen recordings, downloaded web videos, and some Android apps save as WebM.',
      },
      {
        q: 'Does quality suffer?',
        a: 'Minimally — CRF 23 H.264 preserves the visual quality while producing a widely compatible file.',
      },
    ],
    convert: vid(TO_MP4, 'mp4', 'video/mp4'),
    loadingNote: FFMPEG_NOTE,
  },
  {
    id: 'avi-to-mp4', from: 'AVI', to: 'MP4', fromExts: ['avi'], toExt: 'mp4', category: 'video',
    options: [VIDEO_CRF_OPTION],
    blurb: 'Convert ancient AVI files to modern MP4 — far smaller files that play on every current device.',
    faqQ: 'Why are my AVI files so big?',
    faqA: 'Many AVIs use 20-year-old codecs with poor compression. Modern H.264 does the same job at a fraction of the size.',
    aboutFrom: 'AVI is Microsoft’s 1992 container — ancient, inefficient, and still floating around in old cameras and archives.',
    aboutTo: 'MP4 drags that video into the modern era: far smaller files, universal playback.',
    useCases: [
      'Modernizing old camera AVI footage',
      'Converting AVI archives for phone playback',
      'Making ancient video files emailable',
    ],
    tip: 'AVI files are often huge for their quality — expect the MP4 to be dramatically smaller with no visible difference.',
    extraFaqs: [
      {
        q: 'Why are my AVI files so big?',
        a: 'Many AVIs use 20-year-old codecs with poor compression. Modern H.264 does the same job at a fraction of the size.',
      },
      {
        q: 'Will very old AVIs convert?',
        a: 'Most will. A few use truly obscure codecs from the 90s — if one fails, that’s usually why.',
      },
    ],
    convert: vid(TO_MP4, 'mp4', 'video/mp4'),
    loadingNote: FFMPEG_NOTE,
  },
  {
    id: 'mp4-to-webm', from: 'MP4', to: 'WebM', fromExts: ['mp4'], toExt: 'webm', category: 'video',
    options: [VIDEO_CRF_OPTION],
    blurb: 'Convert MP4 to WebM (VP9 + Opus) — the open, royalty-free video format for HTML5 players and open-web publishing.',
    faqQ: 'Why convert MP4 to WebM?',
    faqA: 'For open-web publishing: WebM is royalty-free, so you avoid H.264 licensing concerns on your own platform — and it streams beautifully in browsers.',
    aboutFrom: 'MP4/H.264 is universal but patent-encumbered; for open web projects, royalty-free matters.',
    aboutTo: 'WebM (VP9 + Opus) is the open, royalty-free web video format — ideal for HTML5 video on your own site.',
    useCases: [
      'Preparing videos for a website’s HTML5 player',
      'Creating royalty-free video assets for open-source projects',
      'Publishing video where open codecs are required',
    ],
    tip: 'VP9 encoding is slower than H.264 — give it time on longer videos. The result is worth it for web use.',
    extraFaqs: [
      {
        q: 'Why convert MP4 to WebM?',
        a: 'For open-web publishing: WebM is royalty-free, so you avoid H.264 licensing concerns on your own platform.',
      },
      {
        q: 'Do browsers play WebM?',
        a: 'Chrome, Edge, Firefox and Android do. Safari added support more recently — for maximum reach, keep an MP4 fallback.',
      },
    ],
    convert: vid(TO_WEBM, 'webm', 'video/webm'),
    loadingNote: FFMPEG_NOTE,
  },
  {
    id: 'video-to-gif', from: 'Video', to: 'GIF', fromExts: ['mp4', 'mov'], toExt: 'gif', category: 'video',
    blurb: 'Turn a video clip into an animated GIF in one click — we convert the first 10 seconds at 480px. For trimming, custom length and quality control, use the GIF Maker studio.',
    faqQ: 'How long is the resulting GIF?',
    faqA: 'The first 10 seconds of your video. For a custom section, longer clips or quality options, use the dedicated GIF Maker page.',
    aboutFrom: 'Video clips capture moments perfectly — but they’re heavy, need a player, and don’t autoplay everywhere.',
    aboutTo: 'GIFs are the internet’s universal animation: they play inline on every site, chat app and forum ever made.',
    useCases: [
      'Turning a funny clip into a shareable reaction GIF',
      'Making a quick demo animation for documentation',
      'Creating a looping preview from a video',
    ],
    tip: 'This one-click version converts the first 10 seconds at 480px — for trimming, custom length and quality control, use the GIF Maker studio.',
    extraFaqs: [
      {
        q: 'How long is the resulting GIF?',
        a: 'The first 10 seconds of your video. For a custom section or longer clips, the GIF Maker page lets you trim up to 15 seconds.',
      },
      {
        q: 'Why is my GIF file so big?',
        a: 'GIFs store every frame as an image — they’re inherently heavy. Shorter clips, smaller widths and lower FPS all shrink the file.',
      },
    ],
    convert: vgif(),
    loadingNote: FFMPEG_NOTE,
  },
  {
    id: 'm4v-to-mp4', from: 'M4V', to: 'MP4', fromExts: ['m4v'], toExt: 'mp4', category: 'video',
    options: [VIDEO_CRF_OPTION],
    blurb: 'Convert Apple M4V videos to standard MP4 for playback on Android, Windows and everything else.',
    faqQ: 'What is the difference between M4V and MP4?',
    faqA: 'Technically very little — M4V is Apple\u2019s variant of MP4. Conversion is quick and preserves quality.',
    aboutFrom: 'M4V is Apple’s iTunes-era video format — essentially MP4’s close cousin, occasionally with DRM.',
    aboutTo: 'MP4 is the DRM-free universal standard that plays on everything.',
    useCases: [
      'Converting old iTunes video purchases (non-DRM) for modern devices',
      'Making M4V files play on Android',
      'Standardizing an Apple-heavy video library',
    ],
    tip: 'DRM-protected M4V files from the iTunes Store can’t be converted — only DRM-free M4V works.',
    extraFaqs: [
      {
        q: 'What’s the difference between M4V and MP4?',
        a: 'Technically very little — M4V is Apple’s variant of MP4. Conversion is quick and preserves quality.',
      },
      {
        q: 'Why won’t my M4V convert?',
        a: 'If it was bought from iTunes with DRM, no converter can touch it. DRM-free M4V converts fine.',
      },
    ],
    convert: vid(TO_MP4, 'mp4', 'video/mp4'),
    loadingNote: FFMPEG_NOTE,
  },
  {
    id: '3gp-to-mp4', from: '3GP', to: 'MP4', fromExts: ['3gp'], toExt: 'mp4', category: 'video',
    options: [VIDEO_CRF_OPTION],
    blurb: 'Convert old 3GP mobile videos to MP4 so they play on modern phones, computers and the web.',
    faqQ: 'Will the quality improve?',
    faqA: 'No — conversion preserves the original quality exactly. 3GP was low-resolution by design, made for tiny early-2000s phone screens.',
    aboutFrom: '3GP is the ancient mobile video format — tiny, low-resolution clips from early-2000s phones.',
    aboutTo: 'MP4 makes those clips playable on modern phones, computers and the web.',
    useCases: [
      'Rescuing old phone videos for modern playback',
      'Converting 3GP archives for YouTube',
      'Making ancient mobile clips shareable',
    ],
    tip: 'Don’t expect HD — 3GP was made for tiny screens. The MP4 preserves what quality exists; it can’t invent more.',
    extraFaqs: [
      {
        q: 'Where do 3GP files come from?',
        a: 'Old mobile phones (2000s–early 2010s) and some MMS messages. If you found one, it’s a time capsule.',
      },
      {
        q: 'Will the quality improve?',
        a: 'No — conversion preserves the original quality exactly. 3GP was low-resolution by design.',
      },
    ],
    convert: vid(TO_MP4, 'mp4', 'video/mp4'),
    loadingNote: FFMPEG_NOTE,
  },
  {
    id: 'flv-to-mp4', from: 'FLV', to: 'MP4', fromExts: ['flv'], toExt: 'mp4', category: 'video',
    options: [VIDEO_CRF_OPTION],
    blurb: 'Convert Flash-era FLV videos to MP4 — rescuing old downloads into a format that plays today.',
    faqQ: 'Why won\u2019t anything play my FLV?',
    faqA: 'Flash was discontinued in 2020 and browsers removed support. Converting to MP4 is the fix.',
    aboutFrom: 'FLV (Flash Video) powered YouTube’s early years — then Flash died, and FLV players went with it.',
    aboutTo: 'MP4 rescues that content into a format that plays on everything today.',
    useCases: [
      'Recovering old Flash-era video downloads',
      'Converting FLV archives for modern playback',
      'Making legacy video content uploadable',
    ],
    tip: 'FLV quality was often low by today’s standards — the MP4 will look the same, just playable.',
    extraFaqs: [
      {
        q: 'Why won’t anything play my FLV?',
        a: 'Flash was discontinued in 2020 and browsers removed support. Converting to MP4 is the fix.',
      },
      {
        q: 'Does FLV to MP4 improve quality?',
        a: 'No — but it makes the video playable again, which is the whole point.',
      },
    ],
    convert: vid(TO_MP4, 'mp4', 'video/mp4'),
    loadingNote: FFMPEG_NOTE,
  },

  // ---------------- AUDIO (ffmpeg.wasm) ----------------
  {
    id: 'wav-to-mp3', from: 'WAV', to: 'MP3', fromExts: ['wav'], toExt: 'mp3', category: 'audio',
    options: [AUDIO_BITRATE_OPTION],
    blurb: 'Convert huge WAV files to compact MP3s at 192 kbps — about 7x smaller with no audible difference.',
    faqQ: 'Will I hear a difference?',
    faqA: 'Almost certainly not — 192 kbps MP3 is transparent for the vast majority of listeners, even on good headphones.',
    aboutFrom: 'WAV is uncompressed CD-quality audio — perfect fidelity, enormous files (about 10 MB per minute).',
    aboutTo: 'MP3 at 192 kbps keeps that audio sounding identical to almost every ear at roughly one-seventh the size.',
    useCases: [
      'Shrinking WAV recordings for sharing',
      'Converting studio exports for streaming',
      'Making voice memos emailable',
    ],
    tip: '192 kbps is the sweet spot — below 128 kbps you’d start hearing the difference on music.',
    extraFaqs: [
      {
        q: 'Will I hear a difference?',
        a: 'Almost certainly not — 192 kbps MP3 is transparent for the vast majority of listeners, even on good headphones.',
      },
      {
        q: 'How much smaller?',
        a: 'Roughly 7x smaller. A 50 MB WAV becomes about a 7 MB MP3.',
      },
    ],
    convert: vid(TO_MP3, 'mp3', 'audio/mpeg'),
    loadingNote: FFMPEG_NOTE,
  },
  {
    id: 'flac-to-mp3', from: 'FLAC', to: 'MP3', fromExts: ['flac'], toExt: 'mp3', category: 'audio',
    options: [AUDIO_BITRATE_OPTION],
    blurb: 'Convert lossless FLAC music to universal MP3 for car stereos, phones and anywhere FLAC won\u2019t play.',
    faqQ: 'Isn\u2019t FLAC better than MP3?',
    faqA: 'Technically yes — FLAC is lossless. But in blind tests almost nobody can tell 192 kbps MP3 from FLAC. Compatibility and size are MP3\u2019s wins.',
    aboutFrom: 'FLAC is audiophile-grade lossless compression — bit-perfect, but still 5x bigger than MP3.',
    aboutTo: 'MP3 trades inaudible detail for universal compatibility and tiny files.',
    useCases: [
      'Making FLAC music playable in the car',
      'Converting a FLAC library for a phone with limited storage',
      'Sharing lossless rips with friends',
    ],
    tip: 'Keep your FLAC originals archived — convert copies to MP3 for portable use.',
    extraFaqs: [
      {
        q: 'Isn’t FLAC better than MP3?',
        a: 'Technically yes — FLAC is lossless. But in blind tests almost nobody can tell 192 kbps MP3 from FLAC. Compatibility and size are MP3’s wins.',
      },
      {
        q: 'Do tags (artist, album) survive?',
        a: 'Yes — metadata tags carry over to the MP3.',
      },
    ],
    convert: vid(TO_MP3, 'mp3', 'audio/mpeg'),
    loadingNote: FFMPEG_NOTE,
  },
  {
    id: 'ogg-to-mp3', from: 'OGG', to: 'MP3', fromExts: ['ogg', 'oga'], toExt: 'mp3', category: 'audio',
    options: [AUDIO_BITRATE_OPTION],
    blurb: 'Convert OGG Vorbis audio to MP3 for playback on iPhones, car stereos and everything that ignores OGG.',
    faqQ: 'Where do OGG files come from?',
    faqA: 'Spotify\u2019s local files, many video games, and open-source projects. OGG is excellent — just not universal.',
    aboutFrom: 'OGG Vorbis is the open-source audio codec — great quality, but spotty support on Apple devices and car stereos.',
    aboutTo: 'MP3 plays on literally everything with an audio chip.',
    useCases: [
      'Playing OGG music on an iPhone',
      'Converting game audio rips for general use',
      'Making OGG files car-stereo compatible',
    ],
    tip: 'OGG and MP3 at similar bitrates sound the same — this conversion is purely about compatibility.',
    extraFaqs: [
      {
        q: 'Where do OGG files come from?',
        a: 'Spotify’s local files, many video games, and open-source projects. It’s excellent — just not universal.',
      },
      {
        q: 'Quality loss?',
        a: 'Negligible at 192 kbps. You’re transcoding between two good lossy codecs; the difference is inaudible to nearly everyone.',
      },
    ],
    convert: vid(TO_MP3, 'mp3', 'audio/mpeg'),
    loadingNote: FFMPEG_NOTE,
  },
  {
    id: 'm4a-to-mp3', from: 'M4A', to: 'MP3', fromExts: ['m4a'], toExt: 'mp3', category: 'audio',
    options: [AUDIO_BITRATE_OPTION],
    blurb: 'Convert Apple M4A audio to MP3 for old MP3 players, DJ software and maximum compatibility.',
    faqQ: 'Is M4A better than MP3?',
    faqA: 'Marginally more efficient at the same bitrate. In practice 192 kbps of either sounds identical — pick based on compatibility.',
    aboutFrom: 'M4A (AAC) is Apple’s audio format — the iTunes default. Great quality, but some older players and DJ software want MP3.',
    aboutTo: 'MP3 is the safe universal audio format nothing rejects.',
    useCases: [
      'Converting iTunes purchases for old MP3 players',
      'Preparing audio for DJ software that prefers MP3',
      'Standardizing a mixed audio library',
    ],
    tip: 'M4A/AAC is technically slightly more efficient than MP3 — but at 192 kbps the difference is inaudible, and compatibility wins.',
    extraFaqs: [
      {
        q: 'Is M4A better than MP3?',
        a: 'Marginally more efficient at the same bitrate. In practice 192 kbps of either sounds identical — pick based on compatibility.',
      },
      {
        q: 'Do protected iTunes files convert?',
        a: 'Old DRM-protected M4P files won’t. Standard DRM-free M4A converts fine.',
      },
    ],
    convert: vid(TO_MP3, 'mp3', 'audio/mpeg'),
    loadingNote: FFMPEG_NOTE,
  },
  {
    id: 'aac-to-mp3', from: 'AAC', to: 'MP3', fromExts: ['aac'], toExt: 'mp3', category: 'audio',
    options: [AUDIO_BITRATE_OPTION],
    blurb: 'Convert AAC audio to MP3 — the compatibility baseline every device supports.',
    faqQ: 'AAC vs MP3 quality?',
    faqA: 'AAC is more efficient on paper, but at 192 kbps both are transparent to human hearing. This conversion is about compatibility.',
    aboutFrom: 'AAC is the modern efficient codec behind YouTube, iTunes and broadcasts — better than MP3 on paper, less universal in practice.',
    aboutTo: 'MP3 remains the compatibility baseline every device supports.',
    useCases: [
      'Converting AAC streams for legacy hardware',
      'Standardizing audio for maximum compatibility',
      'Preparing AAC for MP3-only workflows',
    ],
    tip: 'At 192 kbps both codecs are transparent — convert for compatibility, not quality.',
    extraFaqs: [
      {
        q: 'AAC vs MP3 quality?',
        a: 'AAC is more efficient on paper, but at 192 kbps both are transparent to human hearing. This conversion is about compatibility.',
      },
      {
        q: 'Where do raw AAC files come from?',
        a: 'Video extraction, broadcasts, and some Android recordings save audio as bare AAC.',
      },
    ],
    convert: vid(TO_MP3, 'mp3', 'audio/mpeg'),
    loadingNote: FFMPEG_NOTE,
  },
  {
    id: 'mp3-to-wav', from: 'MP3', to: 'WAV', fromExts: ['mp3'], toExt: 'wav', category: 'audio',
    blurb: 'Convert MP3 to uncompressed WAV for editing in a DAW or any pro audio workflow that demands WAV.',
    faqQ: 'Will it sound better as WAV?',
    faqA: 'No — conversion can\u2019t recover what MP3 compression removed. The benefit is compatibility with pro tools, not quality.',
    aboutFrom: 'MP3 is the compact universal format — but it’s lossy, and some pro workflows demand uncompressed audio.',
    aboutTo: 'WAV is uncompressed PCM: the studio standard that every DAW and audio tool accepts.',
    useCases: [
      'Preparing MP3 for editing in a DAW',
      'Converting MP3 for audio software that needs WAV',
      'Making MP3s CD-burn ready',
    ],
    tip: 'This won’t restore quality the MP3 discarded — it just gives you an uncompressed container for editing.',
    extraFaqs: [
      {
        q: 'Will it sound better as WAV?',
        a: 'No — conversion can’t recover what MP3 compression removed. The benefit is compatibility with pro tools, not quality.',
      },
      {
        q: 'Why is the WAV so big?',
        a: 'Uncompressed audio is ~10 MB per minute. That’s normal — it’s the price of the studio standard.',
      },
    ],
    convert: vid(TO_WAV, 'wav', 'audio/wav'),
    loadingNote: FFMPEG_NOTE,
  },
  {
    id: 'ogg-to-wav', from: 'OGG', to: 'WAV', fromExts: ['ogg', 'oga'], toExt: 'wav', category: 'audio',
    blurb: 'Convert OGG audio to uncompressed WAV for editors, samplers and game engines that only accept WAV.',
    faqQ: 'Does WAV improve OGG quality?',
    faqA: 'No — it preserves it exactly. The WAV is bigger, not better. The point is compatibility with WAV-only software.',
    aboutFrom: 'OGG Vorbis is efficient and open — but pro audio tools and some game engines want plain WAV.',
    aboutTo: 'WAV is the uncompressed interchange format: no codec, no patents, no surprises.',
    useCases: [
      'Converting game audio OGGs for editing',
      'Preparing OGG for sample libraries',
      'Getting OGG into WAV-only software',
    ],
    tip: 'Like all lossy-to-lossless conversions, quality stays exactly as good as the OGG — no better, no worse.',
    extraFaqs: [
      {
        q: 'Does WAV improve OGG quality?',
        a: 'No — it preserves it exactly. The WAV is bigger, not better. The point is compatibility with WAV-only software.',
      },
      {
        q: 'Why would I want that?',
        a: 'Some audio editors, samplers and game engines only accept WAV. This conversion is the bridge.',
      },
    ],
    convert: vid(TO_WAV, 'wav', 'audio/wav'),
    loadingNote: FFMPEG_NOTE,
  },
  {
    id: 'wma-to-mp3', from: 'WMA', to: 'MP3', fromExts: ['wma'], toExt: 'mp3', category: 'audio',
    options: [AUDIO_BITRATE_OPTION],
    blurb: 'Convert old Windows WMA rips to MP3 — rescuing 2000s music collections for modern playback.',
    faqQ: 'Where do WMA files come from?',
    faqA: 'Windows Media Player CD rips from the 2000s. If you ripped CDs on Windows back then, you probably have WMAs.',
    aboutFrom: 'WMA is Microsoft’s 2000s-era audio format — once bundled with Windows Media Player, now largely abandoned.',
    aboutTo: 'MP3 brings that audio into the modern world of universal playback.',
    useCases: [
      'Converting old Windows Media rips',
      'Rescuing a WMA music collection',
      'Making WMA files phone-compatible',
    ],
    tip: 'DRM-protected WMA files (from old music stores) can’t be converted — only plain WMA works.',
    extraFaqs: [
      {
        q: 'Where do WMA files come from?',
        a: 'Windows Media Player CD rips from the 2000s. If you ripped CDs on Windows back then, you probably have WMAs.',
      },
      {
        q: 'Why won’t my WMA convert?',
        a: 'If it was bought from an old DRM music store, it’s locked. Plain ripped WMAs convert fine.',
      },
    ],
    convert: vid(TO_MP3, 'mp3', 'audio/mpeg'),
    loadingNote: FFMPEG_NOTE,
  },

  // ---------------- PDF (pdf.js + pdf-lib, lazy-loaded) ----------------
  {
    id: 'pdf-to-jpg', from: 'PDF', to: 'JPG', fromExts: ['pdf'], toExt: 'jpg', category: 'pdf',
    widget: 'pdf',
    loadingNote: PDF_ENGINE_NOTE,
    blurb: 'Convert every page of a PDF into crisp JPG images — download pages individually or all at once as a ZIP. Perfect for sharing document pages as images, posting to social media, or pulling figures out of a report.',
    faqQ: 'How do I turn PDF pages into JPG images?',
    faqA: 'Drop your PDF above and hit convert. Each page renders as a high-resolution JPG you can download individually — or grab every page at once as a ZIP file. Everything happens in your browser; the PDF is never uploaded.',
    aboutFrom: 'PDF is the universal document format — contracts, ebooks, reports and forms. But PDF pages can\u2019t be posted as images or opened in every photo app.',
    aboutTo: 'JPG is the world\u2019s most compatible image format. As page images, your document opens anywhere — phones, social apps, email and websites that don\u2019t accept PDFs.',
    useCases: [
      'Sharing a document page as an image on WhatsApp or social media',
      'Extracting charts and figures from a PDF report',
      'Converting PDF pages for a presentation when the venue PC has no PDF reader',
    ],
    tip: 'Pages render at double resolution (2x) so text stays sharp — and each JPG downloads individually, so you can grab just the pages you need.',
    flagship: true,
    extraFaqs: [
      {
        q: 'What resolution are the JPG images?',
        a: 'Each page renders at 2x scale — roughly 1700\u00d72200 px for a standard A4 page — so text stays crisp even when zoomed.',
      },
      {
        q: 'Can I download all pages at once?',
        a: 'Yes — "Download all as ZIP" gives you every page image in one file, or download pages individually.',
      },
      {
        q: 'Is there a page limit?',
        a: 'PDFs up to 150 pages convert in the browser. For larger documents, split them first with our free Split PDF tool.',
      },
      {
        q: 'Do password-protected PDFs work?',
        a: 'No — the browser version cannot open password-protected PDFs. Remove the password in your desktop PDF reader first, then convert.',
      },
      {
        q: 'PDF to JPG or PDF to PNG?',
        a: 'JPG for the smallest files (great for sharing); PNG when you need pixel-perfect quality for print or archiving.',
      },
    ],
  },
  {
    id: 'pdf-to-png', from: 'PDF', to: 'PNG', fromExts: ['pdf'], toExt: 'png', category: 'pdf',
    widget: 'pdf',
    loadingNote: PDF_ENGINE_NOTE,
    blurb: 'Convert PDF pages to lossless PNG images at high resolution. Choose PNG when every pixel matters — print, archiving, or documents with fine text and diagrams.',
    faqQ: 'Why convert PDF pages to PNG instead of JPG?',
    faqA: 'PNG is lossless — text edges and diagrams stay razor-sharp with zero compression artifacts. Files are bigger than JPG, but quality is pixel-perfect.',
    aboutFrom: 'PDF pages mix text, vector graphics and images in one document. When you need a page as a picture with no quality compromise, PNG is the answer.',
    aboutTo: 'PNG preserves every pixel exactly — the right choice for print, archiving, and documents where fine text must stay perfectly legible.',
    useCases: [
      'Archiving important document pages as pixel-perfect images',
      'Extracting diagrams from a PDF for a print publication',
      'Converting pages for OCR software that prefers PNG input',
    ],
    tip: 'PNGs are bigger than JPGs — if you are just sharing on chat, PDF to JPG gives much smaller files.',
    extraFaqs: [
      {
        q: 'How big will the PNG files be?',
        a: 'Bigger than JPG — a full A4 page at 2x can be 1\u20133 MB. That is the price of lossless quality.',
      },
      {
        q: 'Does PNG keep the text selectable?',
        a: 'No — the output is an image of the page. Use our PDF to Text tool if you need the actual words.',
      },
    ],
  },
  {
    id: 'jpg-to-pdf', from: 'JPG', to: 'PDF', fromExts: ['jpg', 'jpeg'], toExt: 'pdf', category: 'pdf',
    widget: 'pdf',
    alsoIn: ['image'],
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Turn JPG photos and scans into a single PDF document — one image per page, in the order you choose. The classic fix for "please send it as a PDF".',
    faqQ: 'How do I combine JPG images into one PDF?',
    faqA: 'Drop your JPGs above — pick several at once — arrange them if needed, set quality, and download a single PDF with one image per page. All in your browser, nothing uploaded.',
    aboutFrom: 'JPGs are how phones save photos and scans — but offices, universities and forms almost always ask for PDF.',
    aboutTo: 'PDF packages your images into one professional document that prints cleanly and opens identically everywhere.',
    useCases: [
      'Turning phone photos of documents into a single PDF for email',
      'Combining scanned pages into one file for a job or visa application',
      'Converting JPG screenshots into a PDF report',
    ],
    tip: 'Drop multiple JPGs at once — they become pages in order. Quality 92 is perfect for documents; go lower if the PDF must stay tiny for upload forms.',
    flagship: true,
    extraFaqs: [
      {
        q: 'Can I add multiple JPGs to one PDF?',
        a: 'Yes — select several images at once and each becomes a page, in the order shown. This is the main reason people use this tool.',
      },
      {
        q: 'What page size will the PDF use?',
        a: 'Each page matches its image\u2019s dimensions, so nothing is stretched or cropped — photos keep their exact aspect ratio.',
      },
      {
        q: 'How do I keep the PDF small for uploads?',
        a: 'Lower the quality slider to 70\u201380. For scanned documents the difference is invisible and the file shrinks dramatically.',
      },
      {
        q: 'JPG to PDF or PNG to PDF?',
        a: 'JPG to PDF for photos and scans (smaller). PNG to PDF when the images have sharp text you cannot afford to soften.',
      },
      {
        q: 'Will the PDF look the same when printed?',
        a: 'Yes — each page is your image at full resolution, so printing reproduces it faithfully.',
      },
    ],
  },
  {
    id: 'png-to-pdf', from: 'PNG', to: 'PDF', fromExts: ['png'], toExt: 'pdf', category: 'pdf',
    widget: 'pdf',
    alsoIn: ['image'],
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Convert PNG screenshots and graphics into a clean PDF — one image per page. Ideal when a form or office asks for PDF but all you have are PNGs.',
    faqQ: 'Why would I convert PNG to PDF?',
    faqA: 'Forms, applications and offices standardize on PDF. This tool wraps your PNGs — screenshots, designs, scans — into a proper PDF document in seconds.',
    aboutFrom: 'PNG is the format of screenshots and crisp graphics — lossless, but not what forms and offices accept.',
    aboutTo: 'PDF is the document standard: one file, printable, accepted by every institution and upload form.',
    useCases: [
      'Submitting PNG screenshots as a PDF for a support ticket or application',
      'Turning design mockups into a presentable PDF',
      'Converting scanned PNGs into a single document',
    ],
    tip: 'PNG sources stay sharp — the PDF embeds them at full quality, so text screenshots remain perfectly readable.',
    extraFaqs: [
      {
        q: 'Can I merge several PNGs into one PDF?',
        a: 'Yes — drop multiple PNGs and each becomes a page in order.',
      },
      {
        q: 'Will transparency in my PNGs survive?',
        a: 'Transparent areas become white in the PDF, since PDF pages have a white background.',
      },
    ],
  },
  {
    id: 'webp-to-pdf', from: 'WebP', to: 'PDF', fromExts: ['webp'], toExt: 'pdf', category: 'image',
    widget: 'pdf',
    alsoIn: ['pdf'],
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Convert WebP images into a PDF document — one image per page. Handy when a form or office demands PDF but your images are modern WebPs.',
    faqQ: 'Why convert WebP to PDF?',
    faqA: 'Many official forms, universities and offices only accept PDF uploads. If your screenshots or downloads are WebP, this wraps them into a proper PDF in seconds — each image on its own page.',
    aboutFrom: 'WebP is the modern, super-efficient image format — a third smaller than JPG or PNG. But officialdom moves slowly: plenty of upload forms still reject anything that is not a PDF.',
    aboutTo: 'PDF is the document format every institution accepts: printable, unchangeable-looking, and identical on every screen.',
    useCases: [
      'Submitting WebP screenshots as a PDF for a support ticket or application',
      'Turning downloaded WebP images into a printable document',
      'Combining several WebP graphics into one PDF portfolio page set',
    ],
    tip: 'Drop several WebPs at once — each becomes a page in order, so a folder of screenshots becomes a document in one go.',
    extraFaqs: [
      {
        q: 'Can I add multiple WebP images to one PDF?',
        a: 'Yes — select several at once and each becomes a page, in the order shown. Perfect for turning a set of screenshots into one file.',
      },
      {
        q: 'Will the PDF keep the WebP quality?',
        a: 'Yes — images are embedded at high quality, so what you see in the WebP is what lands in the PDF.',
      },
      {
        q: 'What about WebP transparency?',
        a: 'Transparent areas become white, since PDF pages have a white background. If transparency matters, keep the WebP as-is.',
      },
    ],
  },
  {
    id: 'gif-to-pdf', from: 'GIF', to: 'PDF', fromExts: ['gif'], toExt: 'pdf', category: 'image',
    widget: 'pdf',
    alsoIn: ['pdf'],
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Turn GIFs into a PDF — the first frame of each GIF becomes a page. Useful for archiving memes, reaction images or animated diagrams as a document.',
    faqQ: 'Does the PDF keep the animation?',
    faqA: 'No — PDF is a document format, so each GIF contributes its first frame as a still image on its own page. The result is perfect for archiving and printing.',
    aboutFrom: 'GIFs are the internet’s flip-books — short loops everyone recognizes. But try attaching one to a formal application and you will be asked for a PDF.',
    aboutTo: 'PDF freezes each GIF’s representative frame into a clean, printable page — the archivable version of your animations.',
    useCases: [
      'Archiving a set of GIFs as a single document',
      'Printing animated diagrams as stills for a report',
      'Converting meme GIFs into shareable PDF pages',
    ],
    tip: 'Each GIF becomes one page using its first frame — for most GIFs that is the intended still image.',
    extraFaqs: [
      {
        q: 'Which frame of the GIF ends up in the PDF?',
        a: 'The first frame — for the vast majority of GIFs, that is the representative image the creator intended.',
      },
      {
        q: 'Can I convert several GIFs at once?',
        a: 'Yes — drop multiple GIFs and each becomes its own page in the PDF, in order.',
      },
      {
        q: 'Will the PDF be big?',
        a: 'No — a single still frame per GIF keeps the PDF small. Lower the quality slider if you need it tiny for uploads.',
      },
    ],
  },
  {
    id: 'bmp-to-pdf', from: 'BMP', to: 'PDF', fromExts: ['bmp', 'dib'], toExt: 'pdf', category: 'image',
    widget: 'pdf',
    alsoIn: ['pdf'],
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Convert bulky BMP files into a compact PDF — one image per page. The fastest way to make ancient BMP scans emailable and printable.',
    faqQ: 'Why convert BMP to PDF instead of JPG?',
    faqA: 'When the destination is a form, an office or a printer, PDF is what they ask for. This skips the middleman: your BMPs go straight into a proper document, dramatically smaller than the BMPs themselves.',
    aboutFrom: 'BMP is Windows’ ancient uncompressed bitmap — every pixel stored raw. A single scan can be tens of megabytes, far too heavy to email.',
    aboutTo: 'PDF wraps your images into the universal document format — and because the images are re-encoded, the PDF is a fraction of the BMP’s size.',
    useCases: [
      'Turning old BMP scans into an emailable PDF',
      'Submitting legacy BMP images to forms that require PDF',
      'Archiving BMP screenshots as a compact document',
    ],
    tip: 'BMPs are enormous, so this conversion shrinks them dramatically — a 20 MB BMP often becomes a 1–2 MB PDF page.',
    extraFaqs: [
      {
        q: 'How much smaller will the PDF be than my BMP?',
        a: 'Dramatically — BMP stores pixels uncompressed, so expect 80–95% smaller files with no visible difference for scans and screenshots.',
      },
      {
        q: 'Can I combine several BMPs into one PDF?',
        a: 'Yes — each BMP becomes a page in order, so a folder of scans becomes one document.',
      },
      {
        q: 'Will text in my BMP scans stay readable?',
        a: 'Yes — images are embedded at high quality, keeping scanned text crisp. For the sharpest text, keep quality at 92.',
      },
    ],
  },
  {
    id: 'heic-to-pdf', from: 'HEIC', to: 'PDF', fromExts: ['heic', 'heif'], toExt: 'pdf', category: 'image',
    widget: 'pdf',
    alsoIn: ['pdf'],
    options: [IMAGE_QUALITY_OPTION],
    loadingNote: 'Loading the image decoder… (one-time download)',
    blurb: 'Convert iPhone HEIC photos directly into a PDF — one photo per page. Skip the JPG middleman when what you need is a document.',
    faqQ: 'Can I put iPhone photos straight into a PDF?',
    faqA: 'Yes — drop your HEIC files and each becomes a full page in the PDF. No need to convert to JPG first; the HEIC decoding happens right in your browser.',
    aboutFrom: 'HEIC is how iPhones save photos — half the size of JPG, but unreadable by most Windows apps, forms and printers.',
    aboutTo: 'PDF is the format forms and offices actually accept. This puts your iPhone shots straight into a proper document.',
    useCases: [
      'Turning iPhone photos of documents into a single PDF for email',
      'Submitting HEIC photos to applications that demand PDF',
      'Combining iPhone shots into a printable PDF album',
    ],
    tip: 'Drop several HEICs at once — each becomes a page in order. Your originals are never modified.',
    extraFaqs: [
      {
        q: 'Do I need to convert HEIC to JPG first?',
        a: 'No — this tool decodes HEIC directly in your browser and builds the PDF in one step. One less conversion, one less quality loss.',
      },
      {
        q: 'Will my iPhone photos keep their quality?',
        a: 'Yes — photos are decoded at full resolution and embedded at high quality in the PDF.',
      },
      {
        q: 'Does it work with HEIF files too?',
        a: 'Yes — both .heic and .heif files are accepted and handled identically.',
      },
    ],
  },
  {
    id: 'txt-to-pdf', from: 'TXT', to: 'PDF', fromExts: ['txt'], toExt: 'pdf', category: 'text',
    widget: 'pdf',
    alsoIn: ['pdf'],
    blurb: 'Turn a plain text file into a clean, paginated PDF document. Perfect for notes, logs and drafts that need to look like a real document.',
    faqQ: 'What does the PDF look like?',
    faqA: 'Clean A4 pages with comfortable margins and readable type — your text flows across pages automatically. Simple, professional, printable.',
    aboutFrom: 'Plain text is where writing starts — notes, logs, drafts. But a .txt file looks unfinished when you need to share or print it.',
    aboutTo: 'PDF gives your text the document treatment: paginated A4 pages, proper margins, ready to email, print or archive.',
    useCases: [
      'Turning meeting notes into a shareable PDF',
      'Converting log files or reports for printing',
      'Making a plain-text draft look presentable for submission',
    ],
    tip: 'Long files paginate automatically — a 50-page text file becomes a 50-page PDF with no extra work.',
    extraFaqs: [
      {
        q: 'Does it preserve my line breaks?',
        a: 'Yes — your paragraphs and line breaks are kept, and long lines wrap neatly within the page margins.',
      },
      {
        q: 'What page size is used?',
        a: 'A4 with comfortable margins — the standard for documents worldwide, and it prints perfectly.',
      },
      {
        q: 'Can I convert a huge text file?',
        a: 'Yes — pagination is automatic, so even very long files convert into a proper multi-page PDF.',
      },
    ],
  },
  {
    id: 'md-to-pdf', from: 'Markdown', to: 'PDF', fromExts: ['md', 'markdown'], toExt: 'pdf', category: 'text',
    widget: 'pdf',
    alsoIn: ['pdf'],
    blurb: 'Convert Markdown into a styled PDF — headings, lists, bold, italic and code blocks all render properly. Your README, notes or docs as a real document.',
    faqQ: 'Does the PDF keep my Markdown formatting?',
    faqA: 'Yes — headings render large and bold, lists get bullets, **bold** and *italic* are styled, and code blocks appear in monospace on a shaded background.',
    aboutFrom: 'Markdown is the writer-friendly format: # headings, **bold**, lists — readable as plain text, but not a finished document.',
    aboutTo: 'PDF renders your Markdown as a styled, paginated document — the version you can email, print or hand to anyone.',
    useCases: [
      'Turning a README or documentation file into a PDF handout',
      'Converting Markdown notes into a printable document',
      'Sharing a styled spec with people who do not use Markdown tools',
    ],
    tip: 'Use proper # headings in your Markdown — they become the styled section titles that make the PDF look professional.',
    extraFaqs: [
      {
        q: 'Are code blocks supported?',
        a: 'Yes — fenced code blocks render in monospace on a light shaded background, just like documentation sites.',
      },
      {
        q: 'What about tables?',
        a: 'Simple text tables convert as plain text lines. For real formatted tables, convert your data from CSV to PDF instead.',
      },
      {
        q: 'Markdown to PDF or Markdown to HTML?',
        a: 'PDF for printing, emailing and archiving; HTML for publishing on the web. Pick the one your audience needs.',
      },
    ],
  },
  {
    id: 'csv-to-pdf', from: 'CSV', to: 'PDF', fromExts: ['csv'], toExt: 'pdf', category: 'data',
    widget: 'pdf',
    alsoIn: ['pdf'],
    blurb: 'Turn a CSV spreadsheet into a printable PDF table — header row highlighted, grid lines, columns auto-sized. Your data as a proper document.',
    faqQ: 'How does the table look?',
    faqA: 'A clean A4 table: bold header row on a shaded background, thin grid lines, and columns automatically sized to their content. Multi-page for long spreadsheets.',
    aboutFrom: 'CSV is the universal spreadsheet exchange format — but raw CSV is not something you print or email to a client.',
    aboutTo: 'PDF turns your spreadsheet into a formatted, printable table document that looks deliberate and professional.',
    useCases: [
      'Printing a CSV export as a readable report',
      'Emailing spreadsheet data to someone without Excel',
      'Archiving data exports as fixed-layout documents',
    ],
    tip: 'The first row becomes the header — make sure your CSV has a clean header row before converting.',
    extraFaqs: [
      {
        q: 'What if my CSV has many columns?',
        a: 'Columns shrink automatically to fit the page, down to a readable minimum. Very wide sheets stay legible; extremely wide ones may need fewer columns.',
      },
      {
        q: 'Are commas inside cells handled?',
        a: 'Yes — quoted fields with commas or quotes inside parse correctly, so your data lands in the right columns.',
      },
      {
        q: 'How many rows can it handle?',
        a: 'Up to 500 rows per conversion, flowing across as many pages as needed. Larger exports: split the CSV first.',
      },
    ],
  },
  {
    id: 'merge-pdf', from: 'PDF', to: 'PDF', fromExts: ['pdf'], toExt: 'pdf', category: 'pdf',
    title: 'Merge PDF',
    widget: 'pdf',
    loadingNote: PDF_ENGINE_NOTE,
    blurb: 'Combine multiple PDF files into one document — arrange pages in any order with up/down controls. The fastest way to join contracts, chapters or scanned batches.',
    faqQ: 'How do I merge two PDFs into one?',
    faqA: 'Drop both PDFs above, arrange them in the order you want with the up/down arrows, and download one combined PDF. The original files are never modified or uploaded.',
    aboutFrom: 'PDFs arrive in pieces — separate chapters, scanned batches, a contract plus its annex. Reading or sending them one by one is a hassle.',
    aboutTo: 'One merged PDF reads front-to-back like a proper document and attaches to a single email instead of five.',
    useCases: [
      'Joining a contract and its signed annex into one file',
      'Combining separately scanned chapters into a single ebook',
      'Merging monthly statements into one yearly PDF',
    ],
    tip: 'Use the up/down arrows to set the final order before merging — the first file in the list becomes the first pages of the result.',
    flagship: true,
    extraFaqs: [
      {
        q: 'How many PDFs can I merge at once?',
        a: 'As many as your browser memory allows — a dozen typical documents merge in seconds. Truly huge files (hundreds of MB) may strain a phone browser.',
      },
      {
        q: 'Does merging change quality?',
        a: 'No — pages are copied exactly as they are, with no re-rendering. Text stays selectable and vector graphics stay sharp.',
      },
      {
        q: 'Can I remove a file before merging?',
        a: 'Yes — each file in the list has a remove button, plus up/down arrows to reorder.',
      },
      {
        q: 'Will bookmarks or form fields survive merging?',
        a: 'Page content merges perfectly. Interactive form fields and bookmarks from the originals are not carried over in the browser version.',
      },
      {
        q: 'Is there a file size limit?',
        a: 'No hard limit, but very large PDFs (500+ MB combined) can exhaust phone browser memory — merge those on a desktop.',
      },
    ],
  },
  {
    id: 'split-pdf', from: 'PDF', to: 'PDF', fromExts: ['pdf'], toExt: 'pdf', category: 'pdf',
    title: 'Split PDF',
    widget: 'pdf',
    loadingNote: PDF_ENGINE_NOTE,
    blurb: 'Extract pages from a PDF — enter a range like "1-3, 5" and download just those pages as a new PDF. Pull one chapter out of a manual or one invoice out of a batch.',
    faqQ: 'How do I extract specific pages from a PDF?',
    faqA: 'Drop your PDF, type the pages you want — single pages like "5", ranges like "1-3", or combined "1-3, 5, 8-10" — and download a new PDF with exactly those pages.',
    aboutFrom: 'Big PDFs bundle everything together — but you often need just a chapter, a receipt, or three pages for a form.',
    aboutTo: 'A split PDF contains only the pages you asked for: smaller, focused, and ready to send.',
    useCases: [
      'Pulling one invoice out of a monthly batch PDF',
      'Extracting a single chapter from an ebook',
      'Sending only the relevant pages of a long report',
    ],
    tip: 'Page numbers start at 1 (the first page). Ranges like 1-3 and lists like 1-3, 5, 8-10 both work.',
    extraFaqs: [
      {
        q: 'What page-range formats work?',
        a: 'Single pages ("5"), ranges ("1-3") and combinations ("1-3, 5, 8-10"). Pages are extracted in ascending order.',
      },
      {
        q: 'Does splitting reduce quality?',
        a: 'No — pages are copied exactly, so text and images keep their original quality.',
      },
    ],
  },
  {
    id: 'compress-pdf', from: 'PDF', to: 'PDF', fromExts: ['pdf'], toExt: 'pdf', category: 'pdf',
    title: 'Compress PDF',
    widget: 'pdf',
    loadingNote: PDF_ENGINE_NOTE,
    blurb: 'Shrink an oversized PDF so it fits email and upload limits. Re-compresses page images at High, Balanced or Small — best for scanned and image-heavy PDFs.',
    faqQ: 'How much smaller will my PDF get?',
    faqA: 'It depends on the PDF: scanned and image-heavy PDFs often shrink 50\u201380%, while text-only PDFs (already small) shrink less. Try "Balanced" first — it is the sweet spot.',
    aboutFrom: 'PDFs balloon when they are full of scanned images — a 40-page scan can be 100 MB, far over email and form limits.',
    aboutTo: 'A compressed PDF keeps every page readable at a fraction of the bytes — the same document, emailable again.',
    useCases: [
      'Shrinking a scanned application to fit a 10 MB upload limit',
      'Making a photo-heavy PDF emailable',
      'Reducing a large ebook for phone storage',
    ],
    tip: 'This works best on scanned/image PDFs. If your PDF is mostly text and already small, there is little left to squeeze — that is normal.',
    extraFaqs: [
      {
        q: 'Will my text stay sharp?',
        a: 'At High and Balanced settings, yes for normal reading. "Smallest file" visibly softens fine print — use it only when size matters more than crispness.',
      },
      {
        q: 'Honest note: how does this compression work?',
        a: 'It re-renders each page as an optimized image — that is why it excels on scanned PDFs and does little for text-only ones. Nothing is uploaded; it all happens on your device.',
      },
    ],
  },
  {
    id: 'pdf-to-text', from: 'PDF', to: 'Text', fromExts: ['pdf'], toExt: 'txt', category: 'pdf',
    widget: 'pdf',
    loadingNote: PDF_ENGINE_NOTE,
    blurb: 'Extract all the text from a PDF into a clean .txt file. Copy quotes from ebooks, pull data from reports, or archive document content as plain text.',
    faqQ: 'How do I copy all text out of a PDF?',
    faqA: 'Drop the PDF and download a .txt file with the document\u2019s text, page by page, paragraphs preserved. No selecting, no copy-paste marathons.',
    aboutFrom: 'PDF text is trapped inside the document — copying it manually page by page is tedious and error-prone.',
    aboutTo: 'Plain text is the universal editable format: searchable, quotable, and readable by every app ever made.',
    useCases: [
      'Pulling quotes from an ebook for notes',
      'Extracting report text for analysis',
      'Archiving document content in a future-proof format',
    ],
    tip: 'Tables and multi-column layouts extract as flowing text — great for reading, but don\u2019t expect spreadsheet structure.',
    extraFaqs: [
      {
        q: 'What about scanned PDFs?',
        a: 'Scanned PDFs are pictures of text, not text — extraction finds nothing. Those need OCR, which the browser version doesn\u2019t do yet.',
      },
      {
        q: 'Is the reading order correct?',
        a: 'For normal single-column documents, yes. Complex multi-column magazine layouts may read out of order.',
      },
    ],
  },
  {
    id: 'pdf-to-word', from: 'PDF', to: 'Word', fromExts: ['pdf'], toExt: 'docx', category: 'pdf',
    widget: 'pdf',
    loadingNote: PDF_ENGINE_NOTE,
    blurb: 'Extract your PDF\u2019s text into an editable Word (.docx) document — free, in your browser. Honest note: this extracts the text; complex layouts, tables and images are not preserved.',
    faqQ: 'Is this a full PDF to Word conversion with layout?',
    faqA: 'Honest answer: no. This tool extracts the PDF\u2019s text into a clean, editable Word document — headings detected, paragraphs preserved. Complex layouts, tables, images and exact formatting are not preserved. For pixel-perfect layout conversion you would need desktop software; for getting editable text out, this does the job in seconds.',
    aboutFrom: 'PDFs lock text into fixed pages — great for reading, terrible when you need to edit, quote or reuse the words.',
    aboutTo: 'A Word document frees the text: editable, reflowable, ready for your own formatting in Word, Google Docs or LibreOffice.',
    useCases: [
      'Getting editable text out of a PDF report for rewriting',
      'Extracting contract text to quote in an email',
      'Turning an ebook chapter into an editable draft',
    ],
    tip: 'Think of it as "text extraction", not "layout cloning" — the words come out clean and editable; the original design doesn\u2019t.',
    flagship: true,
    extraFaqs: [
      {
        q: 'Why doesn\u2019t it keep the exact layout?',
        a: 'True layout-preserving PDF-to-Word needs heavy desktop engines (and usually a server). Browsers can\u2019t run those — so we do the honest version: clean, editable text. No fake promises.',
      },
      {
        q: 'Will tables convert properly?',
        a: 'Table text extracts in reading order, but the table grid itself isn\u2019t rebuilt. For data tables, PDF to Text plus manual cleanup works best.',
      },
      {
        q: 'What about scanned PDFs?',
        a: 'Scanned PDFs contain images of text, not text — nothing extracts. They need OCR first, which the browser version doesn\u2019t do yet.',
      },
      {
        q: 'Can I open the .docx in Google Docs?',
        a: 'Yes — the file is a standard Word document and opens in Word, Google Docs, LibreOffice and WPS alike.',
      },
      {
        q: 'Is my document uploaded anywhere?',
        a: 'Never. Extraction runs entirely in your browser — that is exactly why we offer the honest text version instead of a server round-trip.',
      },
    ],
  },
  {
    id: 'edit-pdf', from: 'PDF', to: 'Edited PDF', fromExts: ['pdf'], toExt: 'pdf', category: 'pdf',
    title: 'Edit PDF Online',
    widget: 'edit',
    loadingNote: PDF_ENGINE_NOTE,
    blurb: 'Click any text in your PDF and type to edit it — right on the page, in your browser. Fix typos in contracts, update a resume, correct figures in a report, then download the updated PDF. No uploads, no sign-up, no watermark.',
    faqQ: 'How can I edit text in a PDF for free?',
    faqA: 'Drop your PDF above. Every text block becomes clickable — click it, type your changes, and download the updated PDF with your edits baked in. It all happens in your browser: your file is never uploaded anywhere.',
    aboutFrom: 'PDFs are designed to look identical everywhere — which is exactly why their text is normally so hard to change without expensive desktop software.',
    aboutTo: 'An edited PDF keeps the original layout and look, but with your corrections baked into the file — ready to send, print or archive.',
    useCases: [
      'Fixing typos in a contract before signing it',
      'Updating your resume or CV in seconds',
      'Correcting names, dates or figures in a report',
    ],
    tip: 'For long rewrites, switch to Text view — edit the whole page as plain text, then apply it back in one go.',
    flagship: true,
    extraFaqs: [
      {
        q: 'Is my PDF uploaded to a server when I edit it?',
        a: 'Never. The editor runs 100% in your browser — the file is read, edited and rebuilt on your device. That is the whole point: private editing with nothing leaving your computer.',
      },
      {
        q: 'Will the layout stay the same after editing?',
        a: 'For text-based PDFs, yes — each edited block is covered and your new text is drawn back at the exact same position in a matching style. One honest detail: the cover is a white box, so on pages with background colors or images behind the text you may notice it. Original fonts are approximated with standard PDF fonts.',
      },
      {
        q: 'What about scanned PDFs?',
        a: 'Scanned PDFs are pictures of text, not text — there is nothing clickable to edit. They need OCR first, which the browser version does not do yet.',
      },
      {
        q: 'Can I edit images in the PDF?',
        a: 'Not yet — the editor works on text. Images pass through untouched into your downloaded file.',
      },
      {
        q: 'What is the “clean PDF” download?',
        a: 'A rebuilt version of your document with flowing text and simple typography — handy when you made big edits and want a tidy, reflowed document instead of the original layout.',
      },
    ],
  },

  // ---------------- MERGE tools ----------------
  {
    id: 'merge-images-jpg', from: 'Images', to: 'JPG', fromExts: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'], toExt: 'jpg', category: 'image',
    title: 'Merge Images to JPG',
    widget: 'merge',
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Combine multiple images into one JPG — pick Grid 2\u00d72, Grid 3\u00d73, a horizontal strip or a vertical strip. Perfect for collages, before/after shots and comparison images.',
    faqQ: 'How do I join two photos side by side?',
    faqA: 'Drop both images, choose the Horizontal strip layout, and download one wide JPG with your photos next to each other. Lower the quality slider if the file must stay small.',
    aboutFrom: 'Photos arrive one by one — but collages, comparisons and contact sheets need them in a single frame.',
    aboutTo: 'One merged JPG tells the whole story in a single shareable image that opens everywhere.',
    useCases: [
      'Making a before/after comparison image',
      'Joining screenshots into one long vertical strip for a tutorial',
      'Creating a 2\u00d72 photo collage for social media',
    ],
    tip: 'For before/after shots use Horizontal strip; for step-by-step tutorials use Vertical strip — readers scroll naturally.',
    extraFaqs: [
      {
        q: 'How many images can I merge?',
        a: 'Up to 16 at once. Grids arrange them in 2 or 3 columns; strips line them all up in one row or column.',
      },
      {
        q: 'Will different-sized images look odd?',
        a: 'No — each image is scaled to fit its cell while keeping its aspect ratio, centered on a clean white background.',
      },
    ],
  },
  {
    id: 'merge-images-png', from: 'Images', to: 'PNG', fromExts: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'], toExt: 'png', category: 'image',
    title: 'Merge Images to PNG',
    widget: 'merge',
    blurb: 'Merge multiple images into one lossless PNG collage — Grid 2\u00d72, Grid 3\u00d73, horizontal or vertical layouts. Best when sharpness matters more than file size.',
    faqQ: 'Merge to PNG or JPG — which should I pick?',
    faqA: 'PNG for screenshots, text and graphics (razor-sharp, larger file). JPG for photos (much smaller, tiny quality trade-off).',
    aboutFrom: 'Collages of screenshots and UI graphics need pixel-perfect sharpness that JPG\u2019s compression would soften.',
    aboutTo: 'A merged PNG keeps every edge crisp — the right choice for tutorials, documentation and design comparisons.',
    useCases: [
      'Combining UI screenshots into one tutorial image',
      'Making a sharp 2\u00d72 comparison of design mockups',
      'Joining diagrams into a single figure',
    ],
    tip: 'PNG collages are bigger than JPG — if you are posting to chat or social, Merge Images to JPG gives far smaller files.',
    extraFaqs: [
      {
        q: 'Why is my merged PNG so big?',
        a: 'PNG is lossless — a 2\u00d72 collage of screenshots can easily be several MB. That is normal; use JPG if size matters.',
      },
      {
        q: 'Do transparent PNGs keep transparency?',
        a: 'Cells render on a white background, so transparency becomes white — consistent and print-friendly.',
      },
    ],
  },
  {
    id: 'merge-images-pdf', from: 'Images', to: 'PDF', fromExts: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'], toExt: 'pdf', category: 'pdf',
    title: 'Merge Images to PDF',
    widget: 'merge',
    options: [IMAGE_QUALITY_OPTION],
    blurb: 'Turn a stack of images into one PDF — choose 1, 2 or 4 images per page. The quick way from a phone\u2019s camera roll to a proper multi-page document.',
    faqQ: 'How do I make a PDF with several photos per page?',
    faqA: 'Drop your images, pick 1, 2 or 4 per page, and download a single PDF. Great for contact sheets, photo albums and document batches.',
    aboutFrom: 'Phone galleries hold dozens of loose photos — but applications and archives want one PDF document.',
    aboutTo: 'One PDF with your images laid out 1, 2 or 4 per page: organized, printable, universally accepted.',
    useCases: [
      'Turning photographed document pages into one PDF',
      'Making a photo contact sheet as a PDF',
      'Combining receipts into a single expense PDF',
    ],
    tip: 'Use 1 per page for full-size document scans, 4 per page for compact photo overviews.',
    extraFaqs: [
      {
        q: 'What page size does it use?',
        a: 'Standard A4-ish pages with margins — images are scaled to fit their slots without distortion.',
      },
      {
        q: 'Can I reorder the images?',
        a: 'Yes — use the up/down arrows on each image to set the final page order before merging.',
      },
    ],
  },
  {
    id: 'merge-videos', from: 'Videos', to: 'MP4', fromExts: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'], toExt: 'mp4', category: 'video',
    title: 'Merge Videos',
    widget: 'merge',
    loadingNote: 'Preparing converter… (~30 MB one-time download)',
    options: [VIDEO_CRF_OPTION],
    blurb: 'Join multiple video clips into one MP4 — interviews, takes, or parts of a vlog. Same-codec clips merge instantly with no quality loss; mixed clips are re-encoded automatically.',
    faqQ: 'How do I combine several video clips into one?',
    faqA: 'Drop your clips in order (rearrange with up/down arrows), hit merge, and download one MP4. Clips from the same camera merge with zero quality loss; different sources are smoothly re-encoded to match.',
    aboutFrom: 'Videos are shot in pieces — takes, scenes, clips from different days. Players and platforms want one file.',
    aboutTo: 'One merged MP4 plays start-to-finish with no gaps — ready to upload, share or archive.',
    useCases: [
      'Joining interview takes into one continuous video',
      'Combining vlog clips shot across a day',
      'Merging screen recordings into a single tutorial',
    ],
    tip: 'Clips from the same camera and settings merge fastest with zero quality loss. Mixed sources still work — they are re-encoded to a common format automatically.',
    extraFaqs: [
      {
        q: 'Will merging reduce quality?',
        a: 'Not when clips share the same codec — they join with stream copy, bit-for-bit. Mixed clips get re-encoded once at your chosen quality.',
      },
      {
        q: 'What if my clips have different resolutions?',
        a: 'They still merge — the re-encode fallback normalizes them. For cleanest results, shoot all clips at the same resolution.',
      },
    ],
  },
  {
    id: 'merge-audios', from: 'Audio', to: 'MP3', fromExts: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'], toExt: 'mp3', category: 'audio',
    title: 'Merge Audio',
    widget: 'merge',
    loadingNote: 'Preparing converter… (~30 MB one-time download)',
    options: [AUDIO_BITRATE_OPTION],
    blurb: 'Join audio clips into one MP3 — podcast segments, voice memos, or music parts. Arrange the order, pick a bitrate, and download a single seamless file.',
    faqQ: 'How do I join voice memos into one file?',
    faqA: 'Drop your recordings in order, rearrange with the arrows if needed, choose a bitrate, and download one MP3. Everything runs in your browser.',
    aboutFrom: 'Voice memos, interview segments and music ideas pile up as separate files — hard to share or play in order.',
    aboutTo: 'One merged MP3 plays seamlessly and shares like any single audio file.',
    useCases: [
      'Joining podcast segments into one episode',
      'Combining voice memos into a single recording',
      'Merging music stems or practice takes',
    ],
    tip: 'MP3 segments join with no re-encoding (no quality loss). Mixed formats are converted to MP3 at your chosen bitrate.',
    extraFaqs: [
      {
        q: 'Does merging MP3s lose quality?',
        a: 'No — MP3 segments join via stream copy with zero re-encoding. Only non-MP3 inputs get encoded once.',
      },
      {
        q: 'Which bitrate should I choose?',
        a: '192 kbps is the sweet spot for voice and most music. 320 kbps for critical listening, 128 kbps for the smallest files.',
      },
    ],
  },
];

function buildEntry(spec: PairSpec): ConverterEntry {
  return {
    id: spec.id,
    from: spec.from,
    to: spec.to,
    fromExts: spec.fromExts,
    toExt: spec.toExt,
    category: spec.category,
    title: spec.title ?? `${spec.from} to ${spec.to} Converter`,
    description: spec.blurb,
    faqs: [
      { q: spec.faqQ, a: spec.faqA },
      ...(spec.extraFaqs ?? []),
      FREE_FAQ(spec.from, spec.to),
      PRIVACY_FAQ,
    ],
    convert: spec.convert,
    options: spec.options,
    widget: spec.widget,
    alsoIn: spec.alsoIn,
    loadingNote: spec.loadingNote,
    useCases: spec.useCases,
    flagship: spec.flagship,
    aboutFrom: spec.aboutFrom,
    aboutTo: spec.aboutTo,
    tip: spec.tip,
  };
}

export const CONVERTERS: ConverterEntry[] = PAIRS.map(buildEntry);

export function getConverter(id: string): ConverterEntry | undefined {
  return CONVERTERS.find((c) => c.id === id);
}

export function convertersByCategory(category: Category): ConverterEntry[] {
  return CONVERTERS.filter((c) => c.category === category || c.alsoIn?.includes(category));
}

/** Find converters that accept a file with this extension (for homepage auto-detect). */
export function findConvertersForExt(ext: string): ConverterEntry[] {
  const e = ext.toLowerCase().replace(/^\./, '');
  return CONVERTERS.filter((c) => c.fromExts.includes(e));
}

/** Related converters for a /convert/[pair] page: same source format first, then same category. */
export function relatedConverters(entry: ConverterEntry, count = 6): ConverterEntry[] {
  const others = CONVERTERS.filter((c) => c.id !== entry.id);
  const sameFrom = others.filter((c) => c.from === entry.from);
  const sameCat = others.filter((c) => c.from !== entry.from && c.category === entry.category);
  const rest = others.filter((c) => c.from !== entry.from && c.category !== entry.category);
  return [...sameFrom, ...sameCat, ...rest].slice(0, count);
}

export function categoryMeta(id: Category): CategoryMeta {
  return CATEGORIES.find((c) => c.id === id)!;
}
