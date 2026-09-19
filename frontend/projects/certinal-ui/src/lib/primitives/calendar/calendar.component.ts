import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CuiIconComponent } from '../icon/icon.component';
import { CUI_DATE_CONFIG } from './calendar.config';
import {
  addDays,
  addMonths,
  buildMonthMatrix,
  clampToBounds,
  formatMonthYear,
  getWeekdayLabels,
  isAfterDay,
  isBeforeDay,
  isSameDay,
  isSameMonth,
  isWithinRange,
  startOfDay,
  startOfMonth,
} from './calendar.utils';

export type CuiCalendarMode = 'single' | 'range';

export interface CuiCalendarRange {
  start: Date | null;
  end: Date | null;
}

let uid = 0;

@Component({
  selector: 'cui-calendar',
  standalone: true,
  imports: [CuiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './calendar.component.html',
  host: {
    class: 'block select-none',
  },
})
export class CuiCalendarComponent {
  private readonly config = inject(CUI_DATE_CONFIG);

  readonly id = input<string>(`cui-calendar-${++uid}`);
  readonly mode = input<CuiCalendarMode>('single');

  /** The displayed month. Two-way bindable so the parent can sync prev/next nav. */
  readonly viewMonth = model<Date>(startOfMonth(new Date()));

  readonly selected = input<Date | CuiCalendarRange | null>(null);

  /** Hovered cell during range selection — drives the hover preview band. */
  readonly rangeHover = input<Date | null>(null);

  readonly min = input<Date | null>(null);
  readonly max = input<Date | null>(null);
  readonly disabledDates = input<((d: Date) => boolean) | null>(null);

  /** Per-instance overrides; null = use injected CUI_DATE_CONFIG. */
  readonly weekStartsOn = input<0 | 1 | 2 | 3 | 4 | 5 | 6 | null>(null);
  readonly locale = input<string | null>(null);

  readonly showOutsideDays = input(true, { transform: booleanAttribute });
  readonly ariaLabel = input<string | undefined>(undefined);

  readonly daySelect = output<Date>();
  readonly dayHover = output<Date | null>();

  private readonly gridEl = viewChild<ElementRef<HTMLElement>>('grid');

  protected readonly focusedDate = signal<Date>(startOfDay(new Date()));

  protected readonly resolvedLocale = computed(() => this.locale() ?? this.config.locale);
  protected readonly resolvedWeekStartsOn = computed(
    () => this.weekStartsOn() ?? this.config.weekStartsOn,
  );

  protected readonly weekdayLabels = computed(() =>
    getWeekdayLabels(this.resolvedLocale(), this.resolvedWeekStartsOn()),
  );
  protected readonly monthMatrix = computed(() =>
    buildMonthMatrix(this.viewMonth(), this.resolvedWeekStartsOn()),
  );
  protected readonly monthYearLabel = computed(() =>
    formatMonthYear(this.viewMonth(), this.resolvedLocale()),
  );

  protected readonly today = startOfDay(new Date());

  protected readonly canGoPrev = computed(() => {
    const min = this.min();
    if (!min) return true;
    return isBeforeDay(startOfMonth(min), this.viewMonth());
  });
  protected readonly canGoNext = computed(() => {
    const max = this.max();
    if (!max) return true;
    return isAfterDay(startOfMonth(max), this.viewMonth());
  });

  private readonly selectedRange = computed<CuiCalendarRange | null>(() => {
    const sel = this.selected();
    if (!sel || sel instanceof Date) return null;
    return sel;
  });
  private readonly selectedDate = computed<Date | null>(() => {
    const sel = this.selected();
    return sel instanceof Date ? sel : null;
  });

  protected isDayDisabled(d: Date): boolean {
    const min = this.min();
    const max = this.max();
    if (min && isBeforeDay(d, min)) return true;
    if (max && isAfterDay(d, max)) return true;
    const fn = this.disabledDates();
    return fn ? fn(d) : false;
  }

  protected isDayOutsideMonth(d: Date): boolean {
    return !isSameMonth(d, this.viewMonth());
  }

  protected isDaySelected(d: Date): boolean {
    if (this.mode() === 'single') {
      const sel = this.selectedDate();
      return sel ? isSameDay(d, sel) : false;
    }
    const r = this.selectedRange();
    if (!r) return false;
    if (r.start && isSameDay(d, r.start)) return true;
    if (r.end && isSameDay(d, r.end)) return true;
    return false;
  }

  protected isDayInRange(d: Date): boolean {
    if (this.mode() !== 'range') return false;
    const r = this.selectedRange();
    if (!r || !r.start) return false;
    const end = r.end ?? this.rangeHover();
    if (!end) return false;
    const [from, to] = isBeforeDay(r.start, end) ? [r.start, end] : [end, r.start];
    return isWithinRange(d, from, to);
  }

  protected isDayToday(d: Date): boolean {
    return isSameDay(d, this.today);
  }

  protected isDayFocused(d: Date): boolean {
    return isSameDay(d, this.focusedDate());
  }

  protected dayClasses(d: Date): string {
    const classes = [
      'relative w-9 h-9 inline-flex items-center justify-center',
      'text-t-300 rounded-md cursor-pointer border-0 p-0',
      'transition-colors duration-100',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400',
    ];

    const disabled = this.isDayDisabled(d);
    const outside = this.isDayOutsideMonth(d);
    const selected = this.isDaySelected(d);
    const inRange = this.isDayInRange(d) && !selected;
    const today = this.isDayToday(d);

    if (disabled) {
      classes.push('text-text-faint cursor-not-allowed opacity-40');
    } else if (selected) {
      classes.push('bg-emerald-600 text-white font-medium hover:bg-emerald-700');
    } else if (inRange) {
      classes.push('bg-emerald-50 text-emerald-700 rounded-none');
    } else if (outside) {
      classes.push(
        this.showOutsideDays() ? 'text-text-faint hover:bg-bg-subtle' : 'invisible',
      );
    } else {
      classes.push('text-text-primary hover:bg-bg-subtle');
    }

    if (today && !selected) classes.push('ring-1 ring-inset ring-emerald-500');

    return classes.join(' ');
  }

  protected onDayClick(d: Date): void {
    if (this.isDayDisabled(d)) return;
    const day = startOfDay(d);
    this.focusedDate.set(day);
    this.daySelect.emit(day);
    if (!isSameMonth(day, this.viewMonth())) {
      this.viewMonth.set(startOfMonth(day));
    }
  }

  protected onDayMouseEnter(d: Date): void {
    if (this.mode() !== 'range' || this.isDayDisabled(d)) return;
    this.dayHover.emit(startOfDay(d));
  }

  protected onGridMouseLeave(): void {
    if (this.mode() === 'range') this.dayHover.emit(null);
  }

  protected goToPrevMonth(): void {
    if (!this.canGoPrev()) return;
    this.viewMonth.update((d) => addMonths(d, -1));
  }

  protected goToNextMonth(): void {
    if (!this.canGoNext()) return;
    this.viewMonth.update((d) => addMonths(d, 1));
  }

  protected onKeydown(event: KeyboardEvent): void {
    const focused = this.focusedDate();
    const ws = this.resolvedWeekStartsOn();
    let next: Date | null = null;

    switch (event.key) {
      case 'ArrowLeft':
        next = addDays(focused, -1);
        break;
      case 'ArrowRight':
        next = addDays(focused, 1);
        break;
      case 'ArrowUp':
        next = addDays(focused, -7);
        break;
      case 'ArrowDown':
        next = addDays(focused, 7);
        break;
      case 'Home':
        next = addDays(focused, -((focused.getDay() - ws + 7) % 7));
        break;
      case 'End':
        next = addDays(focused, 6 - ((focused.getDay() - ws + 7) % 7));
        break;
      case 'PageUp':
        next = addMonths(focused, event.shiftKey ? -12 : -1);
        break;
      case 'PageDown':
        next = addMonths(focused, event.shiftKey ? 12 : 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.onDayClick(focused);
        return;
      default:
        return;
    }

    event.preventDefault();
    next = clampToBounds(next, this.min(), this.max());
    this.focusedDate.set(next);
    if (!isSameMonth(next, this.viewMonth())) {
      this.viewMonth.set(startOfMonth(next));
    }
    // DOM hasn't re-rendered yet; defer focus until after CD flushes.
    setTimeout(() => this.focusActiveCell(), 0);
  }

  private focusActiveCell(): void {
    const grid = this.gridEl()?.nativeElement;
    if (!grid) return;
    grid.querySelector<HTMLElement>('[data-cui-active="true"]')?.focus();
  }

  /** Sync focusedDate with `selected` when the parent first writes a value. */
  constructor() {
    queueMicrotask(() => {
      const sel = this.selected();
      if (sel instanceof Date) {
        this.focusedDate.set(startOfDay(sel));
      } else if (sel?.start) {
        this.focusedDate.set(startOfDay(sel.start));
      }
    });
  }
}
