# Certinal library toolchain record

The authoritative snapshot identifies `@certinal/ui` as `0.0.1` and declares
Angular 20 peer ranges. SmartIntake materializes those bytes unchanged at
`frontend/projects/certinal-ui` and builds them with the following locked local
toolchain:

| Concern | Snapshot expectation | Workspace result | Handling |
| --- | --- | --- | --- |
| Angular peer API | `@angular/common` and `@angular/core` `^20.0.0` | Angular `20.3.31` from the existing frontend lockfile | Compatible Angular 20 peer resolution; no snapshot source edit. |
| Packager | Not supplied by the snapshot | `ng-packagr` `20.3.2` | Pinned frontend development dependency; the workspace wrapper selects partial compilation. |
| TypeScript Intl declarations | Snapshot `tsconfig.lib*.json` inherits a missing workspace config | TypeScript `5.8.3`, with `ES2021.Intl` supplied in `tsconfig.workspace.lib.prod.json` | Required for the snapshot's `Intl.DateTimeFormat` `dateStyle` use; source remains byte-identical. |
| Icons | Snapshot imports `lucide-angular` but does not declare it | `lucide-angular` `1.0.0` supplied by the consuming frontend | Required external runtime dependency. npm marks this legacy package deprecated in favour of `@lucide/angular`; it is retained because the authoritative source imports `lucide-angular`. |
| Node runtime | Repository `.nvmrc` | Node `22.21.0` in this environment | The build succeeds under this available Node 22 runtime. |

`ng-package.workspace.json` and `tsconfig.workspace.lib.prod.json` are
workspace-only wrappers, excluded from byte identity comparison. They do not
change the authoritative snapshot. The output package is generated under
`frontend/dist/certinal/ui` and is not source authority.
