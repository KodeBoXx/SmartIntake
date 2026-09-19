import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppRootComponent } from './app/shells/app-root.component';
import { ExpressionEngine } from './app/expression/expression-engine';

// The real-browser conformance runner invokes this narrow, deterministic test
// seam after Angular has loaded the compiled application bundle. It exposes no
// product state and accepts only an evaluator-test projection from the frozen
// source-handoff corpus.
(window as Window & { __smartIntakeExpression?: ExpressionEngine }).__smartIntakeExpression = new ExpressionEngine();

bootstrapApplication(AppRootComponent, appConfig).catch(console.error);
