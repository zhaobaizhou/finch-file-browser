/**
 * Obsidian-style Live Preview for Markdown.
 *
 * The document is always the raw Markdown text — nothing is ever rewritten. A
 * decoration pass hides the syntax markers (`##`, `**`, backticks, `[..](..)`)
 * and applies rendered styling, but only for the elements the caret is NOT in.
 * Put the caret on a heading and its `##` come back; move away and they vanish.
 *
 * That is what makes this lossless: saving writes the original bytes, unlike a
 * contenteditable/prosemirror round-trip which normalises the Markdown.
 */

import { Compartment, EditorState, Facet, Prec, RangeSetBuilder, StateField } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { cellRanges, isTableSeparator, parseTableSource, serializeTable } from './markdownTable.js';
import { tags } from '@lezer/highlight';

/* ── text styling inside the editor ──────────────────────────────────────── */

const liveHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.5em', fontWeight: '700', lineHeight: '1.35' },
  { tag: tags.heading2, fontSize: '1.28em', fontWeight: '700', lineHeight: '1.35' },
  { tag: tags.heading3, fontSize: '1.12em', fontWeight: '650' },
  { tag: tags.heading4, fontSize: '1.02em', fontWeight: '650' },
  { tag: tags.heading5, fontWeight: '650' },
  { tag: tags.heading6, fontWeight: '650', color: 'var(--fb-text-2)' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--fb-accent)' },
  { tag: tags.url, color: 'var(--fb-text-3)' },
  { tag: tags.monospace, fontFamily: 'var(--fb-mono)', fontSize: '0.92em', color: 'var(--fb-accent)' },
  { tag: tags.quote, color: 'var(--fb-text-2)' },
  { tag: tags.list, color: 'var(--fb-text-2)' },
  { tag: tags.contentSeparator, color: 'var(--fb-text-3)' },
]);

