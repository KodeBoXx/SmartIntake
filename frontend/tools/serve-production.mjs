import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const basePolicy = "default-src 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-hashes' 'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc='; connect-src 'self'";
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };

export function isRespondentDocument(pathname) {
  return pathname.startsWith('/f/') || pathname.startsWith('/sessions/');
}

export function parseRequestPath(requestTarget) {
  try { return new URL(requestTarget ?? '/', 'http://localhost').pathname; } catch { return null; }
}

export function createFrontendServer(rootDirectory) {
  const root = resolve(rootDirectory);
  return createServer((request, response) => {
    const pathname = parseRequestPath(request.url);
    if (pathname === null) {
      setSecurityHeaders(response, false);
      response.statusCode = 400;
      response.end('Bad request');
      return;
    }
    setSecurityHeaders(response, isRespondentDocument(pathname));

    let decodedPath;
    try { decodedPath = decodeURIComponent(pathname); } catch {
      response.statusCode = 400;
      response.end('Bad request');
      return;
    }
    const relativePath = normalize(decodedPath).replace(/^[/\\]+/, '');
    let filePath = resolve(root, relativePath);
    if (!filePath.startsWith(`${root}/`) || !statIsFile(filePath)) filePath = join(root, 'index.html');
    response.setHeader('Content-Type', mimeTypes[extname(filePath)] ?? 'application/octet-stream');
    createReadStream(filePath).on('error', () => {
      response.statusCode = 404;
      response.end('Not found');
    }).pipe(response);
  });
}

function setSecurityHeaders(response, respondentDocument) {
  response.setHeader('Content-Security-Policy', `${basePolicy}; frame-ancestors ${respondentDocument ? 'https:' : "'none'"}`);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=()');
}

function statIsFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.env.FRONTEND_ROOT ?? join(process.cwd(), 'dist/smart-intake-web/browser');
  const port = Number(process.env.PORT ?? 4200);
  createFrontendServer(root).listen(port, '0.0.0.0', () => console.log(`SmartIntake frontend listening on ${port}`));
}
