import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const path = process.argv[2] ?? 'dist/smart-intake-web/browser/index.html';
const document = readFileSync(path, 'utf8');
const manifest = readFileSync(join(dirname(path), '_headers'), 'utf8');
const policy = manifest.match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1] ?? '';
const required = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "script-src 'self' 'unsafe-hashes' 'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc='",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self'",
];

for (const directive of required) {
  if (!policy.includes(directive)) throw new Error(`Built document CSP is missing: ${directive}`);
}
if (policy.includes("script-src 'self' 'unsafe-inline'") || /http-equiv="Content-Security-Policy"/i.test(document)) {
  throw new Error('CSP must be delivered by the production header manifest without unsafe inline scripts.');
}
