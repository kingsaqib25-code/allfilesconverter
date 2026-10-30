'use client';

import type * as React from 'react';

/**
 * Per-tool colorful flat SVG icons (iLovePDF-style), inline components so they
 * work in the static export. One distinct icon per tool id; format-to-format
 * tools use the "morph" motif (from-doc -> arrow -> to-doc) with per-tool
 * colors, PDF/media tools get function-specific motifs.
 */

const PALETTE = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
];

function hashStr(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function iconColors(id: string): [string, string] {
  const h = hashStr(id);
  const a = PALETTE[h % PALETTE.length];
  let b = PALETTE[(h + 4) % PALETTE.length];
  if (b === a) b = PALETTE[(h + 7) % PALETTE.length];
  return [a, b];
}

type Glyph = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'data' | 'sub' | 'doc';

/** White glyph mark centered at (cx, cy), drawn over a colored shape. */
function GlyphMark({ g, cx, cy, s = 1 }: { g: Glyph; cx: number; cy: number; s?: number }) {
  const w = '#ffffff';
  switch (g) {
    case 'image':
      return (
        <g transform={`translate(${cx} ${cy}) scale(${s})`} fill={w}>
          <circle cx={-3.4} cy={-3.2} r={1.7} />
          <path d="M-6 4.5 L-2.2 0.5 L0.4 3 L2.6 0.8 L6 4.5 Z" />
        </g>
      );
    case 'video':
      return (
        <g transform={`translate(${cx} ${cy}) scale(${s})`} fill={w}>
          <path d="M-2.6 -3.6 L3.4 0 L-2.6 3.6 Z" />
        </g>
      );
    case 'audio':
      return (
        <g transform={`translate(${cx} ${cy}) scale(${s})`} fill={w}>
          <circle cx={-2.6} cy={2.6} r={1.9} />
          <rect x={-1.1} y={-4.4} width={1.7} height={7.4} rx={0.8} />
          <path d="M0.6 -4.4 q2.6 0.4 3.4 2.4 l-1.5 0.7 q-0.6 -1.2 -1.9 -1.5 Z" />
        </g>
      );
    case 'sub':
      return (
        <g transform={`translate(${cx} ${cy}) scale(${s})`} fill="none" stroke={w} strokeWidth={1.7} strokeLinecap="round">
          <rect x={-5.4} y={-4} width={10.8} height={6.4} rx={1.6} />
          <path d="M-3.4 -1.6 h6.8 M-3.4 0.8 h4.2" />
        </g>
      );
    case 'data':
      return (
        <g transform={`translate(${cx} ${cy}) scale(${s})`} fill={w}>
          <rect x={-4.6} y={-4.6} width={4} height={4} rx={1} />
          <rect x={0.6} y={-4.6} width={4} height={4} rx={1} />
          <rect x={-4.6} y={0.6} width={4} height={4} rx={1} />
          <rect x={0.6} y={0.6} width={4} height={4} rx={1} />
        </g>
      );
    case 'pdf':
    case 'text':
    case 'doc':
    default:
      return (
        <g transform={`translate(${cx} ${cy}) scale(${s})`} stroke={w} strokeWidth={1.7} strokeLinecap="round">
          <path d="M-4.4 -2.8 h8.8 M-4.4 0 h8.8 M-4.4 2.8 h5.4" />
        </g>
      );
  }
}

/** Rounded document with folded corner. */
function Doc({ x, y, w, h, fill, opacity = 1 }: { x: number; y: number; w: number; h: number; fill: string; opacity?: number }) {
  const f = Math.min(5, w * 0.32);
  return (
    <g opacity={opacity}>
      <path
        d={`M ${x} ${y + 3} Q ${x} ${y} ${x + 3} ${y} L ${x + w - f} ${y} L ${x + w} ${y + f} L ${x + w} ${y + h - 3} Q ${x + w} ${y + h} ${x + w - 3} ${y + h} L ${x + 3} ${y + h} Q ${x} ${y + h} ${x} ${y + h - 3} Z`}
        fill={fill}
      />
      <path d={`M ${x + w - f} ${y} L ${x + w - f} ${y + f} L ${x + w} ${y + f} Z`} fill="#000000" opacity={0.22} />
    </g>
  );
}

const LABEL_OVERRIDES: Record<string, string> = {
  markdown: 'MD',
  webvtt: 'VTT',
  images: 'IMG',
  image: 'IMG',
  video: 'VID',
  videos: 'VID',
  audio: 'AUD',
  text: 'TXT',
  word: 'DOC',
  excel: 'XLS',
  webm: 'WBM',
};

export function shortLabel(s: string): string {
  const k = s.toLowerCase();
  if (LABEL_OVERRIDES[k]) return LABEL_OVERRIDES[k];
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || s.toUpperCase().slice(0, 4);
}

/** Format-to-format "morph": from-doc -> arrow -> to-doc, per-tool colors. */
function Morph({ from, to, fc, tc, glyph }: { from: string; to: string; fc: string; tc: string; glyph: Glyph }) {
  return (
    <g>
      <Doc x={2.5} y={11} w={15.5} h={19} fill={fc} />
      <GlyphMark g={glyph} cx={10.2} cy={18.5} s={0.92} />
      <text x={10.2} y={27.5} textAnchor="middle" fontSize={5.4} fontWeight={800} fill="#ffffff" fontFamily="system-ui, sans-serif">
        {from}
      </text>
      <path d="M20.5 20.5 h6.5 m-2.6 -2.6 L27 20.5 l-2.6 2.6" fill="none" stroke="#94a3b8" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <Doc x={30} y={11} w={15.5} h={19} fill={tc} />
      <GlyphMark g={glyph} cx={37.8} cy={18.5} s={0.92} />
      <text x={37.8} y={27.5} textAnchor="middle" fontSize={5.4} fontWeight={800} fill="#ffffff" fontFamily="system-ui, sans-serif">
        {to}
      </text>
    </g>
  );
}

/* ---------------- special function motifs ---------------- */

/** Merge: fanned stacked pages + plus badge. */
function Stack({ c, glyph }: { c: string; glyph: Glyph }) {
  return (
    <g>
      <Doc x={8} y={6} w={17} h={22} fill="#cbd5e1" />
      <Doc x={14} y={10} w={17} h={22} fill="#94a3b8" />
      <Doc x={20} y={14} w={17} h={22} fill={c} />
      <GlyphMark g={glyph} cx={28.5} cy={25} s={1} />
      <circle cx={38.5} cy={38.5} r={7.5} fill="#22c55e" />
      <path d="M38.5 34.5 v8 M34.5 38.5 h8" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
    </g>
  );
}

/** Split: one page separating into two. */
function Split({ c }: { c: string }) {
  return (
    <g>
      <Doc x={4} y={12} w={14} h={20} fill={c} />
      <GlyphMark g="pdf" cx={11} cy={22} s={0.9} />
      <Doc x={30} y={12} w={14} h={20} fill={c} opacity={0.85} />
      <GlyphMark g="pdf" cx={37} cy={22} s={0.9} />
      <path d="M20 16 l4 4 -4 4 M28 16 l-4 4 4 4" fill="none" stroke="#f59e0b" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 34 h4" stroke="#94a3b8" strokeWidth={2} strokeLinecap="round" strokeDasharray="2.5 2" />
    </g>
  );
}

/** Compress: document squeezed by inward arrows. */
function Squeeze({ c }: { c: string }) {
  return (
    <g>
      <path d="M4 15 l6 6 -6 6" fill="none" stroke="#22c55e" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M44 15 l-6 6 6 6" fill="none" stroke="#22c55e" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      <Doc x={16} y={10} w={16} h={24} fill={c} />
      <GlyphMark g="pdf" cx={24} cy={22} s={1} />
      <path d="M19 14 v12 M21.5 14 v12" stroke="#ffffff" strokeWidth={1.4} opacity={0.7} strokeLinecap="round" />
    </g>
  );
}

/** Rotate: circular arrow around a document/image. */
function Rotate({ c, glyph }: { c: string; glyph: Glyph }) {
  return (
    <g>
      <Doc x={13} y={12} w={18} h={23} fill={c} />
      <GlyphMark g={glyph} cx={22} cy={23.5} s={1} />
      <path d="M38 10 a13 13 0 1 1 -4.5 9.5" fill="none" stroke="#f59e0b" strokeWidth={3} strokeLinecap="round" />
      <path d="M38 4.5 L38 10 L32.5 10" fill="none" stroke="#f59e0b" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/** Edit: document + pencil. */
function Pencil({ c }: { c: string }) {
  return (
    <g>
      <Doc x={6} y={8} w={20} h={28} fill={c} />
      <GlyphMark g="pdf" cx={16} cy={22} s={1} />
      <g transform="rotate(38 34 30)">
        <rect x={31.5} y={12} width={5.5} height={22} rx={2} fill="#f59e0b" />
        <path d="M31.5 30 L34.2 36 L37 30 Z" fill="#fbbf24" />
        <path d="M33.4 34.6 L34.2 36 L35 34.6 Z" fill="#1f2937" />
        <rect x={31.5} y={12} width={5.5} height={4} rx={2} fill="#ec4899" />
      </g>
    </g>
  );
}

/** Watermark: document + droplet. */
function Droplet({ c }: { c: string }) {
  return (
    <g>
      <Doc x={8} y={8} w={22} h={30} fill={c} />
      <GlyphMark g="pdf" cx={19} cy={23} s={1} />
      <path d="M35 22 c4 5.5 6 8.6 6 11.4 a6 6 0 0 1 -12 0 c0 -2.8 2 -5.9 6 -11.4 Z" fill="#06b6d4" />
      <circle cx={32.6} cy={33.4} r={1.4} fill="#fff" opacity={0.8} />
    </g>
  );
}

/** Page numbers: document + 123 badge. */
function Numbers({ c }: { c: string }) {
  return (
    <g>
      <Doc x={8} y={8} w={22} h={30} fill={c} />
      <g stroke="#fff" strokeWidth={1.6} strokeLinecap="round" opacity={0.9}>
        <path d="M13 16 h12 M13 20 h12 M13 24 h7" />
      </g>
      <circle cx={35} cy={33} r={8.5} fill="#6366f1" />
      <text x={35} y={36.4} textAnchor="middle" fontSize={8.5} fontWeight={800} fill="#fff" fontFamily="system-ui, sans-serif">123</text>
    </g>
  );
}

/** Unlock: open padlock + document. */
function LockOpen({ c }: { c: string }) {
  return (
    <g>
      <Doc x={6} y={12} w={20} h={26} fill={c} />
      <GlyphMark g="pdf" cx={16} cy={25} s={1} />
      <rect x={27} y={22} width={15} height={13} rx={2.5} fill="#f59e0b" />
      <path d="M30 22 v-3.5 a4.5 4.5 0 0 1 9 0" fill="none" stroke="#94a3b8" strokeWidth={2.6} strokeLinecap="round" />
      <circle cx={34.5} cy={28.5} r={2.2} fill="#fff" />
      <rect x={33.7} y={28.5} width={1.6} height={4} rx={0.8} fill="#fff" />
    </g>
  );
}

/** Extract images: image popping out of a document. */
function ImagePop({ c }: { c: string }) {
  return (
    <g>
      <Doc x={6} y={14} w={20} h={26} fill={c} />
      <GlyphMark g="pdf" cx={16} cy={27} s={1} />
      <g transform="rotate(-8 34 22)">
        <rect x={26} y={12} width={17} height={14} rx={2.5} fill="#8b5cf6" />
        <circle cx={30.5} cy={16.5} r={1.6} fill="#fff" />
        <path d="M26 23.5 l4 -4 3 3 2.4 -2.4 5 5 v1.4 h-14.4 Z" fill="#fff" opacity={0.92} />
      </g>
      <path d="M24 8 l2 -3 M30 7 l0.6 -3.2 M36 8 l-1 -3" stroke="#f59e0b" strokeWidth={1.8} strokeLinecap="round" />
    </g>
  );
}

/** Redact: document with black censor bars. */
function Blackbar({ c }: { c: string }) {
  return (
    <g>
      <Doc x={10} y={7} w={24} h={32} fill={c} />
      <g stroke="#fff" strokeWidth={1.6} strokeLinecap="round" opacity={0.85}>
        <path d="M15 14 h14 M15 18 h14" />
      </g>
      <rect x={15} y={22.5} width={14} height={4.6} rx={1.2} fill="#1f2937" />
      <g stroke="#fff" strokeWidth={1.6} strokeLinecap="round" opacity={0.85}>
        <path d="M15 31 h14" />
      </g>
      <rect x={15} y={34} width={9} height={4.2} rx={1.2} fill="#1f2937" />
    </g>
  );
}

/** Delete pages: document + trash. */
function Trash({ c }: { c: string }) {
  return (
    <g>
      <Doc x={6} y={10} w={18} h={26} fill={c} />
      <GlyphMark g="pdf" cx={15} cy={23} s={0.95} />
      <g>
        <rect x={27} y={18} width={14} height={17} rx={2} fill="#ef4444" />
        <rect x={25.5} y={15.5} width={17} height={3} rx={1.5} fill="#b91c1c" />
        <rect x={32} y={13} width={5} height={3.4} rx={1.2} fill="#b91c1c" />
        <path d="M30.5 22 v9 M34 22 v9 M37.5 22 v9" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
      </g>
    </g>
  );
}

/** Crop: document inside crop corners. */
function Crop({ c }: { c: string }) {
  return (
    <g>
      <Doc x={12} y={12} w={24} h={26} fill={c} opacity={0.92} />
      <GlyphMark g="pdf" cx={24} cy={25} s={1} />
      <g fill="none" stroke="#22c55e" strokeWidth={3} strokeLinecap="round">
        <path d="M6 14 V6 H14 M34 6 H42 V14 M42 34 V42 H34 M14 42 H6 V34" />
      </g>
    </g>
  );
}

/** Image resize: picture with corner resize arrows. */
function Resize({ c }: { c: string }) {
  return (
    <g>
      <rect x={8} y={10} width={24} height={20} rx={3} fill={c} />
      <circle cx={15} cy={16} r={2} fill="#fff" />
      <path d="M8 26 l6.5 -6.5 4.5 4.5 4 -4 9 9 v1 h-24 Z" fill="#fff" opacity={0.92} />
      <path d="M36 32 l6 6 m0 -4.5 v4.5 h-4.5 M12 40 l-6 6 m4.5 0 h-4.5 v-4.5" fill="none" stroke="#f59e0b" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/** Video to GIF: film strip morphing into a GIF badge. */
function FilmGif({ fc, tc }: { fc: string; tc: string }) {
  return (
    <g>
      <rect x={3} y={13} width={22} height={20} rx={3} fill={fc} />
      <g fill="#fff" opacity={0.9}>
        <rect x={6} y={16} width={4} height={3} rx={0.8} />
        <rect x={6} y={27} width={4} height={3} rx={0.8} />
        <rect x={18} y={16} width={4} height={3} rx={0.8} />
        <rect x={18} y={27} width={4} height={3} rx={0.8} />
      </g>
      <path d="M11.5 18.5 L17 23 L11.5 27.5 Z" fill="#fff" />
      <path d="M27 23 h5 m-2 -2 L32 23 l-2 2" fill="none" stroke="#94a3b8" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <rect x={34} y={15} width={12} height={16} rx={3} fill={tc} />
      <text x={40} y={26} textAnchor="middle" fontSize={6.4} fontWeight={800} fill="#fff" fontFamily="system-ui, sans-serif">GIF</text>
    </g>
  );
}

/** Bulk rename: tag with pencil. */
function Tag({ c }: { c: string }) {
  return (
    <g>
      <g transform="rotate(-18 20 24)">
        <path d="M10 14 h14 l10 10 -14 14 -10 -10 Z" fill={c} />
        <circle cx={17} cy={21} r={2.4} fill="#fff" />
        <text x={24} y={31} fontSize={8} fontWeight={800} fill="#fff" fontFamily="system-ui, sans-serif">Aa</text>
      </g>
      <g transform="rotate(32 36 32)">
        <rect x={33.8} y={20} width={4.6} height={16} rx={1.8} fill="#f59e0b" />
        <path d="M33.8 32 L36.1 37.5 L38.4 32 Z" fill="#fbbf24" />
      </g>
    </g>
  );
}

/** PDF to office/text: document -> big letter / table grid. */
function DocTo({ to, c, kind }: { to: string; c: string; kind: 'T' | 'W' | 'grid' }) {
  return (
    <g>
      <Doc x={2.5} y={11} w={15.5} h={19} fill="#ef4444" />
      <GlyphMark g="pdf" cx={10.2} cy={20.5} s={0.92} />
      <path d="M20.5 20.5 h6.5 m-2.6 -2.6 L27 20.5 l-2.6 2.6" fill="none" stroke="#94a3b8" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <rect x={30} y={11} width={15.5} height={19} rx={3} fill={c} />
      {kind === 'grid' ? (
        <g stroke="#fff" strokeWidth={1.4} opacity={0.95}>
          <path d="M33 15.5 h9.5 M33 20 h9.5 M33 24.5 h9.5 M36.2 12.5 v15.5 M39.4 12.5 v15.5" />
        </g>
      ) : (
        <text x={37.8} y={25.5} textAnchor="middle" fontSize={11} fontWeight={800} fill="#fff" fontFamily="system-ui, sans-serif">
          {kind}
        </text>
      )}
      <text x={37.8} y={36.5} textAnchor="middle" fontSize={5} fontWeight={800} fill="#64748b" fontFamily="system-ui, sans-serif">
        {to}
      </text>
    </g>
  );
}

/* ---------------- per-tool mapping ---------------- */

interface IconDef {
  m: string;
  from?: string;
  to?: string;
  g?: Glyph;
  p?: string;
}

const ICONS: Record<string, IconDef> = {
  'png-to-jpg': { m: 'morph', from: 'PNG', to: 'JPG', g: 'image' },
  'png-to-webp': { m: 'morph', from: 'PNG', to: 'WebP', g: 'image' },
  'png-to-avif': { m: 'morph', from: 'PNG', to: 'AVIF', g: 'image' },
  'jpg-to-png': { m: 'morph', from: 'JPG', to: 'PNG', g: 'image' },
  'jpg-to-webp': { m: 'morph', from: 'JPG', to: 'WebP', g: 'image' },
  'jpg-to-avif': { m: 'morph', from: 'JPG', to: 'AVIF', g: 'image' },
  'webp-to-png': { m: 'morph', from: 'WebP', to: 'PNG', g: 'image' },
  'webp-to-jpg': { m: 'morph', from: 'WebP', to: 'JPG', g: 'image' },
  'webp-to-avif': { m: 'morph', from: 'WebP', to: 'AVIF', g: 'image' },
  'gif-to-png': { m: 'morph', from: 'GIF', to: 'PNG', g: 'image' },
  'gif-to-jpg': { m: 'morph', from: 'GIF', to: 'JPG', g: 'image' },
  'gif-to-webp': { m: 'morph', from: 'GIF', to: 'WebP', g: 'image' },
  'bmp-to-png': { m: 'morph', from: 'BMP', to: 'PNG', g: 'image' },
  'bmp-to-jpg': { m: 'morph', from: 'BMP', to: 'JPG', g: 'image' },
  'bmp-to-webp': { m: 'morph', from: 'BMP', to: 'WebP', g: 'image' },
  'heic-to-jpg': { m: 'morph', from: 'HEIC', to: 'JPG', g: 'image' },
  'heic-to-png': { m: 'morph', from: 'HEIC', to: 'PNG', g: 'image' },
  'heif-to-jpg': { m: 'morph', from: 'HEIF', to: 'JPG', g: 'image' },
  'heif-to-png': { m: 'morph', from: 'HEIF', to: 'PNG', g: 'image' },
  'md-to-html': { m: 'morph', from: 'Markdown', to: 'HTML', g: 'text' },
  'html-to-txt': { m: 'morph', from: 'HTML', to: 'TXT', g: 'text' },
  'txt-to-md': { m: 'morph', from: 'TXT', to: 'Markdown', g: 'text' },
  'json-to-csv': { m: 'morph', from: 'JSON', to: 'CSV', g: 'data' },
  'csv-to-json': { m: 'morph', from: 'CSV', to: 'JSON', g: 'data' },
  'json-to-yaml': { m: 'morph', from: 'JSON', to: 'YAML', g: 'data' },
  'yaml-to-json': { m: 'morph', from: 'YAML', to: 'JSON', g: 'data' },
  'toml-to-json': { m: 'morph', from: 'TOML', to: 'JSON', g: 'data' },
  'xml-to-json': { m: 'morph', from: 'XML', to: 'JSON', g: 'data' },
  'srt-to-vtt': { m: 'morph', from: 'SRT', to: 'WebVTT', g: 'sub' },
  'vtt-to-srt': { m: 'morph', from: 'WebVTT', to: 'SRT', g: 'sub' },
  'srt-to-ass': { m: 'morph', from: 'SRT', to: 'ASS', g: 'sub' },
  'ass-to-srt': { m: 'morph', from: 'ASS', to: 'SRT', g: 'sub' },
  'srt-to-ssa': { m: 'morph', from: 'SRT', to: 'SSA', g: 'sub' },
  'ssa-to-srt': { m: 'morph', from: 'SSA', to: 'SRT', g: 'sub' },
  'vtt-to-ass': { m: 'morph', from: 'WebVTT', to: 'ASS', g: 'sub' },
  'ass-to-vtt': { m: 'morph', from: 'ASS', to: 'WebVTT', g: 'sub' },
  'vtt-to-ssa': { m: 'morph', from: 'WebVTT', to: 'SSA', g: 'sub' },
  'ssa-to-vtt': { m: 'morph', from: 'SSA', to: 'WebVTT', g: 'sub' },
  'ass-to-ssa': { m: 'morph', from: 'ASS', to: 'SSA', g: 'sub' },
  'ssa-to-ass': { m: 'morph', from: 'SSA', to: 'ASS', g: 'sub' },
  'mp4-to-mp3': { m: 'morph', from: 'MP4', to: 'MP3', g: 'video' },
  'mov-to-mp4': { m: 'morph', from: 'MOV', to: 'MP4', g: 'video' },
  'mkv-to-mp4': { m: 'morph', from: 'MKV', to: 'MP4', g: 'video' },
  'webm-to-mp4': { m: 'morph', from: 'WebM', to: 'MP4', g: 'video' },
  'avi-to-mp4': { m: 'morph', from: 'AVI', to: 'MP4', g: 'video' },
  'mp4-to-webm': { m: 'morph', from: 'MP4', to: 'WebM', g: 'video' },
  'video-to-gif': { m: 'filmGif', p: '' },
  'm4v-to-mp4': { m: 'morph', from: 'M4V', to: 'MP4', g: 'video' },
  '3gp-to-mp4': { m: 'morph', from: '3GP', to: 'MP4', g: 'video' },
  'flv-to-mp4': { m: 'morph', from: 'FLV', to: 'MP4', g: 'video' },
  'wav-to-mp3': { m: 'morph', from: 'WAV', to: 'MP3', g: 'audio' },
  'flac-to-mp3': { m: 'morph', from: 'FLAC', to: 'MP3', g: 'audio' },
  'ogg-to-mp3': { m: 'morph', from: 'OGG', to: 'MP3', g: 'audio' },
  'm4a-to-mp3': { m: 'morph', from: 'M4A', to: 'MP3', g: 'audio' },
  'aac-to-mp3': { m: 'morph', from: 'AAC', to: 'MP3', g: 'audio' },
  'mp3-to-wav': { m: 'morph', from: 'MP3', to: 'WAV', g: 'audio' },
  'ogg-to-wav': { m: 'morph', from: 'OGG', to: 'WAV', g: 'audio' },
  'wma-to-mp3': { m: 'morph', from: 'WMA', to: 'MP3', g: 'audio' },
  'pdf-to-jpg': { m: 'morph', from: 'PDF', to: 'JPG', g: 'pdf' },
  'pdf-to-png': { m: 'morph', from: 'PDF', to: 'PNG', g: 'pdf' },
  'jpg-to-pdf': { m: 'morph', from: 'JPG', to: 'PDF', g: 'pdf' },
  'png-to-pdf': { m: 'morph', from: 'PNG', to: 'PDF', g: 'pdf' },
  'webp-to-pdf': { m: 'morph', from: 'WebP', to: 'PDF', g: 'image' },
  'gif-to-pdf': { m: 'morph', from: 'GIF', to: 'PDF', g: 'image' },
  'bmp-to-pdf': { m: 'morph', from: 'BMP', to: 'PDF', g: 'image' },
  'heic-to-pdf': { m: 'morph', from: 'HEIC', to: 'PDF', g: 'image' },
  'txt-to-pdf': { m: 'morph', from: 'TXT', to: 'PDF', g: 'text' },
  'md-to-pdf': { m: 'morph', from: 'Markdown', to: 'PDF', g: 'text' },
  'csv-to-pdf': { m: 'morph', from: 'CSV', to: 'PDF', g: 'data' },
  'merge-pdf': { m: 'stack', p: 'pdf' },
  'split-pdf': { m: 'split', p: '' },
  'compress-pdf': { m: 'squeeze', p: '' },
  'pdf-to-text': { m: 'docTo', p: 'TXT,T' },
  'pdf-to-word': { m: 'docTo', p: 'DOC,W' },
  'pdf-to-excel': { m: 'docTo', p: 'XLS,grid' },
  'edit-pdf': { m: 'pencil', p: '' },
  'merge-images-jpg': { m: 'stack', p: 'image' },
  'merge-images-png': { m: 'stack', p: 'image' },
  'merge-images-pdf': { m: 'stack', p: 'pdf' },
  'merge-videos': { m: 'stack', p: 'video' },
  'merge-audios': { m: 'stack', p: 'audio' },
  'rotate-pdf': { m: 'rotate', p: 'pdf' },
  'watermark-pdf': { m: 'droplet', p: '' },
  'page-numbers-pdf': { m: 'numbers', p: '' },
  'unlock-pdf': { m: 'lockOpen', p: '' },
  'extract-images-pdf': { m: 'imagePop', p: '' },
  'redact-pdf': { m: 'blackbar', p: '' },
  'delete-pages-pdf': { m: 'trash', p: '' },
  'crop-pdf': { m: 'crop', p: '' },
  'image-resize': { m: 'resize', p: '' },
  'image-rotate': { m: 'rotate', p: 'image' },
  'bulk-rename': { m: 'tag', p: '' },
  'gif-maker': { m: 'filmGif', p: '' },
};

function renderMotif(id: string, def: IconDef): React.ReactNode {
  const [fc, tc] = iconColors(id);
  switch (def.m) {
    case 'morph':
      return <Morph from={shortLabel(def.from!)} to={shortLabel(def.to!)} fc={fc} tc={tc} glyph={def.g!} />;
    case 'filmGif':
      return <FilmGif fc={fc} tc={tc} />;
    case 'stack':
      return <Stack c={fc} glyph={(def.p as Glyph) || 'doc'} />;
    case 'split':
      return <Split c={fc} />;
    case 'squeeze':
      return <Squeeze c={fc} />;
    case 'rotate':
      return <Rotate c={fc} glyph={(def.p as Glyph) || 'doc'} />;
    case 'pencil':
      return <Pencil c={fc} />;
    case 'droplet':
      return <Droplet c={fc} />;
    case 'numbers':
      return <Numbers c={fc} />;
    case 'lockOpen':
      return <LockOpen c={fc} />;
    case 'imagePop':
      return <ImagePop c={fc} />;
    case 'blackbar':
      return <Blackbar c={fc} />;
    case 'trash':
      return <Trash c={fc} />;
    case 'crop':
      return <Crop c={fc} />;
    case 'resize':
      return <Resize c={fc} />;
    case 'tag':
      return <Tag c={fc} />;
    case 'docTo': {
      const [to, kind] = (def.p || 'TXT,T').split(',');
      return <DocTo to={to} c={tc} kind={(kind as 'T' | 'W' | 'grid') || 'T'} />;
    }
    default:
      return <Morph from="?" to="?" fc={fc} tc={tc} glyph="doc" />;
  }
}

/**
 * Colorful per-tool icon. Falls back to the morph motif for unknown ids.
 * Inline SVG -> safe for the static export.
 */
export function ToolIcon({
  id,
  size = 44,
  title,
}: {
  id: string;
  size?: number;
  title?: string;
}) {
  const def = ICONS[id];
  return (
    <span
      className="tool-icon"
      role="img"
      aria-label={title ? `${title} icon` : `${id} icon`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        {def ? renderMotif(id, def) : <Morph from="?" to="?" fc={iconColors(id)[0]} tc={iconColors(id)[1]} glyph="doc" />}
      </svg>
    </span>
  );
}
