import {
  Component,
  booleanAttribute,
  input,
  model,
  output,
} from '@angular/core';
import { CuiIconComponent } from '../../primitives/icon/icon.component';

export type CuiStepperStatus = 'pending' | 'current' | 'complete';

export interface CuiStepperItem {
  label: string;
  description?: string;
}

@Component({
  selector: 'cui-stepper',
  standalone: true,
  imports: [CuiIconComponent],
  templateUrl: './stepper.component.html',
  host: { class: 'block' },
})
export class CuiStepperComponent {
  readonly steps = input.required<CuiStepperItem[]>();
  readonly currentIndex = model<number>(0);
  readonly clickable = input(false, { transform: booleanAttribute });

  readonly stepClick = output<number>();

  protected getStatus(index: number): CuiStepperStatus {
    const cur = this.currentIndex();
    if (index < cur) return 'complete';
    if (index === cur) return 'current';
    return 'pending';
  }

  protected onStepClick(index: number): void {
    if (!this.clickable()) return;
    this.currentIndex.set(index);
    this.stepClick.emit(index);
  }

  protected circleClasses = (status: CuiStepperStatus): string => {
    const base = [
      'flex items-center justify-center shrink-0',
      'w-8 h-8 rounded-full',
      'transition-colors duration-200 ease-out',
      'type-label font-semibold',
      'outline-none focus-visible:outline-3 focus-visible:outline-emerald-400 focus-visible:outline-offset-2',
    ];
    switch (status) {
      case 'complete':
        base.push('bg-emerald-500 text-white border-0');
        break;
      case 'current':
        base.push('bg-emerald-500 text-white ring-4 ring-emerald-100 border-0');
        break;
      case 'pending':
        base.push('bg-bg-surface text-text-muted border-2 border-border-strong');
        break;
    }
    if (this.clickable() && status !== 'pending') base.push('cursor-pointer');
    return base.join(' ');
  };

  protected labelClasses = (status: CuiStepperStatus): string => {
    const base = ['type-label transition-colors duration-200 ease-out'];
    if (status === 'pending') base.push('text-text-muted');
    else if (status === 'current') base.push('text-emerald-700 font-semibold');
    else base.push('text-text-primary font-medium');
    return base.join(' ');
  };

  protected connectorClasses = (index: number): string => {
    const isComplete = index < this.currentIndex();
    const base = ['flex-1 h-0.5 mt-4 mx-2 transition-colors duration-200 ease-out'];
    base.push(isComplete ? 'bg-emerald-500' : 'bg-border-default');
    return base.join(' ');
  };
}
