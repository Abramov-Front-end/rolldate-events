/**
 * Public types for @rolldate/events
 */
/** Calendar view identifiers. `timeline` is Pro-only. */
type CalendarViewName = 'month' | 'week' | 'day' | 'agenda' | 'timeline';
interface CalendarResource {
    id: string;
    title: string;
    color?: string;
}
type EventChangeReason = 'move' | 'resize';
/** Gesture that produced the change. Resize names the edge that moved. */
type EventChangeGesture = 'move' | 'resize-start' | 'resize-end';
/**
 * Persistence scope of a committed change. This is **not** a RecurrenceScope:
 * `'single'` is an ordinary (or already detached) event.
 * - `'single'` — one non-recurring event, or a later move of a detached occurrence
 * - `'this'` — detach one recurring occurrence (exclusion + standalone)
 * - `'series'` — shift the whole recurring series (current live-DnD default)
 *
 * Only implemented values belong here. Do not add a reserved unused member.
 */
type EventChangeScope = 'single' | 'this' | 'series';
/**
 * Values `resolveEventChangeScope` may return. `'single'` is not choosable here —
 * the callback is not called for ordinary or detached events.
 */
type ResolvableOccurrenceScope = 'this' | 'series';
/**
 * Input to `resolveEventChangeScope`. Isolated snapshots of one occurrence.
 * `newOccurrence.start` / `.end` are the proposed times.
 */
interface EventChangeScopeInfo {
    occurrenceIndex: number;
    seriesId: Event['id'];
    oldOccurrence: Event;
    newOccurrence: Event;
    reason: EventChangeGesture;
    view: CalendarViewName;
}
type EventMutation = {
    type: 'update';
    oldEvent: Event;
    newEvent: Event;
} | {
    type: 'create';
    event: Event;
} | {
    type: 'remove';
    event: Event;
};
interface EventChangeTransaction {
    reason: EventChangeGesture;
    scope: EventChangeScope;
    sourceEventId: Event['id'];
    occurrenceIndex?: number;
    mutations: EventMutation[];
}
interface EventChangeInfo {
    /**
     * Convenience snapshot. When `transaction.mutations.length > 1`, persist from
     * `transaction.mutations` — this is the series before a `'this'` detach, not
     * the full operation.
     */
    oldEvent: Event;
    /**
     * Convenience snapshot of the primary visual result (detached event for
     * `'this'`, updated event otherwise). Not an alias of a live store record.
     * When `transaction.mutations.length > 1`, persist from `transaction.mutations`.
     */
    newEvent: Event;
    oldResourceId?: string;
    newResourceId?: string;
    reason: EventChangeGesture;
    view: CalendarViewName;
    /** Isolated mutation list. The source of truth for persistence. */
    transaction: EventChangeTransaction;
}
interface EventChangeContext {
    /**
     * Convenience snapshot from before the committed change.
     * When `transaction.mutations.length > 1`, persist from `transaction.mutations`.
     */
    oldEvent: Event;
    /**
     * Restore every mutation from this change atomically.
     * No-op if already used, superseded, any record from the transaction was
     * replaced, or `setEvents` / another public mutation ran. Does not fire
     * `onEventChange`.
     */
    revert: () => void;
    /** Isolated committed transaction. */
    transaction: EventChangeTransaction;
}
/** Views that can open Day. Day itself is never a Day-jump source. */
type DayOpenSourceView = Exclude<CalendarViewName, 'day'>;
interface DayOpenInfo {
    date: Date;
    /**
     * View the user was on when they opened Day.
     * Captured before `setView('day')` — never the destination `'day'`.
     */
    view: DayOpenSourceView;
    /**
     * Set only when the control that opened Day belonged to a specific resource row.
     * A shared Timeline day header (one label for every row) does not set this.
     */
    resourceId?: string;
}
interface EventMovePatch {
    resourceId?: string;
    /** Timeline stack order among overlapping chips in the same day */
    order?: number;
    /** Other visible-hour pieces of an overnight event, kept as separate events */
    remainders?: Array<{
        start: Date;
        end: Date;
    }>;
}
type ThemeMode = 'light' | 'dark' | 'auto';
type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
/** Recurring rule — expanded in the Pro build */
interface EventRecurring {
    frequency: RecurrenceFrequency;
    /** Every N periods (default 1) */
    interval?: number;
    endDate?: Date | string;
    /** Repeat N times (alternative to endDate) */
    count?: number;
    /**
     * Theoretical occurrence indexes omitted from expansion.
     * Indexes are not renumbered when one is excluded.
     */
    excludedOccurrenceIndexes?: number[];
}
/**
 * Calendar event model.
 * `resourceId` is reserved for future Resource Timeline grouping.
 */
