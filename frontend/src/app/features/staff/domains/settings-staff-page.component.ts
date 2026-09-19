import { Component } from '@angular/core';
import { M5_STAFF_DOMAIN, StaffPageComponent } from '../staff-page.component';

@Component({ selector: 'app-settings-staff-page', standalone: true, imports: [StaffPageComponent], providers: [{ provide: M5_STAFF_DOMAIN, useValue: 'settings' }], template: '<app-staff-page />' })
export class SettingsStaffPageComponent {}