/* ── widgets ─────────────────────────────────────────────────────────────── */

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-lp-bullet';
    span.textContent = '•';
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const rule = document.createElement('hr');
    rule.className = 'cm-lp-rule';
    return rule;
  }
  ignoreEvent() {
    return false;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(checked) {
    super();
    this.checked = checked;
  }
  eq(other) {
    return other.checked === this.checked;
  }
  toDOM() {
    const box = document.createElement('span');
    box.className = `cm-lp-task${this.checked ? ' done' : ''}`;
    box.textContent = this.checked ? '☑' : '☐';
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

class ImageWidget extends WidgetType {
  constructor(source, alt) {
    super();
    this.source = source;
    this.alt = alt;
  }
  eq(other) {
    return other.source === this.source && other.alt === this.alt;
  }
  toDOM() {
    const figure = document.createElement('span');
    figure.className = 'cm-lp-image';
    const img = document.createElement('img');
    img.src = this.source;
    img.alt = this.alt;
    figure.appendChild(img);
    return figure;
  }
  ignoreEvent() {
    return false;
  }
}

/** Cell text still carries inline markers; show it the way the reading view would. */
function plainInline(text) {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .trim();
}

/** Display-only view of a table: markers stripped, alignment kept for the render. */
function parseTable(source) {
  const parsed = parseTableSource(source);
  const clean = (cells) => cells.map(plainInline);
  return {
    header: clean(parsed.header),
    body: parsed.body.map(clean),
    align: parsed.align,
    columns: parsed.header.length,
  };
}

/**
 * A real table for a source block that cannot be shown as one. This is a block
 * widget — a multi-line replacement is only allowed as a block — which is why
 * the decorations below are produced by a StateField rather than a ViewPlugin:
 * CodeMirror refuses block decorations from view plugins.
 *
 * A table is never shown as source under the caret: editing happens in the grid
 * editor this widget opens, so the rendered table stays put and the caret cannot
 * land inside it. `ignoreEvent` says so, and keeps CodeMirror from trying to
 * place a selection in text that is not on screen.
 */
class TableWidget extends WidgetType {
  constructor(rows, meta, onEdit) {
    super();
    this.rows = rows;
    this.meta = meta;
    this.onEdit = onEdit;
    this.key = JSON.stringify(rows);
  }
  eq(other) {
    return other.key === this.key;
  }
  toDOM() {
    const box = document.createElement('div');
    box.className = 'cm-lp-table';
    if (this.onEdit) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'cm-lp-table-edit';
      edit.textContent = '编辑表格';
      edit.title = '在网格里编辑这一张表（Tab 跳格）';
      edit.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onEdit(this.meta, this.rows);
      });
      box.appendChild(edit);
    }
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const cell of this.rows.header) {
      const th = document.createElement('th');
      th.textContent = cell;
      const alignment = this.rows.align?.[headRow.childNodes.length];
      if (alignment && alignment !== 'left') th.style.textAlign = alignment;
      headRow.appendChild(th);
    }
    head.appendChild(headRow);
    const body = document.createElement('tbody');
    for (const row of this.rows.body) {
      const tr = document.createElement('tr');
      for (let index = 0; index < this.rows.header.length; index += 1) {
        const td = document.createElement('td');
        td.textContent = row[index] ?? '';
        const alignment = this.rows.align?.[index];
        if (alignment && alignment !== 'left') td.style.textAlign = alignment;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    table.append(head, body);
    box.appendChild(table);
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

/**
 * The grid editor lives in the panel, not in this module. A state field cannot
 * close over a callback, so the panel hands its handler in through a facet.
 */
const editTableHandler = Facet.define({ combine: (values) => values[0] ?? null });

/* ── source-mode cell navigation ─────────────────────────────────────────── */

/**
 * Tab / Shift+Tab inside a raw table moves between cells instead of inserting a
 * tab character, and re-pads the columns so the source stays readable. This is
 * the part of Obsidian's *Advanced Tables* plugin that is worth copying: it makes
 * editing the real source feel like a grid, and it never rewrites anything except
 * whitespace.
 */
function moveCell(view, direction) {
  const { state } = view;
  const head = state.selection.main.head;
  const table = tableAt(state, head);
  if (!table) return false;

  const lines = [];
  for (let number = table.startLine; number <= table.endLine; number += 1) {
    lines.push(state.doc.line(number));
  }
  const separatorIndex = lines.findIndex((line, index) => index > 0 && isTableSeparator(line.text));
  const isSeparator = (index) => index === separatorIndex;

  // Which row and cell the caret sits in right now. cellRanges works in offsets
  // relative to the line, so shift them into document coordinates before comparing.
  const currentLine = state.doc.lineAt(head);
  let rowIndex = lines.findIndex((line) => line.number === currentLine.number);
  if (rowIndex < 0) return true;
  const cells = cellRanges(currentLine.text).map(([from, to]) => [from + currentLine.from, to + currentLine.from]);
  let columnIndex = cells.findIndex(([from, to]) => head >= from && head <= to);
  if (columnIndex < 0) columnIndex = Math.max(0, cells.length - 1);

  // Walk to the target row/cell, skipping the delimiter row.
  let targetRow = rowIndex;
  let targetColumn = columnIndex + direction;
  let insertRowAfter = null;
  if (targetColumn >= cells.length) {
    targetColumn = 0;
    do {
      targetRow += 1;
    } while (targetRow <= lines.length - 1 && isSeparator(targetRow));
    if (targetRow > lines.length - 1) {
      // Tabbing off the last row adds one, the way Advanced Tables does.
      insertRowAfter = lines.length - 1;
      targetRow = lines.length;
    }
  } else if (targetColumn < 0) {
    targetColumn = -1;
    do {
      targetRow -= 1;
    } while (targetRow >= 0 && isSeparator(targetRow));
    // Shift+Tab in the first cell: stay put rather than indenting a table row.
    if (targetRow < 0) return true;
    targetColumn = cellRanges(lines[targetRow].text).length - 1;
  }

  const columns = parseTableSource(lines.map((line) => line.text).join('\n')).header.length;
  const tableRows = lines
    .filter((_, index) => !isSeparator(index))
    .map((line) => cellRanges(line.text).map(([from, to]) => line.text.slice(from, to)));

  // Rebuild the table from its own cells so the padding is uniform, then place the
  // caret in the target cell of the *new* text (offsets change, indices do not).
  const headerCells = tableRows[0] ?? [];
  const dataCells = tableRows.slice(1);
  const align = splitRowAlign(lines);
  if (insertRowAfter !== null) dataCells.push(new Array(Math.max(1, columns)).fill(''));
  const rebuilt = serializeTable(
    { header: headerCells.length ? headerCells : new Array(Math.max(1, columns)).fill(''), body: dataCells, align },
    { pad: true },
  );

  const first = lines[0];
  const last = lines[lines.length - 1];
  const rebuiltLines = rebuilt.split('\n');

  // Map the original row index onto the rebuilt text: header, rule, then data rows.
  let targetLine;
  if (separatorIndex === -1) targetLine = targetRow === 0 ? 0 : targetRow + 1;
  else if (targetRow < separatorIndex) targetLine = 0;
  else targetLine = 2 + (targetRow - separatorIndex - 1);
  targetLine = Math.max(0, Math.min(rebuiltLines.length - 1, targetLine));

  const targetCells = cellRanges(rebuiltLines[targetLine] ?? '');
  const cell = targetCells[Math.min(Math.max(targetColumn, 0), targetCells.length - 1)] ?? null;
  let anchor = first.from;
  for (let index = 0; index < targetLine; index += 1) anchor += rebuiltLines[index].length + 1;
  const position = cell ? anchor + cell[1] : anchor;

  view.dispatch({ changes: { from: first.from, to: last.to, insert: rebuilt }, selection: { anchor: position } });
  return true;
}

/** Alignment markers of a raw table, read off its delimiter row. */
function splitRowAlign(lines) {
  const parsed = parseTableSource(lines.map((line) => line.text).join('\n'));
  return parsed.align;
}

/** The Table node containing `pos`, if any. */
function tableAt(state, pos) {
  let found = null;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table' || node.from > pos || pos > node.to) return;
      found = {
        from: node.from,
        to: node.to,
        startLine: state.doc.lineAt(node.from).number,
        endLine: state.doc.lineAt(Math.min(node.to, state.doc.length)).number,
      };
      return false;
    },
  });
  return found;
}

