import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const path = process.argv[2] ?? 'dist/smart-intake-web/browser/index.html';
const document = readFileSync(path, 'utf8');
const manifest = readFileSync(join(dirname(path), '_headers'), 'utf8');
const routePolicies = new Map();
let route = '';
for (const line of manifest.split(/\r?\n/)) {
  if (line.startsWith('/')) route = line.trim();
  const match = line.match(/^\s*Content-Security-Policy:\s*(.+)$/);
  if (match && route) routePolicies.set(route, match[1]);
}
const required = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "script-src 'self' 'unsafe-hashes' 'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc='",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self'",
];

if (routePolicies.has('/*')) throw new Error('Production CSP routes must not overlap a global wildcard.');
for (const [candidateRoute, policy] of routePolicies) {
  for (const directive of required) if (!policy.includes(directive)) throw new Error(`${candidateRoute} CSP is missing: ${directive}`);
  const expectedAncestors = candidateRoute === '/f/*' || candidateRoute === '/sessions/*' ? 'frame-ancestors https:' : "frame-ancestors 'none'";
  if (!policy.includes(expectedAncestors)) throw new Error(`${candidateRoute} CSP must contain: ${expectedAncestors}`);
}
for (const requiredRoute of ['/', '/f/*', '/sessions/*', '/sign-in', '/setup', '/workspaces/*', '/not-found']) {
  if (!routePolicies.has(requiredRoute)) throw new Error(`Production CSP is missing route coverage: ${requiredRoute}`);
}
if (manifest.includes("frame-ancestors 'self'")) throw new Error('Same-origin framing does not permit an approved cross-origin top ancestor.');
if ([...routePolicies.values()].some((policy) => policy.includes("script-src 'self' 'unsafe-inline'")) || /http-equiv="Content-Security-Policy"/i.test(document)) {
  throw new Error('CSP must be delivered by the production header manifest without unsafe inline scripts.');
}
