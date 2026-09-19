# Changelog

All notable changes to this mini tool. Versions follow [SemVer](https://semver.org/):
while the project is pre-1.0, a behaviour change is a **minor** bump and a fix is a **patch**.

Releases are batched by user-visible milestone rather than published per commit — see
"发布节奏" in the README for the reasoning.

## [Unreleased]

Nothing yet.

## [0.3.0] — 2026-09-19

A redesign of the panel plus real version management.

### Changed

- **Toolbar slimmed to three things**: one view toggle, "open with system app", and `⋯`.
  The `预览 / 源码` pair became a single button labelled with the action it performs
  (`查看源码` ⇄ `查看预览`), matching GitHub's Code/Preview convention.
- **Auto-save is no longer optional.** Editing writes back ~0.9s after you stop typing and a
  status dot reports unsaved / saving / saved. The Save button and the `autoSave` setting are
  gone; `⌘S` now just forces the flush. The disk-conflict guard still pauses saving and asks.
- The mini tool is renamed **File Browser / 文件浏览器** (`Session Files` before).
- Dotfiles are hidden by default (`.git`, `.gitignore`, `.trash`), with a quick toggle.

### Added

- **Per-file version history** with a real diff: snapshots on each save (throttled, deduped,
  30 entries / 3MB per file), listed in the `⋯` menu. Picking an entry opens **Finch's native
  diff viewer**; `↺` restores that version, snapshotting the current content first so a restore
  is itself reversible.
- **Settings page** (native `finch.settings`, 14 fields) plus quick toggles in the panel for
  the options people flip while browsing.
- **SVG previews**: SVG renders as a picture (upscaled losslessly) and stays editable as source.
- **Custom icons**: a Lucide-spec line icon for the launcher/Panel tab/Composer button, and a
  Finch-green app icon for the Toolbox card and community listing.

### Fixed

- **The view no longer jumps back to preview after every auto-save.** Our own write landed in
  `fs.watch` and was echoed back as an external change, so the panel re-opened the file and
  reset both the mode and the caret. Writes made by this mini tool are now filtered out of the
  watcher broadcast, and re-opening the file that is already open preserves mode and caret.
- Selecting a locale override shape that was silently ignored: `select` option labels must be
  `{ "<value>": { "label": "…" } }`, not a bare string.

### Removed

- "Roll back last save" — under auto-save it was a one-way trip whose snapshot was only a
  second old. Superseded by the version history above.

## [0.2.0] — 2026-09-14

- Settings page plus in-panel quick toggles: dotfile visibility, text-only listing, ignored
  folder list, sort order, modified-time column, scan limit/depth, Markdown default view,
  source font size / wrapping / line numbers, external-change behaviour.
- Auto-save mode and an optional rollback backup.
- Bundled page libraries moved to devDependencies — the published package has no runtime deps.

## [0.1.0] — 2026-09-14

First release.

- Browse, preview and edit the current conversation's folder from a Panel App: lazily loaded
  searchable file tree, Markdown rendering, syntax highlighting, image preview, in-place editing
  with mtime conflict detection.
- Change highlighting for files this session touched, a "this session" tab listing every file
  the conversation actually read or wrote, path-guarded filesystem access, `fs.watch` refresh,
  and a right-click menu (open with system app, reveal in Finder, copy path, insert into composer).