/* ── decoration pass ─────────────────────────────────────────────────────── */

/** Node names whose markers are hidden while the caret is elsewhere. */
const MARKER_PARENTS = new Set([
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'SetextHeading1',
  'SetextHeading2',
  'StrongEmphasis',
  'Emphasis',
  'Strikethrough',
  'InlineCode',
  'Link',
  'Image',
  'Blockquote',
]);

const HIDE_MARKERS = new Set([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
  'QuoteMark',
  'LinkMark',
]);

const LINE_CLASS = {
  ATXHeading1: 'cm-lp-h1',
  ATXHeading2: 'cm-lp-h2',
  ATXHeading3: 'cm-lp-h3',
  ATXHeading4: 'cm-lp-h4',
  ATXHeading5: 'cm-lp-h5',
  ATXHeading6: 'cm-lp-h6',
  Blockquote: 'cm-lp-quote',
  FencedCode: 'cm-lp-fence',
};

function buildDecorations(state) {
  const builder = new RangeSetBuilder();
  const ranges = [];
  const selection = state.selection.main;

  // A caret anywhere inside a node keeps that node's raw syntax visible.
  const touched = (from, to) => selection.from <= to && selection.to >= from;

  // Line decorations are zero-width, so "to > from" cannot be the guard for them.
  const push = (from, to, decoration) => {
    ranges.push({ from, to, decoration });
  };
  const pushRange = (from, to, decoration) => {
    if (to > from) ranges.push({ from, to, decoration });
  };

  syntaxTree(state).iterate({
    enter: (node) => {
      const name = node.name;

      // ATX headings: a line class + hidden '#' when the caret is away.
      if (name.startsWith('ATXHeading')) {
        const line = state.doc.lineAt(node.from);
        if (!touched(line.from, line.to)) {
          push(line.from, line.from, Decoration.line({ class: LINE_CLASS[name] ?? 'cm-lp-h1' }));
        } else {
          push(line.from, line.from, Decoration.line({ class: 'cm-lp-raw' }));
        }
        return;
      }

      // Fenced code: styled block, fences hidden unless the caret is inside.
      if (name === 'FencedCode') {
        const first = state.doc.lineAt(node.from);
        const last = state.doc.lineAt(Math.min(node.to, state.doc.length));
        for (let number = first.number; number <= last.number; number += 1) {
          const line = state.doc.line(number);
          push(line.from, line.from, Decoration.line({ class: 'cm-lp-code-line' }));
        }
        if (!touched(node.from, node.to)) {
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === 'CodeMark') pushRange(child.from, child.to, Decoration.replace({}));
          }
          const info = node.node.getChild('CodeInfo');
          if (info) pushRange(info.from, info.to, Decoration.replace({}));
        }
        // Skip children: inline rules inside a fence would mangle code.
        return false;
      }

      // Tables: always rendered. Editing happens in the grid editor the widget
      // opens, so the caret never needs to enter the source — which means this is
      // the one element that does not fall back to raw text under the caret.
      if (name === 'Table') {
        const source = state.doc.sliceString(node.from, node.to);
        pushRange(
          node.from,
          node.to,
          Decoration.replace({
            widget: new TableWidget(
              parseTable(source),
              { from: node.from, to: node.to, source },
              state.facet(editTableHandler),
            ),
            block: true,
          }),
        );
        // Never descend: a table is either rendered or raw, nothing in between.
        return false;
      }

      if (name === 'HorizontalRule') {
        pushRange(node.from, node.to, Decoration.replace({ widget: new RuleWidget() }));
        return;
      }

      if (name === 'Task') {
        const marker = node.node.getChild('TaskMarker');
        if (marker) {
          const text = state.doc.sliceString(marker.from, marker.to);
          const checked = /[xX]/.test(text);
          const line = state.doc.lineAt(node.from);
          if (!touched(line.from, line.to)) {
            pushRange(marker.from, marker.to, Decoration.replace({ widget: new CheckboxWidget(checked) }));
          }
        }
        return;
      }

      if (name === 'ListMark') {
        const line = state.doc.lineAt(node.from);
        const text = state.doc.sliceString(node.from, node.to);
        if (!touched(line.from, line.to) && /^[-*+]$/.test(text.trim())) {
          pushRange(node.from, node.to, Decoration.replace({ widget: new BulletWidget() }));
        }
        return;
      }

      // Images: show the picture, keep the source one caret-click away.
      if (name === 'Image') {
        const url = node.node.getChild('URL');
        const alt = node.node.getChild('LinkMark');
        if (url && !touched(node.from, node.to)) {
          pushRange(
            node.from,
            node.to,
            Decoration.replace({ widget: new ImageWidget(state.doc.sliceString(url.from, url.to), alt ? '' : '') }),
          );
          return false;
        }
        return;
      }

      // Inline markers: hide only while the caret sits outside the parent span.
      if (HIDE_MARKERS.has(name)) {
        const parent = node.node.parent;
        if (!parent) return;
        if (touched(parent.from, parent.to)) return;
        if (name === 'LinkMark' || name === 'URL') {
          // '[](…)' collapses to just the label.
          const grand = parent.parent;
          const isImage = grand?.name === 'Image';
          if (isImage && name === 'URL') pushRange(node.from, node.to, Decoration.replace({}));
          if (!isImage && name === 'LinkMark') pushRange(node.from, node.to, Decoration.replace({}));
          if (!isImage && name === 'URL') pushRange(node.from, node.to, Decoration.replace({}));
          return;
        }
        pushRange(node.from, node.to, Decoration.replace({}));
        return;
      }

      if (name in LINE_CLASS && name !== 'Blockquote') return;
      if (name === 'Blockquote') {
        const first = state.doc.lineAt(node.from);
        const last = state.doc.lineAt(Math.min(node.to, state.doc.length));
        for (let number = first.number; number <= last.number; number += 1) {
          const line = state.doc.line(number);
          push(line.from, line.from, Decoration.line({ class: 'cm-lp-quote' }));
        }
        return;
      }
      return;
    },
  });

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const range of ranges) builder.add(range.from, range.to, range.decoration);
  return builder.finish();
}

