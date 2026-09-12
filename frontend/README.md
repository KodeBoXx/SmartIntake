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

Certinal UI v0.0.1 snapshot is vendored under `assets/certinal/certinal-ui/`; root UI `tokens.css` and `typography.css` are copied into `frontend/src/assets/certinal/styles/` and imported once by `src/styles.css`. See `frontend/src/assets/certinal/` for component and interaction references. The snapshot must be retained when moving this project.
