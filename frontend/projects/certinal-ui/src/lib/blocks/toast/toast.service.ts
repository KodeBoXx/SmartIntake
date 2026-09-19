import { Injectable, signal } from '@angular/core';
import { CuiToastVariant } from './toast.component';

export interface CuiToastConfig {
  variant?: CuiToastVariant;
  title?: string;
  message: string;
  duration?: number;
  closable?: boolean;
}

export interface CuiToastInstance {
  id: number;
  variant: CuiToastVariant;
  title?: string;
  message: string;
  duration: number;
  closable: boolean;
}

@Injectable({ providedIn: 'root' })
export class CuiToastService {
  private readonly _toasts = signal<CuiToastInstance[]>([]);
  readonly toasts = this._toasts.asReadonly();

  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(config: CuiToastConfig): number {
    const id = this.nextId++;
    const toast: CuiToastInstance = {
      id,
      variant: config.variant ?? 'neutral',
      title: config.title,
      message: config.message,
      duration: config.duration ?? 4000,
      closable: config.closable ?? true,
    };
    this._toasts.update((arr) => [...arr, toast]);

    if (toast.duration > 0) {
      const timer = setTimeout(() => this.dismiss(id), toast.duration);
      this.timers.set(id, timer);
    }
    return id;
  }

  success(message: string, title?: string): number {
    return this.show({ variant: 'success', message, title });
  }

  error(message: string, title?: string): number {
    return this.show({ variant: 'error', message, title, duration: 6000 });
  }

  warning(message: string, title?: string): number {
    return this.show({ variant: 'warning', message, title, duration: 5000 });
  }

  info(message: string, title?: string): number {
    return this.show({ variant: 'info', message, title });
  }

  dismiss(id: number): void {
    const t = this.timers.get(id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(id);
    }
    this._toasts.update((arr) => arr.filter((t) => t.id !== id));
  }

  dismissAll(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    this._toasts.set([]);
  }
}
