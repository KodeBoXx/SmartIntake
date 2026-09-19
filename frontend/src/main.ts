import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppRootComponent } from './app/shells/app-root.component';

bootstrapApplication(AppRootComponent, appConfig).catch(console.error);