/**
 * A StateField rather than a ViewPlugin, because a multi-line replacement (the
 * table) must be a block decoration and CodeMirror refuses block decorations
 * from view plugins.
 */
const livePreviewField = StateField.define({
  create: (state) => buildDecorations(state),
  update: (decorations, transaction) => {
    if (transaction.docChanged || transaction.selection) return buildDecorations(transaction.state);
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Tables are rendered whole and never reveal their source, so without this the
 * arrow keys would walk the caret *through* text that is not on screen and let
 * you type into it blind. Marking the ranges atomic makes the caret step over a
 * table as one unit.
 */
const tableRangesField = StateField.define({
  create: (state) => tableRanges(state),
  update: (ranges, transaction) => (transaction.docChanged ? tableRanges(transaction.state) : ranges),
  provide: (field) => EditorView.atomicRanges.of((view) => view.state.field(field)),
});

function tableRanges(state) {
  const builder = new RangeSetBuilder();
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'Table') builder.add(node.from, node.to, Decoration.replace({}));
    },
  });
  return builder.finish();
}

/* ── public surface ──────────────────────────────────────────────────────── */

export const livePreviewTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  // Prose in the body font: this is a document view, not a code view.
  '.cm-scroller': {
    fontFamily: 'var(--finch-font-body)',
    fontSize: 'var(--finch-message-font-size, 13px)',
    lineHeight: 'var(--finch-message-line-height, 1.65)',
  },
  '.cm-content': { padding: '16px 20px 60px', caretColor: 'var(--fb-accent)' },
  '.cm-gutters': {
    backgroundColor: 'var(--fb-bg-elevated)',
    color: 'var(--fb-text-3)',
    border: 'none',
    borderRight: '1px solid var(--fb-border-subtle)',
    fontFamily: 'var(--fb-mono)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-lp-bullet': { color: 'var(--fb-accent)', paddingRight: '2px' },
  '.cm-lp-quote': { borderLeft: '3px solid var(--fb-border)', paddingLeft: '12px', color: 'var(--fb-text-2)' },
  // Code keeps the monospace face and the code font size.
  '.cm-lp-code-line': {
    backgroundColor: 'var(--fb-bg-elevated)',
    fontFamily: 'var(--fb-mono)',
    fontSize: 'var(--lp-code-size, var(--finch-code-font-size, 12px))',
  },
  '.cm-lp-rule': { border: 'none', borderTop: '1px solid var(--fb-border)', margin: '8px 0' },
  '.cm-lp-task': { color: 'var(--fb-text-3)' },
  '.cm-lp-task.done': { color: 'var(--fb-positive)' },
  '.cm-lp-image img': { maxWidth: '100%', borderRadius: '4px', display: 'block' },
});

