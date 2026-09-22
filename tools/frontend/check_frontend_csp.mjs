import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createFrontendServer } from '../../frontend/tools/serve-production.mjs';

const path = process.argv[2] ?? 'dist/smart-intake-web/browser/index.html';
const document = readFileSync(path, 'utf8');
const manifest = readFileSync(join(dirname(path), '_headers'), 'utf8');
const fallbackPolicy = manifest.match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1] ?? '';
const required = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "script-src 'self' 'unsafe-hashes' 'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc='",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self'",
];

for (const directive of required) if (!fallbackPolicy.includes(directive)) throw new Error(`Static-host fallback CSP is missing: ${directive}`);
if (!fallbackPolicy.includes("frame-ancestors 'none'")) throw new Error('Static-host fallback must fail closed for framing.');
for (const header of ['X-Content-Type-Options: nosniff', 'Referrer-Policy: no-referrer', 'Permissions-Policy: camera=(), geolocation=(), payment=()']) {
  if (!manifest.includes(header)) throw new Error(`Static-host fallback is missing: ${header}`);
}
if (fallbackPolicy.includes("script-src 'self' 'unsafe-inline'") || /http-equiv="Content-Security-Policy"/i.test(document)) {
  throw new Error('CSP must be delivered by response headers without unsafe inline scripts.');
}

const server = createFrontendServer(dirname(path));
await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
try {
  const { port } = server.address();
  for (const [route, expected] of [['/', "frame-ancestors 'none'"], ['/users', "frame-ancestors 'none'"], ['/unknown-spa-route', "frame-ancestors 'none'"], ['/f/channel', 'frame-ancestors https:'], ['/sessions/session', 'frame-ancestors https:']]) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`);
    const policy = response.headers.get('content-security-policy') ?? '';
    for (const directive of [...required, expected]) if (!policy.includes(directive)) throw new Error(`${route} response CSP is missing: ${directive}`);
    if (response.headers.get('x-content-type-options') !== 'nosniff' || response.headers.get('referrer-policy') !== 'no-referrer') throw new Error(`${route} response is missing security headers.`);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
