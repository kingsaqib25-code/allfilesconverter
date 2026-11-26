/**
 * Font registry for the TXT-to-PDF editor.
 *
 * Two kinds of fonts:
 * - 'standard': one of pdf-lib's 14 built-in fonts (Helvetica / Times /
 *   Courier). No file needed; the preview uses a matching system stack.
 * - 'embedded': a TTF family in public/fonts/, fetched at runtime and
 *   embedded into the PDF with pdf-lib (so preview == PDF for that family).
 *   The preview loads the same file through @font-face. Missing styles
 *   fall back to the family's regular file.
 *
 * Why "twins": Arial, Calibri, Times New Roman, Georgia and Courier New are
 * Microsoft fonts and cannot legally be bundled. Their metric-identical
 * open twins (Liberation Sans/Serif/Mono, Carlito, Gelasio, DejaVu Sans)
 * look the same and keep every line break identical.
 */
export type FontGroup = 'famous' | 'world';

export type FontStyle = 'regular' | 'bold' | 'italic' | 'boldItalic';

export interface FontDef {
  id: string;
  label: string;
  group: FontGroup;
  /** CSS family used in the editor and the live preview. */
  css: string;
  kind: 'standard' | 'embedded';
  /** @font-face family name (embedded only) — must match the first name in `css`. */
  web?: string;
  /** TTF file names under public/fonts/ (embedded only). */
  files?: Partial<Record<FontStyle, string>>;
  /** PDF fallback family when this font cannot shape a run (Urdu -> Arabic Naskh). */
  pdfFallback?: string;
  /** Note shown under the ribbon while this font is active. */
  note?: string;
}

