# RollDate Events

High-performance JavaScript event calendar with continuous Month, Week, Day, and Agenda views. Part of the [RollDate](https://rolldate.dev/) ecosystem.

**Free public beta** · **MIT** · **TypeScript** · **ESM + CJS** · **zero runtime dependencies**

## Installation

This is an early beta. Install from the npm `beta` dist-tag:

```bash
npm install @rolldate/events@beta
```

Styles are shipped separately:

```js
import '@rolldate/events/styles'
```

## Quick start

```js
import { RollDateEvents } from '@rolldate/events'
import '@rolldate/events/styles'

const calendar = new RollDateEvents('#calendar', {
  defaultView: 'month',
  events: [
    {
      id: 1,
      title: 'Standup',
      start: '2026-08-20T09:00:00',
      end: '2026-08-20T09:30:00',
      location: 'Zoom'
    }
  ],
  onEventClick: (event) => console.log(event.title)
})

calendar.setView('week')
calendar.today()
```

## Event model

```ts
interface Event {
  id: string | number
  title: string
  start: Date | string
  end: Date | string
  allDay?: boolean
  color?: string          // hex or CSS color
  location?: string
  description?: string
  resourceId?: string     // reserved for future Resource Timeline (not grouped in Free)
  recurring?: EventRecurring // Pro-only expansion; Free renders the base occurrence only
}
```

| Field | Description |
|-------|-------------|
| `id` | Unique event identifier |
| `title` | Display title |
| `start` / `end` | Start and end (Date or ISO/local string) |
| `allDay` | All-day event when `true` |
| `color` | Left accent / chip color |
| `location` | Optional location label |
| `description` | Optional description (not shown in all views) |
| `resourceId` | Reserved API field — **not used** by Free views today |
| `recurring` | Reserved API field — **not expanded** in the Free build |

## Views

| View | Description |
|------|-------------|
| **Month** | Continuous vertical week strip; timed chips or compact dots when narrow |
| **Week** | Horizontal week strip with timed grid and all-day band |
| **Day** | Single-day timed grid with vertical day navigation |
| **Agenda** | Native scroll list of full event rows grouped by date |

All views use buffered `translate3d` strips or native scroll so navigation stays smooth with large datasets.

## Options

```ts
interface RollDateEventsOptions {
  events?: Event[]
  defaultView?: 'month' | 'week' | 'day' | 'agenda'
  defaultDate?: Date | string
  locale?: string                    // default: 'en'
  firstDayOfWeek?: 0 | 1             // 0 = Sunday, 1 = Monday (default)
  theme?: 'light' | 'dark' | 'auto'  // default: 'dark'
  header?: boolean                   // default: true (nav + title + view tabs)
  visibleHours?: { start: number; end: number }  // week/day grid, default 9–18
  eventLimit?: number                // month chips before "+N more", default 3
  minDate?: Date | string            // inclusive navigation bound
  maxDate?: Date | string            // inclusive navigation bound
  licenseKey?: string                // ignored in Free build
  licenseApiUrl?: string             // ignored in Free build
  onEventClick?: (event: Event, nativeEvent: MouseEvent) => void
  onDateClick?: (date: Date, nativeEvent: MouseEvent) => void
  onViewChange?: (view: CalendarViewName) => void
  onVisibleRangeChange?: (range: { from: Date; to: Date }) => void
}
```

## Methods

| Method | Description |
|--------|-------------|
| `setView(view)` | Switch Month / Week / Day / Agenda |
| `setDate(date)` | Jump to a date in the current view |
| `setEvents(events)` | Replace all events |
| `getEvents()` | Return raw event array |
| `addEvent(event)` | Add one event |
| `updateEvent(id, patch)` | Patch an event by id |
| `removeEvent(id)` | Remove by id |
| `today()` | Go to today (respects `minDate` / `maxDate`) |
| `next()` | Next month / week / day / agenda step |
| `prev()` | Previous step |
| `destroy()` | Remove DOM and listeners |

Read-only: `currentView`, `currentDate`, `el`.

## Callbacks

- **`onEventClick(event, nativeEvent)`** — user clicked an event chip/block/row
- **`onDateClick(date, nativeEvent)`** — user clicked a day cell or date header (disabled dates are ignored)
- **`onViewChange(view)`** — view tab changed
- **`onVisibleRangeChange({ from, to })`** — buffered date range needing events (useful for lazy loading)

## Responsive behavior

Layout adapts to the **calendar container width** (not just the browser viewport):

- **≤640px (compact):** Month uses colored dots + `+N`; Week uses readable fixed day columns with horizontal pan; Day and Agenda use dense full-width layouts
- **Agenda:** lists all events for mounted days (no “+N more” truncation)

Requires **`ResizeObserver`** for live reflow when the container is resized. If unavailable, the initial width is used without ongoing resize updates.

## Large datasets

Events are indexed by day. Views mount a bounded buffer of segments and call `onVisibleRangeChange` so you can load or filter data for relevant ranges. Event updates use `syncEvents` where possible to avoid resetting scroll position.

## Browser notes

Targets modern evergreen browsers with ES modules, CSS custom properties, and `ResizeObserver`. No polyfills are bundled.

## Beta status

`0.1.0-beta.0` is an early public beta. APIs may change before `1.0.0`.

Please report issues at [github.com/Abramov-Front-end/rolldate-events/issues](https://github.com/Abramov-Front-end/rolldate-events/issues).

## License

[MIT](./LICENSE)
---

## Source

This repository is the **public Free release mirror** of `@rolldate/events`.
Commercial Pro development stays in a private monorepo; Free/Lite releases are synced here for GitHub and npm.

- npm: https://www.npmjs.com/package/@rolldate/events
- RollDate: https://rolldate.dev/
