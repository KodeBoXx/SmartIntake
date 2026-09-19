import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  numberAttribute,
  output,
} from '@angular/core';

@Component({
  selector: 'cui-time-column',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './time-column.component.html',
  host: { class: 'flex' },
})
export class CuiTimeColumnComponent {
  /** Current hour, 0–23 (canonical, regardless of `use24Hour`). */
  readonly hour = input.required<number>();
  readonly minute = input.required<number>();
  readonly second = input<number>(0);

  /** Minute (and second) step. */
  readonly step = input(15, { transform: numberAttribute });
  readonly showSeconds = input(false, { transform: booleanAttribute });
  readonly use24Hour = input(true, { transform: booleanAttribute });

  /** Always emits the canonical 0–23 hour. */
  readonly hourChange = output<number>();
  readonly minuteChange = output<number>();
  readonly secondChange = output<number>();

  protected readonly hourList = computed<number[]>(() =>
    this.use24Hour()
      ? Array.from({ length: 24 }, (_, i) => i)
      : Array.from({ length: 12 }, (_, i) => i + 1),
  );

  protected readonly minuteList = computed<number[]>(() => {
    const s = Math.max(1, this.step());
    const out: number[] = [];
    for (let m = 0; m < 60; m += s) out.push(m);
    return out;
  });

  protected readonly secondList = computed<number[]>(() => this.minuteList());

  protected readonly displayHour = computed(() => {
    if (this.use24Hour()) return this.hour();
    const h = this.hour() % 12;
    return h === 0 ? 12 : h;
  });

  protected readonly isPm = computed(() => this.hour() >= 12);

  protected setHour(h: number): void {
    if (this.use24Hour()) {
      this.hourChange.emit(h);
      return;
    }
    const base = h === 12 ? 0 : h;
    this.hourChange.emit(this.isPm() ? base + 12 : base);
  }

  protected setMinute(m: number): void {
    this.minuteChange.emit(m);
  }

  protected setSecond(s: number): void {
    this.secondChange.emit(s);
  }

  protected setAm(): void {
    if (this.isPm()) this.hourChange.emit(this.hour() - 12);
  }

  protected setPm(): void {
    if (!this.isPm()) this.hourChange.emit(this.hour() + 12);
  }

  protected isHourActive(h: number): boolean {
    return this.use24Hour() ? h === this.hour() : h === this.displayHour();
  }
  protected isMinuteActive(m: number): boolean {
    return m === this.minute();
  }
  protected isSecondActive(s: number): boolean {
    return s === this.second();
  }
  protected pad2(n: number): string {
    return n.toString().padStart(2, '0');
  }

  protected cellClasses(active: boolean): string {
    return active
      ? 'h-8 mx-1 my-0.5 rounded-md bg-emerald-600 text-white text-t-200 font-medium'
      : 'h-8 mx-1 my-0.5 rounded-md text-t-200 text-text-primary hover:bg-bg-subtle cursor-pointer transition-colors';
  }
}
