/**
 * Markdown table utilities, shared by the Live Preview widgets and the grid editor.
 *
 * Everything here is deliberately lossless-by-convention rather than lossless-by-
 * construction: a table is always re-serialised in one canonical shape (`| a | b |`
 * with a `| --- |` rule and padded columns). That is the price of editing a table as
 * a grid instead of as text, and it is the same trade Typora makes. The blast radius
 * is exactly one table block.
 */

/** Count a string in terminal columns: CJK and emoji take two, everything else one. */
export function displayWidth(text) {
  let width = 0;
  for (const character of String(text)) {
    const code = character.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0x303e) ||
      (code >= 0x3041 && code <= 0x33ff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xa000 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

/** Split a table row on unescaped pipes and trim each cell. */
function splitRow(line) {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function parseAlign(marker) {
  const text = marker.trim();
  const left = text.startsWith(':');
  const right = text.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

export function parseTableSource(source) {
  const lines = String(source)
    .split('\n')
    .filter((line) => line.trim().length);
  if (!lines.length) return { header: [], body: [], align: [] };

  const header = splitRow(lines[0]);
  let align = header.map(() => null);
  let bodyStart = 1;
  if (lines.length > 1 && /^[\s|:-]+$/.test(lines[1])) {
    align = splitRow(lines[1]).map(parseAlign);
    bodyStart = 2;
  }
  const body = lines.slice(bodyStart).map(splitRow);
  // Keep the alignment array in step with the header width.
  while (align.length < header.length) align.push(null);
  return { header, body, align: align.slice(0, header.length) };
}

function escapeCell(text) {
  return String(text).trim().replace(/\|/g, '\\|');
}

/** Render a table in one canonical shape, with columns padded to equal width. */
export function serializeTable({ header, body, align }, { pad = true } = {}) {
  const columns = header.length;
  if (!columns) return '';

  const widths = header.map((cell) => displayWidth(escapeCell(cell)));
  if (pad) {
    for (const row of body) {
      for (let index = 0; index < columns; index += 1) {
        widths[index] = Math.max(widths[index], displayWidth(escapeCell(row[index] ?? '')));
      }
    }
  }

  const rule = header.map((_, index) => {
    const width = Math.max(3, pad ? widths[index] : 3);
    const alignment = align[index];
    if (alignment === 'center') return `:${'-'.repeat(Math.max(1, width - 2))}:`;
    if (alignment === 'right') return `${'-'.repeat(Math.max(1, width - 1))}:`;
    if (alignment === 'left') return `:${'-'.repeat(Math.max(1, width - 1))}`;
    return '-'.repeat(width);
  });

  const render = (cells) =>
    `| ${header
      .map((_, index) => {
        const value = escapeCell(cells[index] ?? '');
        if (!pad) return value;
        return value + ' '.repeat(Math.max(0, widths[index] - displayWidth(value)));
      })
      .join(' | ')} |`;

  return [render(header), `| ${rule.join(' | ')} |`, ...body.map(render)].join('\n');
}

/** Cell content ranges of one table row, so the caret can be moved between them. */
export function cellRanges(line) {
  const ranges = [];
  let start = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '|') {
      if (start !== null) ranges.push([start, index]);
      start = index + 1;
      continue;
    }
  }
  return ranges.map(([from, to]) => {
    // Trim the padding so the caret lands on the text, not on the spaces.
    let left = from;
    let right = to;
    while (left < right && line[left] === ' ') left += 1;
    while (right > left && line[right - 1] === ' ') right -= 1;
    return [left, right];
  });
}

export function isTableSeparator(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');
}
