# Authentication and administration — Lite 1.1

Binding companion to the Lite 1.1 PRD, Sections 3, 4 and 11. This document defines required behavior; it does not claim that the existing implementation or its UI has completed it. All examples are contract descriptions, not active credentials.

## Identity and authorization

Use normal username/password staff accounts, administrator onboarding and no public self-registration. Staff authentication is independent of public respondent session authorization. The global account and tenant memberships are separate objects. Preserve one account's multiple organization memberships and explicit current workspace. Resolve resource ownership from stored state on every sensitive operation; never trust a tenant selector, posted role or hidden menu as authority.

The platform grant authorizes organization/account administration only. Organization owner/admin authorizes tenant membership and policy administration; workspace roles authorize form, publish, response read/export and other data operations. The role matrix in the PRD governs. Retain reviewer/translator and auditor roles even if they are not yet represented in the current code. Exporter includes response viewing needed to choose and inspect export contents, and export permission covers every form in the workspace. Full webhook payload configuration also requires that workspace export permission; a platform or organization administrative grant alone is insufficient.

An organization administrator may explicitly assign permitted workspace roles to themselves, with audit. Creating another account never changes the caller's current grants automatically. Administrator-set passwords mean administrators are trusted to establish access through provisioned accounts; do not describe this as technical protection from every administrator takeover. Tenant admin credential reset is refused for platform accounts and accounts with memberships in multiple tenants. A platform administrator or verified holder recovery handles those accounts. Tenant admins retain control of their own memberships only. This multi-tenant credential boundary is a new explicit Lite 1.1 default closing the gap in the one-tenant implementation.

## States and transitions

| Object | Required state and transition |
|---|---|
| Account activation | Awaiting setup → active after successful password selection. A temporary-password reset returns the account to awaiting setup. An invitation for an existing active account adds membership only and never resets its password. |
| Account status | Active or suspended independently of activation. Global suspension prevents staff authentication and invalidates sessions; activation cannot bypass it. |
| Tenant membership | Pending acceptance, active, suspended or removed. An unaccepted offer grants no workspace data access. Removal revokes all descendant workspace grants. |
| New organization | Awaiting owner activation → active once the initial owner activates; suspended prevents ordinary tenant operations. Platform setup/recovery remains separately authorized. |
| Invitation | Pending → accepted, expired or revoked. Resend replaces rather than extends the same secret. Delivery state is separate: not configured, queued, sent, failed. Sent means provider accepted delivery, not recipient acceptance. |
| Reset reference | Pending → consumed, expired or revoked. Reset and invite references are distinct purpose-bound secrets. |
| Staff session | Setup-only or normal; active → expired or revoked. A setup-only session has no tenant/data permissions. Sign-out is safe and idempotent. |

Activation, credential replacement, token invalidation, required session revocation and audit must commit atomically. Concurrent redemption yields one state change; retries cannot set a different password after consumption. Failed validation leaves the previous valid credential/setup path usable until its expiry. A password set through one path invalidates other outstanding credential setup/reset references. Membership-only invitations do not grant credential-reset authority.

Owner continuity is checked against active accounts and active memberships that have completed setup, under a serialized transaction. After initial activation, refuse any demotion, suspension, removal or reset that would leave no acting organization owner or platform administrator. Bootstrap/new-organization setup is the explicit pending-state exception, not a permanent loophole. A pending successor does not count as an acting owner. For a shared account, a platform-level suspension/reset must check owner continuity in every affected organization.

## Password, token and session behavior

The following are **Lite 1.1 implementation defaults**, chosen to make the handoff executable without more product decisions. They may be tightened through documented configuration. They are not all values already implemented in Software Factory.

