
import {
  ApplicationRef,
  EnvironmentInjector,
  Injectable,
  createComponent,
  inject,
  DOCUMENT
} from '@angular/core';
import { Observable } from 'rxjs';
import {
  CuiConfirmDialogComponent,
  CuiConfirmTone,
} from './confirm-dialog.component';
import { CuiIconName } from '../../primitives/icon/icon.component';

export interface CuiConfirmConfig {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: CuiConfirmTone;
  icon?: CuiIconName;
}

@Injectable({ providedIn: 'root' })
export class CuiConfirmService {
  private readonly appRef = inject(ApplicationRef);
  private readonly envInjector = inject(EnvironmentInjector);
  private readonly document = inject(DOCUMENT);

  /**
   * Open a confirmation dialog. Returns an Observable<boolean> that emits
   * `true` if the user confirmed, `false` if they cancelled, then completes.
   *
   *   this.confirm.show({ title: 'Delete record?', tone: 'danger' })
   *     .subscribe(ok => { if (ok) delete(); });
   */
  show(config: CuiConfirmConfig): Observable<boolean> {
    return new Observable<boolean>((subscriber) => {
      const host = this.document.createElement('div');
      this.document.body.appendChild(host);

      const compRef = createComponent(CuiConfirmDialogComponent, {
        environmentInjector: this.envInjector,
        hostElement: host,
      });

      compRef.setInput('title', config.title);
      if (config.message !== undefined) {
        compRef.setInput('message', config.message);
      }
      if (config.confirmText !== undefined) {
        compRef.setInput('confirmText', config.confirmText);
      }
      if (config.cancelText !== undefined) {
        compRef.setInput('cancelText', config.cancelText);
      }
      if (config.tone !== undefined) {
        compRef.setInput('tone', config.tone);
      }
      if (config.icon !== undefined) {
        compRef.setInput('icon', config.icon);
      }

      this.appRef.attachView(compRef.hostView);
      compRef.setInput('open', true);

      const cleanup = () => {
        try {
          this.appRef.detachView(compRef.hostView);
          compRef.destroy();
        } finally {
          host.remove();
        }
      };

      const confirmedSub = compRef.instance.confirmed.subscribe(() => {
        subscriber.next(true);
        subscriber.complete();
      });
      const cancelledSub = compRef.instance.cancelled.subscribe(() => {
        subscriber.next(false);
        subscriber.complete();
      });

      return () => {
        confirmedSub.unsubscribe();
        cancelledSub.unsubscribe();
        cleanup();
      };
    });
  }
}
