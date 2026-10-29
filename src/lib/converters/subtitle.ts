/**
 * Subtitle converters: SRT <-> WebVTT <-> ASS <-> SSA.
 * Hand-rolled parsers and writers, fully on-device. No upload, no server.
 */

export type SubExt = 'srt' | 'vtt' | 'ass' | 'ssa';

interface Cue {
  start: number; // seconds
  end: number; // seconds
  text: string; // may contain newlines
}

/* ---------------- time helpers ---------------- */

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

function fmtSrt(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const x = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(x, 3)}`;
}

function fmtVtt(t: number): string {
  return fmtSrt(t).replace(',', '.');
}

function fmtAss(t: number): string {
  const cs = Math.round(t * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const x = cs % 100;
  return `${h}:${pad(m)}:${pad(s)}.${pad(x)}`;
}

function parseSrtTime(s: string): number {
  const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) throw new Error(`Bad timestamp: ${s}`);
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
}

function parseAssTime(s: string): number {
  const m = s.trim().match(/(\d+):(\d+):(\d+)[.](\d+)/);
  if (!m) throw new Error(`Bad timestamp: ${s}`);
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100;
}

/* ---------------- parsers ---------------- */

function parseSrt(src: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = src.replace(/\r/g, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '');
    if (lines.length < 2) continue;
    const timeLine = lines[/^\d+$/.test(lines[0].trim()) ? 1 : 0];
    const tm = timeLine.match(/(.+?)\s*-->\s*(.+)/);
    if (!tm) continue;
    cues.push({
      start: parseSrtTime(tm[1]),
      end: parseSrtTime(tm[2]),
      text: lines.slice(/^\d+$/.test(lines[0].trim()) ? 2 : 1).join('\n'),
    });
  }
  if (!cues.length) throw new Error('No subtitles found in that SRT file.');
  return cues;
}

function parseVtt(src: string): Cue[] {
  const body = src.replace(/\r/g, '').replace(/^WEBVTT[^\n]*\n/, '');
  const cues: Cue[] = [];
  const blocks = body.split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const tm = lines[timeIdx].match(/(.+?)\s*-->\s*(.+)/);
    if (!tm) continue;
    const clean = (s: string) => s.replace(/<[^>]+>/g, '');
    cues.push({
      start: parseSrtTime(tm[1]),
      end: parseSrtTime(tm[2].split(/\s/)[0]),
      text: lines.slice(timeIdx + 1).map(clean).join('\n'),
    });
  }
  if (!cues.length) throw new Error('No subtitles found in that WebVTT file.');
  return cues;
}

function parseAss(src: string, ssa: boolean): Cue[] {
  const body = src.replace(/\r/g, '');
  const evSection = body.match(/\[Events\][\s\S]*?(?=\n\[|\n*$)/);
  if (!evSection) throw new Error('No [Events] section found in that subtitle file.');
  const lines = evSection[0].split('\n');
  const fmtLine = lines.find((l) => /^Format:/i.test(l));
  if (!fmtLine) throw new Error('No Format line found in the [Events] section.');
  const cols = fmtLine.replace(/^Format:/i, '').split(',').map((c) => c.trim().toLowerCase());
  const iStart = cols.indexOf('start');
  const iEnd = cols.indexOf('end');
  const iText = cols.indexOf('text');
  if (iStart < 0 || iEnd < 0 || iText < 0) throw new Error('Unsupported Dialogue format.');
  const cues: Cue[] = [];
  for (const l of lines) {
    if (!/^Dialogue:/i.test(l)) continue;
    const payload = l.replace(/^Dialogue:/i, '');
    // Split into exactly cols.length parts so commas inside Text survive.
    const parts: string[] = [];
    let rest = payload;
    for (let i = 0; i < cols.length - 1; i++) {
      const idx = rest.indexOf(',');
      if (idx < 0) break;
      parts.push(rest.slice(0, idx));
      rest = rest.slice(idx + 1);
    }
    parts.push(rest);
    if (parts.length < cols.length) continue;
    const text = parts[iText]
      .replace(/\\N/g, '\n')
      .replace(/\{[^}]*\}/g, '');
    cues.push({ start: parseAssTime(parts[iStart]), end: parseAssTime(parts[iEnd]), text });
  }
  if (!cues.length) throw new Error(`No dialogue found in that ${ssa ? 'SSA' : 'ASS'} file.`);
  return cues;
}

/* ---------------- writers ---------------- */

function writeSrt(cues: Cue[]): string {
  return (
    cues
      .map((c, i) => `${i + 1}\n${fmtSrt(c.start)} --> ${fmtSrt(c.end)}\n${c.text}`)
      .join('\n\n') + '\n'
  );
}

function writeVtt(cues: Cue[]): string {
  return (
    'WEBVTT\n\n' +
    cues.map((c) => `${fmtVtt(c.start)} --> ${fmtVtt(c.end)}\n${c.text}`).join('\n\n') +
    '\n'
  );
}

function writeAss(cues: Cue[], ssa: boolean): string {
  const header = ssa
    ? `[Script Info]\nTitle: Converted by All Files Converter\nScriptType: v4.00\n\n[V4 Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding\nStyle: Default,Arial,20,16777215,16777215,16777215,-2147483640,-1,0,1,3,0,2,30,30,30,0,1\n\n[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`
    : `[Script Info]\nTitle: Converted by All Files Converter\nScript Type: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000019FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const lines = cues.map((c) => {
    const text = c.text.replace(/\n/g, '\\N');
    return ssa
      ? `Dialogue: Marked=0,${fmtAss(c.start)},${fmtAss(c.end)},Default,,0000,0000,0000,,${text}`
      : `Dialogue: 0,${fmtAss(c.start)},${fmtAss(c.end)},Default,,0,0,0,,${text}`;
  });
  return header + lines.join('\n') + '\n';
}

/* ---------------- entry point ---------------- */

const PARSERS: Record<SubExt, (src: string) => Cue[]> = {
  srt: parseSrt,
  vtt: parseVtt,
  ass: (s) => parseAss(s, false),
  ssa: (s) => parseAss(s, true),
};

const WRITERS: Record<SubExt, (cues: Cue[]) => string> = {
  srt: writeSrt,
  vtt: writeVtt,
  ass: (c) => writeAss(c, false),
  ssa: (c) => writeAss(c, true),
};

const MIME: Record<SubExt, string> = {
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  ass: 'text/x-ssa',
  ssa: 'text/x-ssa',
};

export function isSubExt(ext: string): ext is SubExt {
  return ext === 'srt' || ext === 'vtt' || ext === 'ass' || ext === 'ssa';
}

export async function convertSubtitle(
  file: File,
  fromExt: SubExt,
  toExt: SubExt
): Promise<{ blob: Blob; filename: string }> {
  const src = await file.text();
  const cues = PARSERS[fromExt](src);
  const out = WRITERS[toExt](cues);
  const base = file.name.replace(/\.[^.]+$/, '');
  return {
    blob: new Blob([out], { type: `${MIME[toExt]};charset=utf-8` }),
    filename: `${base}.${toExt}`,
  };
}
