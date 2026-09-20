import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? 'dist/smart-intake-web/browser/index.html';
const document = readFileSync(path, 'utf8');
const policy = document.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1] ?? '';
const required = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
];

for (const directive of required) {
  if (!policy.includes(directive)) throw new Error(`Built document CSP is missing: ${directive}`);
}
