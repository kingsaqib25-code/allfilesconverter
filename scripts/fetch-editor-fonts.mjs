/**
 * Downloads the TXT-to-PDF editor's font TTFs into public/fonts/ so the
 * preview and the downloaded PDF use the same real font files (OFL licensed).
 * Runs automatically before `next build` (see package.json "prebuild").
 *
 * Fail-soft: only MISSING files are downloaded, and any failure just warns —
 * the build must never break because of a font CDN hiccup. The TTFs are
 * committed to the repo, so a fresh build normally downloads nothing.
 *
 * Sources:
 * - Most families: @expo-google-fonts packages on jsDelivr (static TTFs).
 * - Carlito/Caladea: google/fonts raw (metric twins of Calibri/Cambria).
 * - Liberation Sans/Serif/Mono: Debian fonts-liberation .deb (the upstream
 *   GitHub repo is gone); extracted with `ar` + `tar`.
 * - Gelasio (Georgia twin): google/fonts only ships the variable font now;
 *   the variable file is copied to all four style names (bold renders at
 *   regular weight — see src/lib/fonts.ts).
 * - DejaVu Sans: dejavu-fonts-ttf npm package on jsDelivr.
 */
import { mkdirSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public', 'fonts');

/** [target file, expo package, expo file name] */
const EXPO = [
  ['Roboto-Regular.ttf', 'roboto', 'Roboto_400Regular.ttf'],
  ['Roboto-Bold.ttf', 'roboto', 'Roboto_700Bold.ttf'],
  ['Roboto-Italic.ttf', 'roboto', 'Roboto_400Regular_Italic.ttf'],
  ['Roboto-BoldItalic.ttf', 'roboto', 'Roboto_700Bold_Italic.ttf'],
  ['OpenSans-Regular.ttf', 'open-sans', 'OpenSans_400Regular.ttf'],
  ['OpenSans-Bold.ttf', 'open-sans', 'OpenSans_700Bold.ttf'],
  ['OpenSans-Italic.ttf', 'open-sans', 'OpenSans_400Regular_Italic.ttf'],
  ['OpenSans-BoldItalic.ttf', 'open-sans', 'OpenSans_700Bold_Italic.ttf'],
  ['Lato-Regular.ttf', 'lato', 'Lato_400Regular.ttf'],
  ['Lato-Bold.ttf', 'lato', 'Lato_700Bold.ttf'],
  ['Lato-Italic.ttf', 'lato', 'Lato_400Regular_Italic.ttf'],
  ['Lato-BoldItalic.ttf', 'lato', 'Lato_700Bold_Italic.ttf'],
  ['Inter-Regular.ttf', 'inter', 'Inter_400Regular.ttf'],
  ['Inter-Bold.ttf', 'inter', 'Inter_700Bold.ttf'],
  ['Inter-Italic.ttf', 'inter', 'Inter_400Regular_Italic.ttf'],
  ['Inter-BoldItalic.ttf', 'inter', 'Inter_700Bold_Italic.ttf'],
  ['Montserrat-Regular.ttf', 'montserrat', 'Montserrat_400Regular.ttf'],
  ['Montserrat-Bold.ttf', 'montserrat', 'Montserrat_700Bold.ttf'],
  ['Montserrat-Italic.ttf', 'montserrat', 'Montserrat_400Regular_Italic.ttf'],
  ['Montserrat-BoldItalic.ttf', 'montserrat', 'Montserrat_700Bold_Italic.ttf'],
  ['Poppins-Regular.ttf', 'poppins', 'Poppins_400Regular.ttf'],
  ['Poppins-Bold.ttf', 'poppins', 'Poppins_700Bold.ttf'],
  ['Poppins-Italic.ttf', 'poppins', 'Poppins_400Regular_Italic.ttf'],
  ['Poppins-BoldItalic.ttf', 'poppins', 'Poppins_700Bold_Italic.ttf'],
  ['PlayfairDisplay-Regular.ttf', 'playfair-display', 'PlayfairDisplay_400Regular.ttf'],
  ['PlayfairDisplay-Bold.ttf', 'playfair-display', 'PlayfairDisplay_700Bold.ttf'],
  ['PlayfairDisplay-Italic.ttf', 'playfair-display', 'PlayfairDisplay_400Regular_Italic.ttf'],
  ['PlayfairDisplay-BoldItalic.ttf', 'playfair-display', 'PlayfairDisplay_700Bold_Italic.ttf'],
  ['Merriweather-Regular.ttf', 'merriweather', 'Merriweather_400Regular.ttf'],
  ['Merriweather-Bold.ttf', 'merriweather', 'Merriweather_700Bold.ttf'],
  ['Merriweather-Italic.ttf', 'merriweather', 'Merriweather_400Regular_Italic.ttf'],
  ['Merriweather-BoldItalic.ttf', 'merriweather', 'Merriweather_700Bold_Italic.ttf'],
  ['EBGaramond-Regular.ttf', 'eb-garamond', 'EBGaramond_400Regular.ttf'],
  ['EBGaramond-Bold.ttf', 'eb-garamond', 'EBGaramond_700Bold.ttf'],
  ['EBGaramond-Italic.ttf', 'eb-garamond', 'EBGaramond_400Regular_Italic.ttf'],
  ['EBGaramond-BoldItalic.ttf', 'eb-garamond', 'EBGaramond_700Bold_Italic.ttf'],
  ['Oswald-Regular.ttf', 'oswald', 'Oswald_400Regular.ttf'],
  ['Oswald-Bold.ttf', 'oswald', 'Oswald_700Bold.ttf'],
  ['SourceSerif4-Regular.ttf', 'source-serif-4', 'SourceSerif4_400Regular.ttf'],
  ['SourceSerif4-Bold.ttf', 'source-serif-4', 'SourceSerif4_700Bold.ttf'],
  ['SourceSerif4-Italic.ttf', 'source-serif-4', 'SourceSerif4_400Regular_Italic.ttf'],
  ['SourceSerif4-BoldItalic.ttf', 'source-serif-4', 'SourceSerif4_700Bold_Italic.ttf'],
  ['Nunito-Regular.ttf', 'nunito', 'Nunito_400Regular.ttf'],
  ['Nunito-Bold.ttf', 'nunito', 'Nunito_700Bold.ttf'],
  ['Nunito-Italic.ttf', 'nunito', 'Nunito_400Regular_Italic.ttf'],
  ['Nunito-BoldItalic.ttf', 'nunito', 'Nunito_700Bold_Italic.ttf'],
  ['Raleway-Regular.ttf', 'raleway', 'Raleway_400Regular.ttf'],
  ['Raleway-Bold.ttf', 'raleway', 'Raleway_700Bold.ttf'],
  ['Raleway-Italic.ttf', 'raleway', 'Raleway_400Regular_Italic.ttf'],
  ['Raleway-BoldItalic.ttf', 'raleway', 'Raleway_700Bold_Italic.ttf'],
  ['NotoNastaliqUrdu-Regular.ttf', 'noto-nastaliq-urdu', 'NotoNastaliqUrdu_400Regular.ttf'],
  ['NotoNaskhArabic-Regular.ttf', 'noto-naskh-arabic', 'NotoNaskhArabic_400Regular.ttf'],
  ['NotoNaskhArabic-Bold.ttf', 'noto-naskh-arabic', 'NotoNaskhArabic_700Bold.ttf'],
  ['NotoSansDevanagari-Regular.ttf', 'noto-sans-devanagari', 'NotoSansDevanagari_400Regular.ttf'],
  ['NotoSansDevanagari-Bold.ttf', 'noto-sans-devanagari', 'NotoSansDevanagari_700Bold.ttf'],
  ['NotoSansSC-Regular.ttf', 'noto-sans-sc', 'NotoSansSC_400Regular.ttf'],
  ['NotoSansSC-Bold.ttf', 'noto-sans-sc', 'NotoSansSC_700Bold.ttf'],
  ['NotoSansJP-Regular.ttf', 'noto-sans-jp', 'NotoSansJP_400Regular.ttf'],
  ['NotoSansJP-Bold.ttf', 'noto-sans-jp', 'NotoSansJP_700Bold.ttf'],
  ['NotoSansKR-Regular.ttf', 'noto-sans-kr', 'NotoSansKR_400Regular.ttf'],
  ['NotoSansKR-Bold.ttf', 'noto-sans-kr', 'NotoSansKR_700Bold.ttf'],
  ['NotoSansThai-Regular.ttf', 'noto-sans-thai', 'NotoSansThai_400Regular.ttf'],
  ['NotoSansThai-Bold.ttf', 'noto-sans-thai', 'NotoSansThai_700Bold.ttf'],
  ['NotoSansBengali-Regular.ttf', 'noto-sans-bengali', 'NotoSansBengali_400Regular.ttf'],
  ['NotoSansBengali-Bold.ttf', 'noto-sans-bengali', 'NotoSansBengali_700Bold.ttf'],
  ['NotoSansHebrew-Regular.ttf', 'noto-sans-hebrew', 'NotoSansHebrew_400Regular.ttf'],
  ['NotoSansHebrew-Bold.ttf', 'noto-sans-hebrew', 'NotoSansHebrew_700Bold.ttf'],
  ['NotoSans-Regular.ttf', 'noto-sans', 'NotoSans_400Regular.ttf'],
  ['NotoSans-Bold.ttf', 'noto-sans', 'NotoSans_700Bold.ttf'],
];

/** [target file, direct URL] */
const DIRECT = [
  ['Carlito-Regular.ttf', 'https://raw.githubusercontent.com/google/fonts/main/ofl/carlito/Carlito-Regular.ttf'],
  ['Carlito-Bold.ttf', 'https://raw.githubusercontent.com/google/fonts/main/ofl/carlito/Carlito-Bold.ttf'],
  ['Carlito-Italic.ttf', 'https://raw.githubusercontent.com/google/fonts/main/ofl/carlito/Carlito-Italic.ttf'],
  ['Carlito-BoldItalic.ttf', 'https://raw.githubusercontent.com/google/fonts/main/ofl/carlito/Carlito-BoldItalic.ttf'],
  ['Caladea-Regular.ttf', 'https://raw.githubusercontent.com/google/fonts/main/ofl/caladea/Caladea-Regular.ttf'],
  ['Caladea-Bold.ttf', 'https://raw.githubusercontent.com/google/fonts/main/ofl/caladea/Caladea-Bold.ttf'],
  ['Caladea-Italic.ttf', 'https://raw.githubusercontent.com/google/fonts/main/ofl/caladea/Caladea-Italic.ttf'],
  ['Caladea-BoldItalic.ttf', 'https://raw.githubusercontent.com/google/fonts/main/ofl/caladea/Caladea-BoldItalic.ttf'],
  ['DejaVuSans-Regular.ttf', 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf'],
  ['DejaVuSans-Bold.ttf', 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf'],
  ['DejaVuSans-Oblique.ttf', 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Oblique.ttf'],
  ['DejaVuSans-BoldOblique.ttf', 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-BoldOblique.ttf'],
];

/** Gelasio variable files, copied to the four style names. */
const GELASIO = [
  ['Gelasio[wght].ttf', ['Gelasio-Regular.ttf', 'Gelasio-Bold.ttf']],
  ['Gelasio-Italic[wght].ttf', ['Gelasio-Italic.ttf', 'Gelasio-BoldItalic.ttf']],
];

/** Liberation files inside the Debian fonts-liberation .deb. */
const LIBERATION_DEB = 'https://deb.debian.org/debian/pool/main/f/fonts-liberation/fonts-liberation_2.1.5-3_all.deb';
const LIBERATION = [
  'LiberationSans-Regular.ttf',
  'LiberationSans-Bold.ttf',
  'LiberationSans-Italic.ttf',
  'LiberationSans-BoldItalic.ttf',
  'LiberationSerif-Regular.ttf',
  'LiberationSerif-Bold.ttf',
  'LiberationSerif-Italic.ttf',
  'LiberationSerif-BoldItalic.ttf',
  'LiberationMono-Regular.ttf',
  'LiberationMono-Bold.ttf',
  'LiberationMono-Italic.ttf',
  'LiberationMono-BoldItalic.ttf',
];

mkdirSync(dest, { recursive: true });

const isTtf = (buf) => {
  const magic = buf.subarray(0, 4).toString('latin1');
  return buf.length >= 10_000 && (magic === '\x00\x01\x00\x00' || magic === 'OTTO' || magic === 'true');
};

let ok = true;
const download = async (file, url) => {
  const target = join(dest, file);
  if (existsSync(target)) {
    console.log(`[fetch-editor-fonts] cached: ${file}`);
    return;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!isTtf(buf)) throw new Error('not a valid TTF (bad magic/size)');
    writeFileSync(target, buf);
    console.log(`[fetch-editor-fonts] downloaded: ${file} (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    ok = false;
    console.warn(`[fetch-editor-fonts] FAILED ${file}: ${e.message} — editor will fall back to Helvetica`);
  }
};

const versionCache = new Map();
const expoVersion = async (pkg) => {
  if (versionCache.has(pkg)) return versionCache.get(pkg);
  try {
    const res = await fetch(`https://data.jsdelivr.com/v1/packages/npm/@expo-google-fonts/${pkg}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const v = json.version;
    versionCache.set(pkg, v);
    return v;
  } catch (e) {
    console.warn(`[fetch-editor-fonts] could not resolve version for @expo-google-fonts/${pkg}: ${e.message}`);
    versionCache.set(pkg, null);
    return null;
  }
};

for (const [file, pkg, src] of EXPO) {
  const target = join(dest, file);
  if (existsSync(target)) {
    console.log(`[fetch-editor-fonts] cached: ${file}`);
    continue;
  }
  const version = await expoVersion(pkg);
  if (!version) {
    ok = false;
    continue;
  }
  await download(file, `https://cdn.jsdelivr.net/npm/@expo-google-fonts/${pkg}@${version}/${src}`);
}

for (const [file, url] of DIRECT) await download(file, url);

// Gelasio: fetch the variable files once, copy to the four style names.
for (const [src, targets] of GELASIO) {
  if (targets.every((t) => existsSync(join(dest, t)))) {
    targets.forEach((t) => console.log(`[fetch-editor-fonts] cached: ${t}`));
    continue;
  }
  const tmp = join(tmpdir(), `gelasio-${Date.now()}.ttf`);
  try {
    const url = `https://raw.githubusercontent.com/google/fonts/main/ofl/gelasio/${encodeURIComponent(src)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!isTtf(buf)) throw new Error('not a valid TTF (bad magic/size)');
    writeFileSync(tmp, buf);
    for (const t of targets) {
      if (!existsSync(join(dest, t))) {
        copyFileSync(tmp, join(dest, t));
        console.log(`[fetch-editor-fonts] downloaded: ${t} (variable Gelasio, ${(buf.length / 1024).toFixed(0)} KB)`);
      }
    }
  } catch (e) {
    ok = false;
    console.warn(`[fetch-editor-fonts] FAILED Gelasio ${src}: ${e.message}`);
  }
}

// Liberation: extract the TTFs from the Debian package.
if (LIBERATION.some((f) => !existsSync(join(dest, f)))) {
  try {
    const deb = join(tmpdir(), `fonts-liberation-${Date.now()}.deb`);
    const res = await fetch(LIBERATION_DEB);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(deb, Buffer.from(await res.arrayBuffer()));
    const dataTar = execFileSync('ar', ['p', deb, 'data.tar.xz'], { maxBuffer: 64 * 1024 * 1024 });
    const work = join(tmpdir(), `liberation-${Date.now()}`);
    mkdirSync(work, { recursive: true });
    execFileSync('tar', ['-xJf', '-', '-C', work], { input: dataTar });
    for (const f of LIBERATION) {
      const found = execFileSync('find', [work, '-name', f], { encoding: 'utf8' }).trim().split('\n')[0];
      if (found) {
        copyFileSync(found, join(dest, f));
        console.log(`[fetch-editor-fonts] downloaded: ${f} (from Debian fonts-liberation)`);
      } else {
        throw new Error(`${f} not found in the .deb`);
      }
    }
  } catch (e) {
    ok = false;
    console.warn(`[fetch-editor-fonts] FAILED Liberation: ${e.message} — editor will fall back to Helvetica`);
  }
} else {
  LIBERATION.forEach((f) => console.log(`[fetch-editor-fonts] cached: ${f}`));
}

if (!ok) console.warn('[fetch-editor-fonts] some fonts missing; continuing with fallback');
