import { Component } from '@angular/core';
import { StaffPageComponent } from '../staff-page.component';

@Component({ selector: 'app-admin-staff-page', standalone: true, imports: [StaffPageComponent], template: '<app-staff-page />' })
export class AdminStaffPageComponent {}