export function createMarkdownEditor({ parent, doc, onDocChanged, onEditTable }) {
  // Compartments let the mode, the gutter and wrapping change without rebuilding
  // the editor — so undo history survives switching between Live Preview and Source.
  const liveCompartment = new Compartment();
  const gutterCompartment = new Compartment();
  const wrapCompartment = new Compartment();

  const state = EditorState.create({
    doc,
    extensions: [
      gutterCompartment.of([]),
      history(),
      drawSelection(),
      highlightActiveLine(),
      // High precedence so Tab inside a raw table moves between cells before
      // indentWithTab turns it into an indentation character.
      Prec.high(
        keymap.of([
          { key: 'Tab', run: (view) => moveCell(view, 1) },
          { key: 'Shift-Tab', run: (view) => moveCell(view, -1) },
        ]),
      ),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(liveHighlight),
      liveCompartment.of([livePreviewField, tableRangesField]),
      editTableHandler.of(onEditTable ?? null),
      livePreviewTheme,
      wrapCompartment.of([]),
      placeholder('开始写 Markdown…'),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onDocChanged(update.state.doc.toString());
      }),
    ],
  });
  const view = new EditorView({ state, parent });

  return {
    view,
    text: () => view.state.doc.toString(),
    setText(text) {
      if (text === view.state.doc.toString()) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    setLive(enabled) {
      // The atomic ranges belong to the rendered view: in source mode the table is
      // real text and the caret has to be able to move through it.
      view.dispatch({ effects: liveCompartment.reconfigure(enabled ? [livePreviewField, tableRangesField] : []) });
    },
    setLineNumbers(enabled) {
      view.dispatch({ effects: gutterCompartment.reconfigure(enabled ? lineNumbers() : []) });
    },
    setWrap(enabled) {
      view.dispatch({ effects: wrapCompartment.reconfigure(enabled ? EditorView.lineWrapping : []) });
    },
    focus() {
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}