| Setting | Default and observable behavior |
|---|---|
| Password policy | At least 15 characters, allow spaces and Unicode, no mandatory symbol/case recipe, permit paste/password managers. Support at least 64 characters. Never trim, normalize or silently truncate a password. Show constraints before setup and enforce the same policy at bootstrap/create/activation/change/reset. |
| Password storage | Use a maintained password-hashing library with unique salts and calibrated cost. No reversible password storage. If a library has an input-byte limit, do not silently truncate; choose an implementation supporting the advertised character policy. Existing BCrypt/12-character configuration is evidence of a current implementation choice, not an exemption from this contract. |
| Normal staff session | Opaque random server-managed reference; 12-hour absolute and 2-hour idle lifetime. Cookie HttpOnly, Secure outside an explicitly isolated localhost profile, SameSite and CSRF defenses appropriate to deployment. Issue a fresh session after authentication/activation; never accept a caller-chosen session identifier. |
| Setup-only session | Maximum 15 minutes, bound to the account and setup purpose. Only setup, non-sensitive session status and sign-out routes permitted. Expiry returns to sign-in/setup. |
| Temporary password | Expires 24 hours after issue/reset. After expiry an authorized administrator issues a replacement; an old temporary credential cannot regain access. Record setup reason as onboarding or recovery. |
| Staff invitation | Expires 72 hours after issue. Account/membership, tenant, intended recipient and purpose are fixed; offered roles cannot be expanded by the link payload. Current issuer authority, tenant state and offered grants are rechecked at acceptance. |
| Forgotten-password reference | Expires 30 minutes after issue; one successful redemption. Sending or requesting it does not suspend the account or change the password. |
| Abuse control | Default ten failed credential attempts produce a 15-minute account throttle, with independent source/global limits; bounded unknown-username handling and generic public failures prevent discovery or unbounded storage allocation. One account's failures must not lock unrelated users. |
| Revocation | Logout invalidates that session immediately. Password replacement and global suspension revoke all sessions. Membership/role removal denies affected operations on the next sensitive authorization check; no cache may extend access beyond five minutes. Reauthentication cannot recreate a removed grant. |

Generic failure and recovery responses should avoid disclosing whether an account exists. Password changes require the current credential; setup/reset requires the appropriate proof, and a completed reset should return to normal sign-in. These principles are supported by [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) and [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html). The numeric lifetimes and workflow choices above are this product's defaults.

CSRF protection includes authenticated cookie mutations and defenses against login CSRF; SameSite alone is not the entire solution. Browser origins are explicitly allowed. On shared-device logout/account switch, clear account-bound query caches, private detail views and unsent buffers so a later user cannot see earlier staff data. A tenant/workspace switch clears resource caches for that context; a request already in flight cannot render old-tenant data into the new workspace.

## Email-independent onboarding and recovery

Both onboarding paths must work with email delivery disabled. Temporary-password onboarding uses the administrator-supplied credential. Invitation onboarding returns the newly generated invitation URL to the authorized issuer for copying through the normal Add user journey. Email delivery is a configured adapter, and the full Lite product still includes and verifies it; deployment without email is a supported operating mode, not removal of the feature.

When email is configured, invitation and self-service recovery messages carry links to an allowlisted application origin. Do not construct links from an untrusted Host header or arbitrary client redirect. Link pages must avoid third-party resource leakage and remove secrets from browser history after they have been handled. Invalid/expired/revoked links present ordinary recovery actions without revealing another user's account or tenant. Issuing a link is not evidence it was delivered or accepted.

Without email, Forgot password explains how to contact an authorized administrator. For an account solely in that administrator's tenant, the administrator can set a fresh temporary password. Shared or platform accounts follow the boundary above. For the sole acting administrator, the operator recovery runbook restores credential control without leaving the platform without an acting administrator after recovery. Do not add security questions, an anonymous reset shortcut or respondent recovery credentials.

## Safe secret-delivery exceptions

The blanket “no tokens in any API response” wording in some Software Factory notes conflicts with session establishment and copyable invitation links. Resolve it explicitly:

- A password or password hash is never returned. Administrator-supplied temporary passwords are not echoed.
- The initial session cookie is a necessary credential delivery, not an ordinary JSON profile field.
- A newly issued invite/reset URL may be returned once to the currently authorized issuer when manual delivery is selected. Later list/detail/history endpoints return status only. Copy after loss creates/reissues a new link and revokes the old one.
- Secrets are absent from logs, audit, analytics, export files and support bundles. Store only suitable token verifiers; encrypted deployment backups remain governed by restricted disaster-recovery access and retention, not falsely described as containing no credential hashes.

These exceptions do not create API keys, server-to-server accounts, actor selection screens or respondent invitation access.

## Application API requirements

The canonical prefix for the new implementation is `/v1`. The inspected Software Factory code uses `/api`; that is an implementation mapping to document, not a second conflicting normative endpoint set. Complete OpenAPI schemas, authorization, errors and example responses must be delivered for these operations. Every mutation has an explicit replay/concurrency contract. Auth secrets are excluded from generic idempotency result caches.

