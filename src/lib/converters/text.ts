/**
 * Plain-text and data-format converters. Everything is string manipulation
 * in the browser — no upload, no server.
 */

async function readText(file: File): Promise<string> {
  return file.text();
}

function outName(file: File, toExt: string): string {
  return `${file.name.replace(/\.[^.]+$/, '')}.${toExt}`;
}

function textResult(file: File, toExt: string, text: string, mime: string) {
  return {
    blob: new Blob([text], { type: `${mime};charset=utf-8` }),
    filename: outName(file, toExt),
  };
}

/* ---------------- Markdown ---------------- */

export async function mdToHtml(file: File) {
  const { marked } = await import('marked');
  const src = await readText(file);
  const body = marked.parse(src, { async: false }) as string;
  const html = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${escapeHtml(
    file.name
  )}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
  return textResult(file, 'html', html, 'text/html');
}

export async function txtToMd(file: File) {
  const src = await readText(file);
  // Light touch: keep the text as-is; Markdown renders plain text fine.
  // Turn lines starting with "- " or "* " into proper lists is already valid Markdown.
  return textResult(file, 'md', src.endsWith('\n') ? src : src + '\n', 'text/markdown');
}

/* ---------------- HTML ---------------- */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripTags(html: string): string {
  // Remove scripts/styles first, then tags, then decode common entities.
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  // Turn block boundaries into line breaks before stripping.
  t = t.replace(/<(br|p|div|h[1-6]|li|tr|blockquote)[^>]*>/gi, '\n');
  t = t.replace(/<[^>]+>/g, '');
  t = t
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, '');
  // Collapse 3+ blank lines into 2.
  t = t.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  return t;
}

export async function htmlToTxt(file: File) {
  const src = await readText(file);
  return textResult(file, 'txt', stripTags(src), 'text/plain');
}

/* ---------------- CSV <-> JSON ---------------- */

function parseCsv(src: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c === '\r') {
      // ignore; \n handles the break
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function csvToJson(file: File) {
  const src = await readText(file);
  const rows = parseCsv(src);
  if (rows.length === 0) throw new Error('That CSV looks empty.');
  const [header, ...data] = rows;
  const objs = data.map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => {
      o[h.trim() === '' ? `column_${i + 1}` : h] = r[i] ?? '';
    });
    return o;
  });
  return textResult(file, 'json', JSON.stringify(objs, null, 2) + '\n', 'application/json');
}

export async function jsonToCsv(file: File) {
  const src = await readText(file);
  let data: unknown;
  try {
    data = JSON.parse(src);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const arr = Array.isArray(data) ? data : [data];
  if (arr.length === 0) throw new Error('That JSON has no records to convert.');
  if (!arr.every((r) => typeof r === 'object' && r !== null)) {
    throw new Error('JSON to CSV needs an array of objects (or a single object).');
  }
  const headers = [...new Set(arr.flatMap((r) => Object.keys(r as object)))];
  const lines = [
    headers.map(csvCell).join(','),
    ...arr.map((r) =>
      headers.map((h) => csvCell(String((r as Record<string, unknown>)[h] ?? ''))).join(',')
    ),
  ];
  return textResult(file, 'csv', lines.join('\n') + '\n', 'text/csv');
}

/* ---------------- JSON <-> YAML ---------------- */

export async function jsonToYaml(file: File) {
  const yaml = await import('js-yaml');
  const src = await readText(file);
  let data: unknown;
  try {
    data = JSON.parse(src);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const out = (yaml as { dump: (d: unknown) => string }).dump(data);
  return textResult(file, 'yaml', out, 'text/yaml');
}

export async function yamlToJson(file: File) {
  const yaml = await import('js-yaml');
  const src = await readText(file);
  let data: unknown;
  try {
    data = (yaml as { load: (s: string) => unknown }).load(src);
  } catch (e) {
    throw new Error(
      `That file is not valid YAML${e instanceof Error ? `: ${e.message}` : '.'}`
    );
  }
  return textResult(file, 'json', JSON.stringify(data, null, 2) + '\n', 'application/json');
}

/* ---------------- TOML -> JSON ---------------- */

export async function tomlToJson(file: File) {
  const toml = await import('smol-toml');
  const src = await readText(file);
  let data: unknown;
  try {
    data = (toml as { parse: (s: string) => unknown }).parse(src);
  } catch (e) {
    throw new Error(
      `That file is not valid TOML${e instanceof Error ? `: ${e.message}` : '.'}`
    );
  }
  return textResult(file, 'json', JSON.stringify(data, null, 2) + '\n', 'application/json');
}

/* ---------------- XML -> JSON (basic) ---------------- */

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

function parseXml(src: string): XmlNode {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const tagRe = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(src))) {
    const textBetween = src.slice(last, m.index);
    if (textBetween.trim()) {
      stack[stack.length - 1].text += textBetween.trim() + ' ';
    }
    last = tagRe.lastIndex;
    const [, closing, tag, attrStr, selfClose] = m;
    if (tag.toLowerCase() === '?xml' || tag.startsWith('!')) continue;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    const attrRe = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrStr))) {
      attrs[am[1]] = am[2] ?? am[3] ?? '';
    }
    const node: XmlNode = { tag, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

function xmlNodeToJson(node: XmlNode): unknown {
  const kids: Record<string, unknown[]> = {};
  for (const c of node.children) {
    (kids[c.tag] = kids[c.tag] || []).push(xmlNodeToJson(c));
  }
  const text = node.text.trim();
  const hasAttrs = Object.keys(node.attrs).length > 0;
  const hasKids = Object.keys(kids).length > 0;
  if (!hasAttrs && !hasKids) return text;
  const o: Record<string, unknown> = {};
  if (hasAttrs) o['@attributes'] = node.attrs;
  for (const [k, v] of Object.entries(kids)) o[k] = v.length === 1 ? v[0] : v;
  if (text) o['#text'] = text;
  return o;
}

export async function xmlToJson(file: File) {
  const src = await readText(file);
  if (!src.trim().startsWith('<')) {
    throw new Error('That file does not look like XML.');
  }
  const root = parseXml(src);
  if (root.children.length === 0) throw new Error('We could not parse that XML.');
  const o: Record<string, unknown> = {};
  for (const c of root.children) o[c.tag] = xmlNodeToJson(c);
  return textResult(file, 'json', JSON.stringify(o, null, 2) + '\n', 'application/json');
}
