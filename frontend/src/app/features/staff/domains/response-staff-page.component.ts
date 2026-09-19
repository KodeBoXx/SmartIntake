import { Component } from '@angular/core';
import { M5_STAFF_DOMAIN, StaffPageComponent } from '../staff-page.component';

@Component({ selector: 'app-response-staff-page', standalone: true, imports: [StaffPageComponent], providers: [{ provide: M5_STAFF_DOMAIN, useValue: 'responses' }], template: '<app-staff-page />' })
export class ResponseStaffPageComponent {}
