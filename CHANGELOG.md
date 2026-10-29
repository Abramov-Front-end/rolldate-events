# Changelog

All notable changes to `@rolldate/events` are documented here.

## [Unreleased]

### Added (Pro, local only)

- Recurring expansion in the Pro build
- Drag and resize for timed events in Week / Day
- Resource Timeline: day-based horizontal strip (~7 visible days), native H-scroll with a bounded date buffer, edge auto-scroll while dragging, day-snap resize
- Local examples: `npm run dev:pro` → `/demo/pro.html` (scheduler + dense timeline)

### Fixed (Pro, local only)

- Timeline cards use the day column, not hour-of-day offsets, so noon events no longer start at mid-column and hour-long events are no longer 5px strips
- Horizontal Timeline motion uses translate3d (same strip as Week); no native H-scrollbar
- Timeline drag no longer opens a page-wide horizontal scrollbar (hidden chip stays in flow)
- Timed move keeps visible work duration; hours past 18:00 continue from 08:00 the next day (no shrink-to-1h jump)
- Moving 17:00–10:00 to 13:00 stays a 3-hour same-day block, not a filled day
- Moving a next-day fragment shifts the real start/end; it no longer treats 08:00 as the event start
- Moving a multi-day or full-day block keeps its duration (no snap-to-fill the visible day)
- Resize parks the new height immediately and uses the fragment of the day under the pointer
- Recurring drag/resize looks up the occurrence and shifts the series by a delta
- Week/Day drag clones the ghost before hiding the original, so the moving event stays visible
- Timeline drop is a single start/end/resource change (no cell-reorder shifts)
- Drop preview marks the landing slot in Week / Day / Timeline instead of the whole cell
- Timeline drag matches Week: dashed slot (not the day), live chip on another resource, and lane reorder inside a cell
- Timeline packs each day cell from the top after a chip leaves, so leftover events do not sit under an empty lane
- Week and Timeline pan with translate3d on both axes: vertical wheel stays vertical only when content overflows, trackpad/Shift+wheel go sideways, arrows when focused, edge fades + hint
- Resize handles show on hover/focus; Week/Day resize from both edges; Escape cancels an in-flight drag or resize
- Day view can drop onto another day and resize past midnight
- Timeline scrolls inside the calendar; Week/Day height shrinks to the hour band (max 680px)
- Click no longer snaps a block to 08:00; drag starts after an 8px move
- Month chips can be dropped on another day; dragging past the grid edge auto-scrolls
- Agenda viewport shrinks to the event list (max 640px)
- Timeline day-header Day-jump does not invent a `resourceId`; `onDayOpen.view` is the source view, never the opened Day
- `beforeEventMove` / `beforeEventResize` can deny a drop (`false`, reject, or throw). After a commit, `onEventChange` receives `{ oldEvent, revert }` so a failed backend write can restore the exact snapshot without resetting scroll
- Event-change snapshots are isolated (`oldEvent` / `newEvent` only — no `event` alias). `.rde` gets `data-event-change-pending="true"` while a hook awaits; `setEvents` cancels a stale commit; `revert()` will not resurrect a removed or replaced event and does not re-fire `onEventChange`
- `event.editable: false` locks move/resize for that event (handles stay out of the DOM). `event.editable: true` cannot override calendar `editable: false`. Recurring occurrences inherit the series flag.
- `minDate` / `maxDate` now also block move and resize. Event interval is `[start, end)`; allowed iff `event.start >= rangeStart && event.end <= rangeEndExclusive` (`rangeEndExclusive` = next midnight after `maxDate`). An invalid preview is marked immediately; drop does not call `before*` / `onEventChange`.
- `allowedResourceIds` (calendar + event, intersection) restricts Timeline resource changes only. Same-resource move/resize stay allowed; an unknown `resources` id is not a valid target. Invalid drops cancel without `before*` / `onEventChange`.
- `allowOverlap` (default `true`). `false` blocks move/resize that create a `[start, end)` overlap. Touching edges is allowed. Timeline only compares the same resource. Existing overlaps are not auto-fixed. Invalid drops cancel without `before*` / `onEventChange`.
- Recurring `'this'` scope: detach one occurrence (`excludedOccurrenceIndexes` + standalone event) as an atomic transaction. Public `EventChangeScope` is `'single' | 'this' | 'series'` (not a RecurrenceScope; unimplemented members are omitted). `resolveEventChangeScope` returns only `ResolvableOccurrenceScope` (`'this' | 'series'`) — no built-in modal; an unsupported runtime value cancels instead of falling back. Default live DnD of an occurrence stays `'series'`. `EventChangeScopeInfo` exposes `occurrenceIndex`, `seriesId`, `oldOccurrence`, `newOccurrence`, `reason`, `view`. `before*` / `onEventChange` include isolated `transaction.mutations` (persist from that list when `mutations.length > 1`). Occurrence indexes are theoretical and stable across visible ranges.

## [1.0.2] — 2026-10-29

### Fixed

- **Week header** — when a week spans two months, the title is `Feb – Mar 2026` instead of only the “primary” month
- **Date navigator** — marks every month present in the current week as current
- **Month jump** — selecting a month from the navigator stays on that month (top-of-strip anchor + cursor sync)

## [1.0.1] — 2026-09-15

### Changed

- **Agenda** — compact event list grouped by date; days without events are skipped

### Fixed

- **Date navigator** — previous/next year jumps to the current month of that year; the popover stays open until a month is chosen or the user clicks outside
- **Public demo data** — the 100 / 1,000 / 5,000 counts stay inside a bounded window and no longer spawn events for every scrolled year
- **Layout** — calendar height uses fixed pixels (no `vh`), and compact mode has hysteresis so the layout does not flicker at the breakpoint

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
