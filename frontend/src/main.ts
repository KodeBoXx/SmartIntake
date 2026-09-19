import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppRootComponent } from './app/shells/app-root.component';
import { installExpressionTestSeam } from './app/expression/expression-test-seam';

// The real-browser conformance runner enables this before bootstrap with an
// init script. Production loads do not receive an evaluator global.
installExpressionTestSeam(window);

bootstrapApplication(AppRootComponent, appConfig).catch(console.error);