interface Event {
    id: string | number;
    title: string;
    start: Date | string;
    end: Date | string;
    allDay?: boolean;
    /** Hex or CSS color */
    color?: string;
    location?: string;
    description?: string;
    /**
     * Resource / lane id for the Pro Resource Timeline.
     * Month/Week/Day/Agenda still show every event regardless of this field.
     */
    resourceId?: string;
    /** Stack order among overlapping Timeline chips in the same day */
    order?: number;
    /** Expanded in the Pro build when a valid license is present */
    recurring?: EventRecurring;
    /**
     * Per-event drag/resize. `false` locks this event even when the calendar is editable.
     * `true` cannot override a calendar-level `editable: false`.
     * Recurring occurrences inherit this from the series event.
     */
    editable?: boolean;
    /**
     * Restricts resource *changes*. Does not validate, hide, or relocate
     * the event’s current resource. `undefined` = no extra limit; `[]` = no
     * resource change; a non-empty list is the destination allowlist.
     * Combined with calendar `allowedResourceIds` by intersection.
     * Recurring occurrences inherit a copied list from the series.
     */
    allowedResourceIds?: string[];
    /**
     * Set when this event was detached from a series (`scope: 'this'`).
     * Not required to display the event. Later moves are ordinary `'single'` changes.
     */
    recurringSource?: {
        seriesId: Event['id'];
        occurrenceIndex: number;
    };
}
/** @deprecated Use Event — kept as alias for clarity in docs */
type CalendarEvent = Event;
interface VisibleRange {
    from: Date;
    to: Date;
    /** Alias of `from` — exclusive-end window start */
    start?: Date;
    /** Alias of `to` — exclusive end */
    end?: Date;
    view?: CalendarViewName;
}
interface RollDateEventsOptions {
    events?: Event[];
    defaultView?: CalendarViewName;
    defaultDate?: Date | string;
    locale?: string;
    /** 0 = Sunday, 1 = Monday */
    firstDayOfWeek?: 0 | 1;
    theme?: ThemeMode;
    header?: boolean;
    /**
     * Hour window for week/day grids (virtualized outside this band is not mounted).
     * Default: { start: 9, end: 18 }
     */
    visibleHours?: {
        start: number;
        end: number;
    };
    /** Max chips per day cell in month view before "+N more" */
    eventLimit?: number;
    /**
     * Earliest navigable / droppable calendar day (`rangeStart` = 00:00 local).
     * Move and resize keep event interval `[start, end)` on or after this instant:
     * `event.start >= rangeStart && event.end <= rangeEndExclusive`.
     */
    minDate?: Date | string;
    /**
     * Latest navigable / droppable calendar day (inclusive).
     * `rangeEndExclusive` is 00:00 the next local day, so `event.end === rangeEndExclusive` is allowed.
     */
    maxDate?: Date | string;
    /**
     * Commercial license key. Required in the Pro build to unlock
     * recurring expansion, drag/resize, and Resource Timeline.
     * Local demos accept `RDE-DEV-PRO` or `RDE-TEST-*`.
     */
    licenseKey?: string;
    licenseApiUrl?: string;
    /** Resource lanes for the Pro Timeline view */
    resources?: CalendarResource[];
    /**
     * Restricts resource *changes* (Pro Timeline). Does not validate, hide,
     * or relocate an event’s current resource. `undefined` = no limit;
     * `[]` = no resource change; intersected with `event.allowedResourceIds`.
     * A target must also exist in `resources`.
     */
    allowedResourceIds?: string[];
    /**
     * When `false`, move/resize that would overlap another event is cancelled.
     * Default `true`. Intervals are `[start, end)` — touching edges is allowed.
     * Timeline only compares events on the same resource. An event does not
     * conflict with itself. Existing overlaps are not auto-fixed.
     */
    allowOverlap?: boolean;
    /** Allow drag/resize in Week and Day (Pro, default true when unlocked) */
    editable?: boolean;
    /** Snap drag/resize to this many minutes (Pro, default 15) */
    snapMinutes?: number;
    onEventClick?: (event: Event, nativeEvent: MouseEvent) => void;
    onDateClick?: (date: Date, nativeEvent: MouseEvent) => void;
    /** Fired when a day header / Open day control opens Day. Does not replace onDateClick. */
    onDayOpen?: (info: DayOpenInfo) => void;
    onViewChange?: (view: CalendarViewName) => void;
    onVisibleRangeChange?: (range: VisibleRange) => void;
    /**
     * Choose persistence scope after a drop, before the transaction is built (Pro).
     * No built-in modal. Called only for a recurring occurrence. Return `'this'` or
     * `'series'`. Any other value, throw, or reject cancels the gesture. Ordinary
     * and detached events stay `'single'` — the callback is not called.
     */
    resolveEventChangeScope?: (info: EventChangeScopeInfo) => ResolvableOccurrenceScope | Promise<ResolvableOccurrenceScope>;
    /**
     * Called after the user drops a move, before the store commits (Pro).
     * `false`, a rejected promise, or a throw keeps the previous snapshot
     * and does not fire `onEventChange`. While this awaits, the root has
     * `data-event-change-pending="true"`. `setEvents` cancels the pending commit.
     */
    beforeEventMove?: (info: EventChangeInfo) => boolean | Promise<boolean>;
    /**
     * Called after the user finishes a resize, before the store commits (Pro).
     * Same deny / pending / `setEvents` rules as `beforeEventMove`.
     */
    beforeEventResize?: (info: EventChangeInfo) => boolean | Promise<boolean>;
    /**
     * Fired after a successful drag or resize (Pro).
     * `event` and `context.oldEvent` are isolated snapshots.
     * `context.revert()` undoes that change without firing this callback again.
     */
    onEventChange?: (event: Event, reason: EventChangeReason, context: EventChangeContext) => void;
}
/** Normalized in-memory event (Date instances, optional occurrence id) */
interface NormalizedEvent extends Omit<Event, 'start' | 'end'> {
    start: Date;
    end: Date;
    occurrenceId?: string;
    /** 0-based index in the theoretical series, stable across visible ranges. */
    occurrenceIndex?: number;
}
/** Layout patch passed on container resize (no full remount) */
interface LayoutPatch {
    compact: boolean;
    layoutWidth: number;
}
/** Shared context passed into every View.render() */
interface ViewContext {
    root: HTMLElement;
    cursor: Date;
    locale: string;
    firstDayOfWeek: 0 | 1;
    theme: 'light' | 'dark';
    /** True when root width <= 640px */
    compact: boolean;
    /** Measured width of the .rde root (px) */
    layoutWidth: number;
    eventLimit: number;
    visibleHours: {
        start: number;
        end: number;
    };
    minDate?: Date;
    maxDate?: Date;
    /** True when the calendar day is outside minDate/maxDate */
    isDateDisabled: (date: Date) => boolean;
    /** Optional absolute day index bounds for infinite strips */
    minDayIndex?: number;
    maxDayIndex?: number;
    minWeekIndex?: number;
    maxWeekIndex?: number;
    /** Events already filtered / expanded for the visible range */
    events: NormalizedEvent[];
    /** Look up by id or occurrence id */
    getEvent: (id: string) => NormalizedEvent | undefined;
    resources: CalendarResource[];
    editable: boolean;
    onEventClick: (event: NormalizedEvent, e: MouseEvent) => void;
    onDateClick: (date: Date, e: MouseEvent) => void;
    onDayOpen: (date: Date, info?: {
        resourceId?: string;
    }) => void;
    onEventMove: (event: NormalizedEvent, start: Date, end: Date, reason: EventChangeGesture, patch?: EventMovePatch) => void;
    /**
     * View reports the date that should drive the header title
     * (dominant month / week / day in the viewport).
     */
    onAnchorChange: (date: Date) => void;
    /**
     * View reports the buffered date range that needs events loaded.
     * Parent prepares events and calls syncEvents — scroll position is preserved.
     */
    onRangeChange: (range: VisibleRange) => void;
}
/**
 * Pluggable view contract.
 * Resource Timeline (future) will implement the same interface.
 */