export const FONT_REGISTRY: FontDef[] = [
  { id: 'helvetica', label: 'Helvetica (clean)', group: 'famous', css: 'Arial, Helvetica, sans-serif', kind: 'standard' },
  { id: 'times', label: 'Times (classic)', group: 'famous', css: '"Times New Roman", Times, serif', kind: 'standard' },
  { id: 'courier', label: 'Courier (typewriter)', group: 'famous', css: '"Courier New", Courier, monospace', kind: 'standard' },
  {
    id: 'arial', label: 'Arial (Liberation Sans)', group: 'famous',
    css: "'Liberation Sans', Arial, sans-serif", kind: 'embedded', web: 'Liberation Sans',
    files: { regular: 'LiberationSans-Regular.ttf', bold: 'LiberationSans-Bold.ttf', italic: 'LiberationSans-Italic.ttf', boldItalic: 'LiberationSans-BoldItalic.ttf' },
  },
  {
    id: 'calibri', label: 'Calibri (Carlito)', group: 'famous',
    css: "'Carlito', Calibri, sans-serif", kind: 'embedded', web: 'Carlito',
    files: { regular: 'Carlito-Regular.ttf', bold: 'Carlito-Bold.ttf', italic: 'Carlito-Italic.ttf', boldItalic: 'Carlito-BoldItalic.ttf' },
  },
  {
    id: 'georgia', label: 'Georgia (Gelasio)', group: 'famous',
    css: "'Gelasio', Georgia, serif", kind: 'embedded', web: 'Gelasio',
    files: { regular: 'Gelasio-Regular.ttf', bold: 'Gelasio-Bold.ttf', italic: 'Gelasio-Italic.ttf', boldItalic: 'Gelasio-BoldItalic.ttf' },
    note: "Georgia's bold looks the same as regular in the PDF — the free Georgia twin has no separate bold file.",
  },
  {
    id: 'verdana', label: 'Verdana (DejaVu Sans)', group: 'famous',
    css: "'DejaVu Sans', Verdana, sans-serif", kind: 'embedded', web: 'DejaVu Sans',
    files: { regular: 'DejaVuSans-Regular.ttf', bold: 'DejaVuSans-Bold.ttf', italic: 'DejaVuSans-Oblique.ttf', boldItalic: 'DejaVuSans-BoldOblique.ttf' },
  },
  {
    id: 'roboto', label: 'Roboto', group: 'famous',
    css: "'Roboto', Arial, sans-serif", kind: 'embedded', web: 'Roboto',
    files: { regular: 'Roboto-Regular.ttf', bold: 'Roboto-Bold.ttf', italic: 'Roboto-Italic.ttf', boldItalic: 'Roboto-BoldItalic.ttf' },
  },
  {
    id: 'open-sans', label: 'Open Sans', group: 'famous',
    css: "'Open Sans', Arial, sans-serif", kind: 'embedded', web: 'Open Sans',
    files: { regular: 'OpenSans-Regular.ttf', bold: 'OpenSans-Bold.ttf', italic: 'OpenSans-Italic.ttf', boldItalic: 'OpenSans-BoldItalic.ttf' },
  },
  {
    id: 'lato', label: 'Lato', group: 'famous',
    css: "'Lato', Arial, sans-serif", kind: 'embedded', web: 'Lato',
    files: { regular: 'Lato-Regular.ttf', bold: 'Lato-Bold.ttf', italic: 'Lato-Italic.ttf', boldItalic: 'Lato-BoldItalic.ttf' },
  },
  {
    id: 'inter', label: 'Inter', group: 'famous',
    css: "'Inter', Arial, sans-serif", kind: 'embedded', web: 'Inter',
    files: { regular: 'Inter-Regular.ttf', bold: 'Inter-Bold.ttf', italic: 'Inter-Italic.ttf', boldItalic: 'Inter-BoldItalic.ttf' },
  },
  {
    id: 'montserrat', label: 'Montserrat', group: 'famous',
    css: "'Montserrat', Arial, sans-serif", kind: 'embedded', web: 'Montserrat',
    files: { regular: 'Montserrat-Regular.ttf', bold: 'Montserrat-Bold.ttf', italic: 'Montserrat-Italic.ttf', boldItalic: 'Montserrat-BoldItalic.ttf' },
  },
  {
    id: 'poppins', label: 'Poppins', group: 'famous',
    css: "'Poppins', Arial, sans-serif", kind: 'embedded', web: 'Poppins',
    files: { regular: 'Poppins-Regular.ttf', bold: 'Poppins-Bold.ttf', italic: 'Poppins-Italic.ttf', boldItalic: 'Poppins-BoldItalic.ttf' },
  },
  {
    id: 'playfair', label: 'Playfair Display', group: 'famous',
    css: "'Playfair Display', Georgia, serif", kind: 'embedded', web: 'Playfair Display',
    files: { regular: 'PlayfairDisplay-Regular.ttf', bold: 'PlayfairDisplay-Bold.ttf', italic: 'PlayfairDisplay-Italic.ttf', boldItalic: 'PlayfairDisplay-BoldItalic.ttf' },
  },
  {
    id: 'merriweather', label: 'Merriweather', group: 'famous',
    css: "'Merriweather', Georgia, serif", kind: 'embedded', web: 'Merriweather',
    files: { regular: 'Merriweather-Regular.ttf', bold: 'Merriweather-Bold.ttf', italic: 'Merriweather-Italic.ttf', boldItalic: 'Merriweather-BoldItalic.ttf' },
  },
  {
    id: 'garamond', label: 'EB Garamond', group: 'famous',
    css: "'EB Garamond', Georgia, serif", kind: 'embedded', web: 'EB Garamond',
    files: { regular: 'EBGaramond-Regular.ttf', bold: 'EBGaramond-Bold.ttf', italic: 'EBGaramond-Italic.ttf', boldItalic: 'EBGaramond-BoldItalic.ttf' },
  },
  {
    id: 'oswald', label: 'Oswald', group: 'famous',
    css: "'Oswald', Arial, sans-serif", kind: 'embedded', web: 'Oswald',
    files: { regular: 'Oswald-Regular.ttf', bold: 'Oswald-Bold.ttf' },
  },
  {
    id: 'source-serif', label: 'Source Serif 4', group: 'famous',
    css: "'Source Serif 4', Georgia, serif", kind: 'embedded', web: 'Source Serif 4',
    files: { regular: 'SourceSerif4-Regular.ttf', bold: 'SourceSerif4-Bold.ttf', italic: 'SourceSerif4-Italic.ttf', boldItalic: 'SourceSerif4-BoldItalic.ttf' },
  },
  {
    id: 'nunito', label: 'Nunito', group: 'famous',
    css: "'Nunito', Arial, sans-serif", kind: 'embedded', web: 'Nunito',
    files: { regular: 'Nunito-Regular.ttf', bold: 'Nunito-Bold.ttf', italic: 'Nunito-Italic.ttf', boldItalic: 'Nunito-BoldItalic.ttf' },
  },
  {
    id: 'raleway', label: 'Raleway', group: 'famous',
    css: "'Raleway', Arial, sans-serif", kind: 'embedded', web: 'Raleway',
    files: { regular: 'Raleway-Regular.ttf', bold: 'Raleway-Bold.ttf', italic: 'Raleway-Italic.ttf', boldItalic: 'Raleway-BoldItalic.ttf' },
  },
  {
    id: 'noto-sans', label: 'Noto Sans (universal)', group: 'world',
    css: "'Noto Sans', Arial, sans-serif", kind: 'embedded', web: 'Noto Sans',
    files: { regular: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf' },
  },
  {
    id: 'urdu', label: 'Urdu — Noto Nastaliq', group: 'world',
    css: "'Noto Nastaliq Urdu', serif", kind: 'embedded', web: 'Noto Nastaliq Urdu',
    files: { regular: 'NotoNastaliqUrdu-Regular.ttf' },
    pdfFallback: 'arabic',
    note: 'Urdu looks right in the preview. The PDF draws it in Naskh style instead of Nastaliq (the PDF engine cannot shape Nastaliq yet).',
  },
  {
    id: 'arabic', label: 'Arabic — Noto Naskh', group: 'world',
    css: "'Noto Naskh Arabic', serif", kind: 'embedded', web: 'Noto Naskh Arabic',
    files: { regular: 'NotoNaskhArabic-Regular.ttf', bold: 'NotoNaskhArabic-Bold.ttf' },
  },
  {
    id: 'hindi', label: 'Hindi — Noto Sans Devanagari', group: 'world',
    css: "'Noto Sans Devanagari', sans-serif", kind: 'embedded', web: 'Noto Sans Devanagari',
    files: { regular: 'NotoSansDevanagari-Regular.ttf', bold: 'NotoSansDevanagari-Bold.ttf' },
    note: 'Hindi looks right in the preview. In the PDF, vowel marks may sit apart from their letters (the PDF engine’s Hindi shaping is limited).',
  },
  {
    id: 'chinese', label: 'Chinese — Noto Sans SC', group: 'world',
    css: "'Noto Sans SC', sans-serif", kind: 'embedded', web: 'Noto Sans SC',
    files: { regular: 'NotoSansSC-Regular.ttf', bold: 'NotoSansSC-Bold.ttf' },
  },
  {
    id: 'japanese', label: 'Japanese — Noto Sans JP', group: 'world',
    css: "'Noto Sans JP', sans-serif", kind: 'embedded', web: 'Noto Sans JP',
    files: { regular: 'NotoSansJP-Regular.ttf', bold: 'NotoSansJP-Bold.ttf' },
  },
  {
    id: 'korean', label: 'Korean — Noto Sans KR', group: 'world',
    css: "'Noto Sans KR', sans-serif", kind: 'embedded', web: 'Noto Sans KR',
    files: { regular: 'NotoSansKR-Regular.ttf', bold: 'NotoSansKR-Bold.ttf' },
  },
  {
    id: 'thai', label: 'Thai — Noto Sans Thai', group: 'world',
    css: "'Noto Sans Thai', sans-serif", kind: 'embedded', web: 'Noto Sans Thai',
    files: { regular: 'NotoSansThai-Regular.ttf', bold: 'NotoSansThai-Bold.ttf' },
    note: 'Thai looks right in the preview. Marks above and below letters may sit slightly off in the PDF.',
  },
  {
    id: 'bengali', label: 'Bengali — Noto Sans Bengali', group: 'world',
    css: "'Noto Sans Bengali', sans-serif", kind: 'embedded', web: 'Noto Sans Bengali',
    files: { regular: 'NotoSansBengali-Regular.ttf', bold: 'NotoSansBengali-Bold.ttf' },
    note: 'Bengali looks right in the preview. In the PDF, vowel marks may sit apart from their letters (the PDF engine’s Bengali shaping is limited).',
  },
  {
    id: 'hebrew', label: 'Hebrew — Noto Sans Hebrew', group: 'world',
    css: "'Noto Sans Hebrew', sans-serif", kind: 'embedded', web: 'Noto Sans Hebrew',
    files: { regular: 'NotoSansHebrew-Regular.ttf', bold: 'NotoSansHebrew-Bold.ttf' },
    note: 'Hebrew looks right in the preview. The PDF draws it left-to-right (right-to-left is not supported yet).',
  },
];

export function getFontDef(id: string): FontDef {
  return FONT_REGISTRY.find((f) => f.id === id) ?? FONT_REGISTRY[0];
}

const loadedWebFonts = new Set<string>();

/**
 * Load a family's TTFs as webfonts so the editor and live preview render
 * the real glyphs (the PDF embeds the same files). Fail-soft: on any error
 * the preview falls back to the css stack and the PDF still embeds the TTF.
 */
export async function ensureWebFont(def: FontDef): Promise<void> {
  if (def.kind !== 'embedded' || !def.files || !def.web || typeof document === 'undefined') return;
  const styles: Array<{ key: FontStyle; weight: string; style: string }> = [
    { key: 'regular', weight: '400', style: 'normal' },
    { key: 'bold', weight: '700', style: 'normal' },
    { key: 'italic', weight: '400', style: 'italic' },
    { key: 'boldItalic', weight: '700', style: 'italic' },
  ];
  for (const s of styles) {
    const file = def.files[s.key];
    if (!file) continue;
    const id = `${def.id}:${s.key}`;
    if (loadedWebFonts.has(id)) continue;
    try {
      const face = new FontFace(def.web, `url(/fonts/${file})`, {
        weight: s.weight,
        style: s.style,
      });
      document.fonts.add(face);
      await face.load();
      loadedWebFonts.add(id);
    } catch {
      // Preview falls back to the css stack.
    }
  }
}
