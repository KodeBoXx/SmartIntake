# Smart Form Builder Lite 1.1

A runnable Angular 20 + Tailwind 4 + Spring Boot + PostgreSQL implementation of Smart Form Builder Lite. The supplied handoff and Certinal UI snapshot are preserved under `docs/source-handoff/` and `assets/certinal/`.

## Run locally

```bash
docker compose up -d postgres
cd backend && mvn spring-boot:run
# another terminal
cd frontend && npm install && npm start
```

Open <http://localhost:4200>. API health: <http://localhost:8080/v1/health>.

## Implemented vertical slices

- Canonical `4.0.0` form definitions with stable field IDs, typed metadata, conditional visibility, ETag-protected draft saves, and immutable release records.
- Angular catalog, visual editor, property panel, interactive respondent preview, conditional required validation, and response/export UI.
- Flyway PostgreSQL schema for drafts, immutable releases, respondent sessions, immutable envelopes, and audit events.
- Capabilities, draft save, publish, public session, revision-aware autosave, validation, submit receipt, response list/detail, and CSV export endpoints.

## Operational boundaries

The local profile deliberately has no SMTP, object store, scanner, outbound webhook, or production identity provider configured. Attachment transfer, invitation delivery, recovery email, and event delivery are documented integration boundaries rather than claimed integrations. Production needs persisted tenant/workspace roles, secure session/CSRF middleware, adapter configuration, and full contract test coverage before internet exposure.

## Design system provenance

Certinal UI v0.0.1 is vendored under `assets/certinal/certinal-ui/`. Root UI `tokens.css` and `typography.css` are copied under `frontend/src/assets/certinal/styles/` and imported once in `src/styles.css`.