interface View {
    readonly name: CalendarViewName;
    /** Mount / refresh UI into ctx.root (body host) */
    render(ctx: ViewContext): void;
    /** Soft-update events without resetting scroll (infinite strip) */
    syncEvents?(events: NormalizedEvent[]): void;
    /** Reflow on container width / compact mode change without remount */
    applyLayout?(patch: LayoutPatch): void;
    /** Jump while keeping the infinite-scroll surface */
    goToDate?(date: Date, opts?: {
        animate?: boolean;
    }): void;
    /** Nudge the infinite strip (week X / day Y / month Y) while dragging */
    nudgeStrip?(delta: number): void;
    /** Scroll the Week hour band */
    scrollTimeBand?(delta: number): void;
    /** Live Week/Day overlap preview while dragging */
    previewTimedMove?(id: string, start: Date, end: Date, originDay: Date, resourceId?: string, clientY?: number, resize?: boolean): {
        top: number;
        height: number;
        leftPct: number;
        widthPct: number;
        order?: number;
    } | null;
    clearTimedPreview?(): void;
    /** Tear down listeners / observers */
    destroy(): void;
}

/**
 * RollDateEvents — orchestrator. Delegates rendering to the active View.
 */

declare class RollDateEvents {
    readonly el: HTMLElement;
    private options;
    private store;
    private viewName;
    private cursor;
    private root;
    private bodyEl;
    private titleHost;
    private dateNavigator;
    private viewCtx;
    private activeView;
    private views;
    private proUnlocked;
    private unbindInteract;
    private changeBusy;
    private revertSeq;
    private dataEpoch;
    private renderToken;
    private layoutWidth;
    private compact;
    private layoutObs;
    private layoutRaf;
    private layoutLock;
    private readonly instanceId;
    constructor(selector: string | HTMLElement, options?: RollDateEventsOptions);
    /** Current view name */
    get currentView(): CalendarViewName;
    /** Alias for {@link currentView} */
    getView(): CalendarViewName;
    /** Cursor date (local start-of-day) */
    get currentDate(): Date;
    /** Alias for {@link currentDate} */
    getDate(): Date;
    /** Switch Month / Week / Day / Agenda */
    setView(view: CalendarViewName): void;
    private openDay;
    /** Jump to a date (keeps current view + scroll surface when possible) */
    setDate(date: Date | string): void;
    /** Replace all events and refresh */
    setEvents(events: Event[]): void;
    getEvents(): Event[];
    addEvent(event: Event): void;
    updateEvent(id: string | number, patch: Partial<Omit<Event, 'id'>>): void;
    removeEvent(id: string | number): void;
    today(): void;
    next(): void;
    prev(): void;
    destroy(): void;
    private shift;
    private boundsMin;
    private boundsMax;
    private isDateDisabled;
    /** Clamp navigation cursor to [minDate, maxDate] by calendar day */
    private clampNavDate;
    private dayIndexBounds;
    private weekIndexBounds;
    private updateTitle;
    private bufferedRange;
    private rangeRaf;
    private rangeSyncToken;
    private emittedFrom;
    private emittedTo;
    private visibleEvents;
    private refreshEvents;
    /** Prefetch beyond the mounted buffer so inserts already have events */
    private paddedRange;
    private onViewRangeChange;
    private flushRangeEvents;
    private onViewAnchorChange;
    private bootstrapLicense;
    private toPublicRange;
    private visibleRange;
    private resolveTheme;
    private visibleHours;
    private mount;
    private measureLayout;
    private startLayoutObserver;
    private onLayoutResize;
    private buildViewContext;
    private render;
    private setChangePending;
    private inferredChangeScope;
    private snapshotForScopeResolver;
    private commitEventMove;
    /**
     * Single commit path for DnD and occurrence scope.
     * Live drag infers `'single'` / `'series'`; `resolveEventChangeScope` may
     * switch an occurrence to `'this'`. An unsupported resolver value cancels.
     */
    private commitOccurrenceChange;
    private transactionIntact;
    private buildOccurrenceTransaction;
    private buildThisTransaction;
    private lookupEvent;
    /** Shift the series by the occurrence delta so weekly/daily siblings keep their offsets. */
    private seriesPatch;
    private syncProChrome;
    private syncInteract;
}

export { RollDateEvents };
export type { CalendarEvent, CalendarResource, CalendarViewName as CalendarView, CalendarViewName, DayOpenInfo, DayOpenSourceView, Event, EventChangeContext, EventChangeGesture, EventChangeInfo, EventChangeReason, EventChangeScope, EventChangeScopeInfo, EventChangeTransaction, EventMutation, EventRecurring, NormalizedEvent, ResolvableOccurrenceScope, RollDateEventsOptions, ThemeMode, View, ViewContext, VisibleRange };