| Canonical endpoint | Required behavior |
|---|---|
| `POST /v1/auth/sign-in` | Username/password; generic failure. Success sets a new normal or setup-only cookie and returns safe account/setup state, never a password/hash or bearer token in ordinary JSON. |
| `POST /v1/auth/sign-out` | Invalidates the session, expires the cookie; repeated sign-out succeeds safely. |
| `GET /v1/auth/session` | Authenticated safe identity, activation state and permitted organization/workspace choices. Unauthenticated is 401; setup-only reveals no private tenant/data details. |
| `POST /v1/auth/activate` | Setup proof and chosen new password. Consumes proof atomically, revokes setup/old sessions and directs to fresh normal sign-in. No ordinary operation may precede success. |
| `POST /v1/auth/password-change` | Normal authenticated session, current/new passwords; applies policy and revokes sessions atomically. |
| `POST /v1/auth/recovery` | Requests configured email recovery; generic acknowledgment whether the username exists. Without email, the UI offers administrator contact; no reset secret returned publicly. |
| `POST /v1/auth/reset` | Purpose-bound reset proof and new password; single-use, expiry checked atomically; directs to normal sign-in. |
| `POST /v1/invitations/accept` | New account establishes its password using invite proof; existing account authenticates and accepts offered membership. Body cannot modify offered roles or recipient. |
| `GET/POST /v1/platform/organizations` | Platform-only list/create, paginated; creation includes first-owner setup with atomic pending state. |
| `PATCH /v1/platform/organizations/{o}` | Platform-only organization metadata/status with ETag, reason and audit. |
| `POST /v1/platform/organizations/{o}/users` | Platform provisioning within named tenant; explicit roles and onboarding method. |
| `PATCH /v1/platform/accounts/{a}` | Platform grant/global status management with owner-safety checks; no implicit workspace data grant. |
| `GET/POST /v1/organizations/{o}/users` | Tenant-authorized safe user list/create-or-invite. Existing-account offers cannot overwrite global credentials or expose other tenant membership. |
| `PATCH/DELETE /v1/organizations/{o}/users/{u}` | Permitted membership metadata/status/organization-role update or removal; stored tenant binding, ETag, owner-safety checks and audit. |
| `PUT/DELETE /v1/workspaces/{w}/users/{u}/roles` | Explicit additive role set or grant removal inside the owning tenant; no per-form export grant. |
| `POST /v1/organizations/{o}/users/{u}/invitations` | Issue/resend invitation and optional email/manual delivery, current issuer authorization, old-link revocation. |
| `DELETE /v1/organizations/{o}/invitations/{i}` | Revoke pending invitation; accepted membership removal is a distinct audited operation. |
| `POST /v1/organizations/{o}/users/{u}/recovery` | Authorized no-email temporary-password reset for an account within the defined credential boundary. |
| `POST /v1/platform/accounts/{a}/recovery` | Platform-authorized credential recovery, with cross-organization owner-safety checks and audit. |

Platform/account operations have an account/platform authorization scope rather than a fictitious workspace ID. Tenant operations resolve the explicit tenant choice against current membership; posted organization IDs never expand authority. Normal membership create/update/delete operations use the PRD's ETag/idempotency conventions. Link issuance is retry-safe for one operation but must not persist a raw secret in the generic result store: return a redacted already-issued result after an uncertain issue and let an explicit reissue revoke/replace it. A token/password redemption retry after consumption never repeats credential replacement.

## Acceptance detail

**T27:** Fresh and existing staff login, generic invalid credentials, throttling, expiry/idle expiry, logout, CSRF, protected deep links, setup route guard, shared-device cache clearing and dev-header denial. Verify server refusal, not just hidden buttons.

**T28:** Empty database/bootstrap and concurrent bootstrap; first organization/pending owner activation; both email-disabled onboarding methods; configured email delivery; invite expiry/revoke/resend/concurrent accept; existing account joins a second tenant; roles stay separate; cross-tenant/forged-ID attempts; last-active-owner concurrency and dual platform/tenant roles.

**T29:** Current-password change, admin recovery without email, self-service email recovery with generic public outcome, token reuse/cross-purpose/expiry, all-session revocation, old-link invalidation, weak/oversize Unicode input without truncation, shared-account reset boundary and sole-admin recovery procedure. A tenant admin cannot use reset to gain another tenant's credentials.

**T30:** All named staff screens with real API calls, no-access state, inline validation, copy-link feedback, failed delivery, keyboard/RTL/mobile/zoom, deep-link return and independent workspace roles. No actor/code management surface. Record actual browser and provider evidence separately from API-only/source inspection.
