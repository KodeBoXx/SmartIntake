import { Component } from '@angular/core';
import { AdministrationPageComponent } from '../administration-page.component';

@Component({ selector: 'app-settings-staff-page', standalone: true, imports: [AdministrationPageComponent], template: '<app-administration-page />' })
export class SettingsStaffPageComponent {}
