# Smart Form Builder Lite 1.1

A runnable Angular 20 + Tailwind 4 + Spring Boot + PostgreSQL implementation of the Smart Form Builder Lite contract. The repository preserves the supplied handoff and Certinal UI snapshot under `docs/source-handoff/` and `assets/certinal/`.

## Run locally

```bash
docker compose up -d postgres
cd backend && mvn spring-boot:run
# separate shell
cd frontend && npm install && npm start
```

Open <http://localhost:4200>. API health: <http://localhost:8080/v1/health>.

## Serve a production build

Run `npm run build && npm run serve:production` behind the deployment TLS proxy.
The production server denies framing for every document by default. It permits HTTPS ancestors only for `/f/*` and `/sessions/*`, which the governed iframe wrapper protects with an exact configured parent origin. Static hosts that only consume `_headers` fail closed and do not support cross-origin iframe channels.

Set backend `smartintake.public-app-base-url` to the public HTTPS frontend origin. Route `/v1` through that origin because the frontend CSP uses `connect-src 'self'`. Configure the TLS proxy to preserve the application CSP and to omit `X-Frame-Options` on respondent frontend routes and the validated backend `/embed` route.

## Implemented vertical slices

- Canonical `4.0.0` form definitions with stable field IDs, typed field metadata, conditional visibility, draft revision/ETag save, and immutable release records.
- Angular form catalog, visual editor, property panel, interactive respondent preview, required/conditional client validation, and response administration/export UI.
- PostgreSQL Flyway schema for catalog drafts, immutable releases, respondent sessions, immutable submission envelopes, and audit events.
- API capabilities, canonical draft save, publish, public session, revision-aware autosave, validation, submit receipt, response list/detail, and CSV export endpoints.

## Operational boundaries

The current local profile deliberately has no SMTP, object storage, malware scanner, external webhook, or production identity provider configured. Attachment provider URLs, email delivery, and event dispatch are therefore documented extension points rather than falsely successful integrations. For production, place these behind server-side adapters and configure CORS, TLS cookies, CSRF, database credentials, audit retention, and the complete tenant/workspace authorization persistence before exposing the service.

## Useful API smoke flow

```bash
curl -X POST http://localhost:8080/v1/workspaces/local/forms -H 'content-type: application/json' \
  -d '{"formKey":"demo-intake","title":"Demo intake"}'
curl http://localhost:8080/v1/workspaces/local/forms
```

## Design system provenance

Certinal UI v0.0.1 is authoritative under `assets/certinal/certinal-ui/` and byte-for-byte materialized as the local Angular library at `frontend/projects/certinal-ui/`. `src/styles.css` imports the byte-verified materialized token and typography files once; `src/index.html` loads the matching DM Sans and DM Mono font declaration. Run `npm run certinal:check` for provenance/API/mapping drift checks and `npm run certinal:build` to package `@certinal/ui` locally. The snapshot must be retained when moving this project.

### M5 routed shell

The Angular browser shell now uses lazy staff, authentication, and public routes.
`/catalog/builder` remains the M1 lifecycle compatibility route while M6 replaces
M5's typed stub session/guard authority with server-authoritative role, expiry,
and denial checks. Browser route evidence is denominator-bound in
`frontend/e2e/m5-route-corpus.json`; run `npm run m5:check` from `frontend`.
Automated axe output is browser evidence only and is not human accessibility acceptance.
