import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const path = process.argv[2] ?? 'dist/smart-intake-web/browser/index.html';
const document = readFileSync(path, 'utf8');
const manifest = readFileSync(join(dirname(path), '_headers'), 'utf8');
const policies = [...manifest.matchAll(/^\s*Content-Security-Policy:\s*(.+)$/gm)].map((match) => match[1]);
const [policy, respondentPolicy] = policies;
const required = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "script-src 'self' 'unsafe-hashes' 'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc='",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self'",
];

for (const directive of required) for (const candidate of policies) if (!candidate?.includes(directive)) throw new Error(`Built document CSP is missing: ${directive}`);
if (!policy?.includes("frame-ancestors 'none'")) throw new Error('Default routes must deny framing.');
if (!respondentPolicy?.includes('frame-ancestors https:')) throw new Error('Respondent routes must permit approved HTTPS embed ancestors.');
if (policy.includes("script-src 'self' 'unsafe-inline'") || /http-equiv="Content-Security-Policy"/i.test(document)) {
  throw new Error('CSP must be delivered by the production header manifest without unsafe inline scripts.');
}
