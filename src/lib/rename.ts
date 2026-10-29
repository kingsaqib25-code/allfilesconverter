/**
 * Bulk File Renamer — pure rename-rule engine (no DOM, no framework).
 * Rules apply to the filename STEM only; the extension is always preserved.
 *
 * Application pipeline (documented in the UI):
 *   1. Find → Replace
 *   2. Spaces handling
 *   3. Strip special characters
 *   4. Case transform
 *   5. Prefix
 *   6. Sequential numbering
 *   7. Suffix
 * Then the original extension is re-attached and duplicates are resolved.
 */

export type CaseMode = 'keep' | 'lower' | 'upper' | 'title';
export type SpaceMode = 'keep' | 'dash' | 'underscore' | 'remove';

export interface RenameRules {
  findEnabled: boolean;
  find: string;
  replace: string;
  useRegex: boolean;
  caseSensitive: boolean;
  spaceMode: SpaceMode;
  stripSpecial: boolean;
  caseMode: CaseMode;
  prefix: string;
  suffix: string;
  numberingEnabled: boolean;
  numberingPosition: 'start' | 'end';
  numberingStart: number;
  numberingPadding: number;
  numberingSep: string;
}

export const DEFAULT_RULES: RenameRules = {
  findEnabled: false,
  find: '',
  replace: '',
  useRegex: false,
  caseSensitive: false,
  spaceMode: 'keep',
  stripSpecial: false,
  caseMode: 'keep',
  prefix: '',
  suffix: '',
  numberingEnabled: false,
  numberingPosition: 'end',
  numberingStart: 1,
  numberingPadding: 3,
  numberingSep: '_',
};

/** Split "photo 1.JPG" → { stem: "photo 1", ext: "JPG" }. Extension preserved exactly. */
export function splitFilename(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  // No dot, or dotfile like ".gitignore" → no extension.
  if (dot <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot + 1) };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleCase(s: string): string {
  return s.replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Apply the rule pipeline to a stem. `index` is the file's 0-based position
 * in the batch (used for sequential numbering).
 */
export function applyRenameRules(stem: string, rules: RenameRules, index: number): string {
  let s = stem;

  // 1. Find → Replace
  if (rules.findEnabled && rules.find) {
    try {
      const pattern = rules.useRegex ? rules.find : escapeRegExp(rules.find);
      const flags = rules.caseSensitive ? 'g' : 'gi';
      s = s.replace(new RegExp(pattern, flags), rules.replace);
    } catch {
      // Invalid regex — leave the stem untouched rather than crashing.
    }
  }

  // 2. Spaces
  if (rules.spaceMode === 'dash') s = s.replace(/ /g, '-');
  else if (rules.spaceMode === 'underscore') s = s.replace(/ /g, '_');
  else if (rules.spaceMode === 'remove') s = s.replace(/ /g, '');

  // 3. Strip special characters (keep letters, numbers, dot, dash, underscore)
  if (rules.stripSpecial) s = s.replace(/[^A-Za-z0-9._-]/g, '');

  // 4. Case
  if (rules.caseMode === 'lower') s = s.toLowerCase();
  else if (rules.caseMode === 'upper') s = s.toUpperCase();
  else if (rules.caseMode === 'title') s = titleCase(s);

  // Guard: rules must never produce an empty name.
  if (!s) s = 'renamed';

  // 5. Prefix
  if (rules.prefix) s = rules.prefix + s;

  // 6. Sequential numbering
  if (rules.numberingEnabled) {
    const n = rules.numberingStart + index;
    const num = String(Math.max(0, n)).padStart(Math.max(1, rules.numberingPadding), '0');
    s = rules.numberingPosition === 'start' ? `${num}${rules.numberingSep}${s}` : `${s}${rules.numberingSep}${num}`;
  }

  // 7. Suffix
  if (rules.suffix) s = s + rules.suffix;

  return s;
}

/** Full rename: stem through the pipeline, extension re-attached untouched. */
export function renameFile(originalName: string, rules: RenameRules, index: number): string {
  const { stem, ext } = splitFilename(originalName);
  const newStem = applyRenameRules(stem, rules, index);
  return ext ? `${newStem}.${ext}` : newStem;
}

/**
 * Resolve duplicate output names (case-insensitive): "a.jpg", "a.jpg"
 * → "a.jpg", "a (2).jpg". Appends " (n)" before the extension.
 */
export function resolveNameConflicts(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const key = name.toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      return name;
    }
    const { stem, ext } = splitFilename(name);
    let n = 2;
    let candidate = ext ? `${stem} (${n}).${ext}` : `${stem} (${n})`;
    while (used.has(candidate.toLowerCase())) {
      n += 1;
      candidate = ext ? `${stem} (${n}).${ext}` : `${stem} (${n})`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** Convenience: rename a whole batch and resolve conflicts in one pass. */
export function renameBatch(originalNames: string[], rules: RenameRules): string[] {
  return resolveNameConflicts(originalNames.map((name, i) => renameFile(name, rules, i)));
}
