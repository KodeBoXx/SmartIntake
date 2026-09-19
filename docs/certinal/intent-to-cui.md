# SmartIntake intent-to-Cui mapping

**Frozen for M5 library integration.** This is an independently reviewable,
implementation-neutral decision record. It derives component names from
`assets/certinal/certinal-ui/references/component-api.md` and containers from
`assets/certinal/certinal-ui/references/interaction-patterns.md` §6. The JSON
companion is validated by `tools/certinal/verify_intent_mapping.py` against the
generated component API.

M5 uses the mapping only for shell-level route stubs; it does not claim the
underlying workflow migrations. `m5-shell-stub` means actual Cui components
compose the M5 routed shell while data and workflow authority remain deferred.
`planned-later-milestone` means the complete migration remains unimplemented.
`preserved-not-migrated` means the current M1 UI remains deliberately untouched.

| ID | User intent | Required container | Cui API | M5 status |
| --- | --- | --- | --- | --- |
| staff-shell | Staff navigation and shared chrome | Route shell | `CuiAppShellComponent`, `CuiSidebarShellComponent`, `CuiHeaderComponent` | m5-shell-stub |
| form-registry | Browse staff forms and releases | Main page | `CuiDataTableComponent`, `CuiSearchBarComponent`, `CuiStatsStripComponent`, `CuiButtonComponent` | m5-shell-stub |
| form-detail | See a form/release in list context | Right drawer, `lg` | `CuiDrawerComponent`, `CuiBadgeComponent`, `CuiButtonComponent` | m5-shell-stub |
| form-create-edit | Create/edit a form definition | Route page | `CuiInputComponent`, `CuiSelectComponent`, `CuiAlertComponent`, `CuiButtonComponent` | planned-later-milestone |
| field-configure | Configure fields/rules/repeaters | Inline edit-page section | `CuiInputComponent`, `CuiSelectComponent`, `CuiAccordionComponent`, `CuiButtonComponent` | planned-later-milestone |
| release-publish | Publish a prepared release | Route-page action | `CuiButtonComponent`, `CuiAlertComponent`, `CuiToastService` | planned-later-milestone |
| form-delete | Archive/delete a draft | Danger confirm dialog | `CuiConfirmService`, `CuiConfirmDialogComponent` | planned-later-milestone |
| response-registry | Browse/filter/export responses | Main page | `CuiDataTableComponent`, `CuiSearchBarComponent`, `CuiSelectComponent`, `CuiButtonComponent` | m5-shell-stub |
| response-detail | See a response in list context | Right drawer, `lg` | `CuiDrawerComponent`, `CuiBadgeComponent`, `CuiButtonComponent` | m5-shell-stub |
| response-quick-action | Set one status/owner | Anchored dropdown/popover | `CuiDropdownComponent`, `CuiPopoverComponent` | m5-shell-stub |
| respondent-runtime | Complete a published form | Route page | `CuiStepperComponent`, `CuiInputComponent`, `CuiSelectComponent`, `CuiCheckboxComponent`, `CuiRadioComponent`, `CuiAlertComponent` | m5-shell-stub |
| validation-feedback | Explain validation near data | Inline alert | `CuiAlertComponent` | m5-shell-stub |
| post-action-feedback | Acknowledge completed action | Toast | `CuiToastService`, `CuiToastHostComponent` | m5-shell-stub |
| m1-current-ui | Keep existing M1 editor/preview/response admin stable | Frozen existing screen | — | preserved-not-migrated |

## Non-negotiable application rules for later shell work

- View details uses a deep-linkable right `CuiDrawerComponent` at `size="lg"`;
  edit and create navigate to their own pages.
- Destructive work uses `CuiConfirmService`/`CuiConfirmDialogComponent` with a
  danger tone; status/owner single-value changes use an anchored dropdown or
  popover.
- Validation stays inline via `CuiAlertComponent`; successful feedback is a
  `CuiToastService` string call (for example, `toast.success('Draft saved.')`).
- Registry metrics use `CuiStatsStripComponent`; `CuiMetricCardComponent` is
  reserved for dashboards.
- Form controls use `CuiInputComponent`, `CuiSelectComponent`, and the listed
  check/radio components instead of hand-built controls when the future route
  migration begins.
