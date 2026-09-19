import { Component } from '@angular/core';
import { M5_STAFF_DOMAIN, StaffPageComponent } from '../staff-page.component';

@Component({ selector: 'app-admin-staff-page', standalone: true, imports: [StaffPageComponent], providers: [{ provide: M5_STAFF_DOMAIN, useValue: 'admin' }], template: '<app-staff-page />' })
export class AdminStaffPageComponent {}
