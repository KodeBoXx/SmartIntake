import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CuiToastHostComponent } from '@certinal/ui';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CuiToastHostComponent],
  template: '<router-outlet /><cui-toast-host />',
})
export class AppRootComponent {}
