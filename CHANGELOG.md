# Changelog

All notable changes to `@rolldate/events` are documented here.

## [1.0.0] — 2026-09-10

First stable public release. RollDate Events is free and open-source under the
MIT license with zero runtime dependencies.

Verified from `1.0.0-rc.1`: typecheck, full test suite, build, `npm pack`, and
clean ESM / CJS / TypeScript / CSS consumer smoke tests — in both the monorepo
package and the generated public mirror.

### Added

- **Date navigator** — click the header period (`August 2026 ▾`) to jump directly to a month and year; keyboard accessible with Escape to close and focus return
- **`getDate()` / `getView()`** — stable aliases for `currentDate` / `currentView`
- **`NormalizedEvent`** exported from the public package entry
- Expanded regression tests for navigation, date navigator, and EventStore index invalidation

### Performance

Scroll-path work was largely redundant: every wheel tick re-scanned the whole
event collection and rebuilt the per-day index even when the visible slice had
not changed. Development snapshots at 5,000 events (Node, single run — not a
published benchmark):

| Hot path | Before | After |
|----------|--------|-------|
| Range preparation (cache miss) | 2.45 ms | 0.018 ms |
| Range preparation (unchanged window) | 2.45 ms | ~0.0002 ms |
| Per-day index rebuild | 2.31 ms | 0.35 ms, and only when events change |

- `EventStore` keeps a start-sorted view of normalized events and locates a range
  with a binary search bounded by the longest event duration, so cost scales with
  visible events instead of collection size
- `EventStore` reuses the last prepared slice while the requested range stays
  inside it, and invalidates it on every mutation
- The store no longer builds its per-day index during range preparation; `forDay()`
  builds it on demand
- Views compare a cheap slice signature *before* re-indexing and refreshing DOM;
  previously the index was rebuilt and then discarded
- Agenda view skips segment merging and its forced reflow when the slice is unchanged
- Single-day events (the common case) are indexed without intermediate `Date` allocation
- Identical visible ranges are no longer re-emitted to `onVisibleRangeChange`

### Fixed

- Date navigator: arrow keys pressed while the popover is open no longer navigate the
  underlying calendar period
- Date navigator: dropped `aria-modal="true"` and the focus trap. The popover does not
  block the rest of the page, so it now behaves as a non-modal dialog — Tab moves out and
  dismisses it, while Escape still closes it and returns focus to the trigger
- Package metadata points at the public repository (`Abramov-Front-end/rolldate-events`)
  for `repository` and `bugs`
- Release mirror sync now carries `CHANGELOG.md`, sets `homepage` to
  `https://rolldate.dev/events`, and no longer forces the `beta` dist-tag

### Changed

- Public product positioning: **RollDate Events** is free and open-source under MIT (no licensing gates)
- `licenseKey` / `licenseApiUrl` options marked **deprecated** and ignored in v1
- `isProBuild` / `isProFeature` removed from public exports
- Recurring-event dev warning updated for v1 scope (base occurrence only)

### Migration from 0.1 beta

| 0.1 beta | v1 |
|----------|----|
| `npm install @rolldate/events@beta` | `npm install @rolldate/events` |
| `isProBuild()` export | Removed — not applicable to the free package |
| Header title (display only) | Clickable date navigator |
| APIs marked beta | Stable public API freeze for 1.0 |

No breaking changes to core event CRUD, view names, or callback signatures.

## [0.1.0-beta.2]

- Month view: prefetch event range when the visible month changes
- Agenda view: scroll anchoring and visible-day highlighting
- Demo: sliding-window synthetic data regenerates when navigating far from initial range

## [0.1.0-beta.1]

- Agenda scroll and highlight fixes

## [0.1.0-beta.0]

- Initial free public beta
