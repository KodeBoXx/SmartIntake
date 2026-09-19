# SmartIntake materialization of `@certinal/ui`

This directory is a byte-for-byte materialization of
`assets/certinal/certinal-ui/library/ui` at version `0.0.1`.

`ng-package.workspace.json` is SmartIntake build wiring. It is intentionally
outside the authoritative snapshot file list: it supplies the local output
location and permits the workspace-owned `lucide-angular` runtime dependency.
`tsconfig.lib*.json` continue to use the repository-root `tsconfig.json` added
for this Angular 20 library workspace.

Run `npm run certinal:check` to verify source identity, version, materialized
file identity, generated API inventory, and the frozen interaction mapping.
Run `npm run certinal:build` to produce `dist/certinal/ui`.
