#!/usr/bin/env python3
"""Generate the complete M2 OpenAPI 3.1 contract from frozen M0 inventories.

The inventory defines the denominator; this module supplies the published payload
semantics.  It intentionally does not infer a normative API from prototype routes.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
API = ROOT / "docs/api/openapi.yaml"
COMPONENTS = ROOT / "docs/contracts/smart-form-builder-lite/4.0.0/openapi-components.yaml"
NAMED = ROOT / "docs/acceptance/v1.1/denominators/o-named.json"
TOTAL = ROOT / "docs/acceptance/v1.1/denominators/o-total.json"
CONTRACT = ROOT / "docs/contracts/smart-form-builder-lite/4.0.0"
REF = "../contracts/smart-form-builder-lite/4.0.0/openapi-components.yaml#/components"
STAFF_SECURITY = [{"staffCookie": [], "csrfHeader": []}]
RESPONDENT_SECURITY = [{"respondentSession": []}]


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def ref(section: str, name: str) -> dict[str, str]:
    return {"$ref": f"{REF}/{section}/{name}"}


def closed(required: list[str], properties: dict[str, Any], description: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"type": "object", "additionalProperties": False, "required": required, "properties": properties}
    if description:
        result["description"] = description
    return result


def roles_and_scope(method: str, path: str) -> tuple[list[str], str, list[dict[str, list[str]]]]:
    if path == "/v1/capabilities" or path.startswith("/v1/schemas/"):
        return ["public.contract.read"], "public", []
    if path == "/v1/auth/session":
        return ["staff.session.self"], "account-session", STAFF_SECURITY
    if path.startswith("/v1/public/"):
        return ["public.share.start"], "share-bound", []
    if path.startswith("/v1/sessions/"):
        return ["respondent.session.self"], "respondent-session", RESPONDENT_SECURITY
    if path.startswith("/v1/platform/"):
        return ["platform.administrator"], "platform", STAFF_SECURITY
    if path.startswith("/v1/auth/") or path.startswith("/v1/invitations/"):
        if path in {"/v1/auth/sign-in", "/v1/auth/activate", "/v1/auth/recovery", "/v1/auth/reset", "/v1/invitations/accept"}:
            return ["credential-proof"], "purpose-bound", []
        return ["staff.session.self"], "account-session", STAFF_SECURITY
    if "/webhook" in path:
        return ["workspace.webhook.manage"], "workspace", STAFF_SECURITY
    if "/exports" in path or "/submissions" in path or "/attachments/" in path:
        return ["workspace.response.export"], "workspace", STAFF_SECURITY
    if "/policies" in path:
        return ["organization.policy.manage"], "organization", STAFF_SECURITY
    if "/organizations/" in path:
        return ["organization.administrator"], "organization", STAFF_SECURITY
    if "/users/" in path and "/workspaces/" in path:
        return ["workspace.members.manage"], "workspace", STAFF_SECURITY
    if "/imports" in path:
        return ["workspace.form.import"], "workspace", STAFF_SECURITY
    if "/releases" in path or "/activation" in path or "/review-requests" in path:
        return ["workspace.form.publish"], "workspace", STAFF_SECURITY
    return (["workspace.form.read"], "workspace", STAFF_SECURITY) if method == "GET" else (["workspace.form.write"], "workspace", STAFF_SECURITY)


def success_status(method: str, path: str) -> str:
    explicit = {
        "/v1/auth/sign-in": "200", "/v1/auth/sign-out": "204", "/v1/auth/activate": "204",
        "/v1/auth/password-change": "204", "/v1/auth/recovery": "202", "/v1/auth/reset": "204",
        "/v1/invitations/accept": "200", "/v1/workspaces/{w}/imports/validate": "200",
        "/v1/workspaces/{w}/forms/{f}/drafts/{d}/validate": "200",
        "/v1/workspaces/{w}/forms/{f}/drafts/{d}/review-requests": "202",
        "/v1/workspaces/{w}/forms/{f}/activation": "200", "/v1/sessions/{s}/attachments": "200",
        "/v1/sessions/{s}/attachments/{a}/complete": "200", "/v1/sessions/{s}/validate": "200",
        "/v1/sessions/{s}/submission-operation": "200", "/v1/workspaces/{w}/exports": "202",
        "/v1/workspaces/{w}/webhook-deliveries/{id}/replay": "202",
    }
    if path in explicit:
        return explicit[path]
    return "204" if method == "DELETE" else "201" if method == "POST" else "200"


def is_mutation(method: str) -> bool:
    return method not in {"GET", "HEAD", "OPTIONS"}


def needs_etag(method: str, path: str) -> bool:
    return method in {"PUT", "PATCH"} or path.endswith("/activation") or path.endswith("/commit")


def path_parameters(path: str) -> list[dict[str, Any]]:
    return [{"name": p[1:-1], "in": "path", "required": True,
             "description": "Opaque server-issued identifier; it is never an authority grant.",
             "schema": {"$ref": f"{REF}/schemas/OpaqueId"}, "example": f"{p[1:-1]}-01J2W5RFR3K24SFWDX2C0N9VW3"}
            for p in path.split("/") if p.startswith("{") and p.endswith("}")]


def resource_for(path: str) -> str:
    if path == "/v1/capabilities": return "CapabilityRegistry"
    if path.startswith("/v1/schemas/"): return "PublishedSchema"
    if path == "/v1/auth/session": return "AuthenticatedSession"
    if "/assets/" in path: return "AuthorizedAsset"
    if path == "/v1/organizations/{o}/users/{u}/recovery": return "OrganizationRecovery"
    if path == "/v1/platform/accounts/{a}/recovery": return "PlatformRecovery"
    if path.startswith("/v1/auth/"): return "StaffSession" if path.endswith("session") or path.endswith("sign-in") else "AccountAction"
    if path.startswith("/v1/invitations/") or "/invitations" in path: return "Invitation"
    if "/imports" in path: return "ImportCandidate"
    if "/drafts/" in path: return "Draft" if not path.endswith("validate") and not path.endswith("review-requests") else ("ValidationReport" if path.endswith("validate") else "ReviewRequest")
    if "/releases" in path: return "Release"
    if path.endswith("/activation"): return "Activation"
    if path.endswith("/export"): return "PackageExport"
    if path.startswith("/v1/public/"): return "RespondentSession"
    if path.startswith("/v1/sessions/"):
        if "/attachments" in path: return "Attachment"
        if path.endswith("/validate"): return "ValidationReport"
        if path.endswith("/submissions"): return "Receipt"
        if path.endswith("submission-operation"): return "SubmissionOperation"
        return "RespondentSession"
    if "/submissions" in path: return "Interpretation" if path.endswith("interpretation") else "Submission"
    if "/exports" in path: return "ExportJob"
    if "/attachments/" in path: return "BinaryAttachment"
    if "/webhook-deliveries" in path: return "WebhookDelivery"
    if "/webhooks" in path: return "Webhook"
    if "/share-channels" in path: return "ShareChannel"
    if "/locale-bundles" in path: return "LocaleBundle"
    if "/folders" in path: return "Folder"
    if "/tags" in path: return "Tag"
    if "/blocks" in path: return "Block"
    if "/themes" in path: return "Theme"
    if "/policies" in path: return "Policy"
    if "/accounts" in path: return "PlatformAccount"
    if "/organizations" in path: return "Organization" if "/users" not in path else "OrganizationUser"
    if "/users" in path: return "WorkspaceRole"
    return "Form"


def collection_response(path: str, method: str) -> bool:
    return method == "GET" and path.rstrip("/").split("/")[-1] in {"forms", "submissions", "folders", "tags", "blocks", "themes", "locale-bundles", "share-channels", "policies", "organizations", "users", "webhook-deliveries"}


def request_definition(method: str, path: str) -> tuple[str, dict[str, Any], dict[str, Any], dict[str, Any]] | None:
    """Concrete family request schemas and paired examples. DELETE is explicit no-content."""
    if method == "DELETE":
        return None
    special: dict[tuple[str, str], tuple[str, list[str], dict[str, Any], dict[str, Any]]] = {
        ("POST", "/v1/auth/sign-in"): ("SignInRequest", ["email", "password"], {"email": {"type": "string", "format": "email"}, "password": {"type": "string", "minLength": 12, "maxLength": 512}}, {"email": "author@example.test", "password": "correct-horse-battery-staple"}),
        ("POST", "/v1/auth/activate"): ("AccountActivationRequest", ["activationToken", "password", "displayName"], {"activationToken": {"type": "string", "minLength": 24}, "password": {"type": "string", "minLength": 12}, "displayName": {"type": "string", "minLength": 1, "maxLength": 120}}, {"activationToken": "activate-01J2W5RFR3K24SFWDX2C0N9VW3", "password": "correct-horse-battery-staple", "displayName": "A. Author"}),
        ("POST", "/v1/auth/password-change"): ("PasswordChangeRequest", ["currentPassword", "newPassword"], {"currentPassword": {"type": "string", "minLength": 1}, "newPassword": {"type": "string", "minLength": 12}}, {"currentPassword": "correct-horse-battery-staple", "newPassword": "new-correct-horse-battery"}),
        ("POST", "/v1/auth/recovery"): ("RecoveryRequest", ["email"], {"email": {"type": "string", "format": "email"}}, {"email": "author@example.test"}),
        ("POST", "/v1/organizations/{o}/users/{u}/recovery"): ("OrganizationRecoveryRequest", ["reason", "safeDelivery"], {"reason": {"type": "string", "minLength": 1, "maxLength": 500}, "safeDelivery": {"enum": ["verified-email", "administrator-assisted"]}, "revokeExistingSessions": {"type": "boolean"}, "ownerSafetyConfirmed": {"const": True}, "idempotencyReplay": {"enum": ["redacted"]}}, {"reason": "Account recovery requested by verified owner.", "safeDelivery": "verified-email", "revokeExistingSessions": True, "ownerSafetyConfirmed": True, "idempotencyReplay": "redacted"}),
        ("POST", "/v1/platform/accounts/{a}/recovery"): ("PlatformRecoveryRequest", ["reason", "safeDelivery", "ownerSafetyConfirmed"], {"reason": {"type": "string", "minLength": 1, "maxLength": 500}, "safeDelivery": {"enum": ["verified-email", "manual-security-review"]}, "revokeExistingSessions": {"type": "boolean"}, "ownerSafetyConfirmed": {"const": True}, "idempotencyReplay": {"enum": ["redacted"]}}, {"reason": "Platform account recovery requires security review.", "safeDelivery": "manual-security-review", "revokeExistingSessions": True, "ownerSafetyConfirmed": True, "idempotencyReplay": "redacted"}),
        ("POST", "/v1/auth/reset"): ("PasswordResetRequest", ["resetToken", "newPassword"], {"resetToken": {"type": "string", "minLength": 24}, "newPassword": {"type": "string", "minLength": 12}}, {"resetToken": "reset-01J2W5RFR3K24SFWDX2C0N9VW3", "newPassword": "new-correct-horse-battery"}),
        ("POST", "/v1/invitations/accept"): ("InvitationAcceptanceRequest", ["invitationToken", "password"], {"invitationToken": {"type": "string", "minLength": 24}, "password": {"type": "string", "minLength": 12}}, {"invitationToken": "invite-01J2W5RFR3K24SFWDX2C0N9VW3", "password": "correct-horse-battery-staple"}),
        ("POST", "/v1/workspaces/{w}/imports/validate"): ("ImportValidationRequest", ["mode", "package"], {"mode": {"enum": ["create", "update"]}, "package": {"$ref": "./package.schema.json"}}, {"mode": "create", "package": load(CONTRACT / "fixtures/package.positive.json")}),
        ("POST", "/v1/workspaces/{w}/imports/{candidateId}/commit"): ("ImportCommitRequest", ["candidateDigest"], {"candidateDigest": {"$ref": "#/components/schemas/Sha256"}, "expectedDraftRevision": {"type": "integer", "minimum": 0}}, {"candidateDigest": "0" * 64, "expectedDraftRevision": 7}),
        ("PUT", "/v1/workspaces/{w}/forms/{f}/drafts/{d}"): ("DraftSaveRequest", ["package"], {"package": {"$ref": "./package.schema.json"}, "editNote": {"type": "string", "maxLength": 2000}}, {"package": load(CONTRACT / "fixtures/package.positive.json"), "editNote": "Clarify consent wording."}),
        ("POST", "/v1/workspaces/{w}/forms/{f}/releases"): ("ReleaseCreateRequest", ["draftId", "draftRevision", "packageHash"], {"draftId": {"$ref": "#/components/schemas/OpaqueId"}, "draftRevision": {"type": "integer", "minimum": 0}, "packageHash": {"$ref": "#/components/schemas/Sha256"}}, {"draftId": "draft-01J2W5RFR3K24SFWDX2C0N9VW3", "draftRevision": 7, "packageHash": "0" * 64}),
        ("POST", "/v1/workspaces/{w}/forms/{f}/activation"): ("ActivationRequest", ["releaseId", "shareChannelIds"], {"releaseId": {"$ref": "#/components/schemas/OpaqueId"}, "shareChannelIds": {"type": "array", "minItems": 1, "items": {"$ref": "#/components/schemas/OpaqueId"}}}, {"releaseId": "release-01J2W5RFR3K24SFWDX2C0N9VW3", "shareChannelIds": ["share-01J2W5RFR3K24SFWDX2C0N9VW3"]}),
        ("POST", "/v1/public/forms/{shareId}/sessions"): ("SessionStartRequest", ["locale", "timeZone"], {"locale": {"type": "string", "pattern": "^[a-z]{2,3}(-[A-Z]{2})?$"}, "timeZone": {"type": "string", "minLength": 1}}, {"locale": "en-US", "timeZone": "America/Toronto"}),
        ("PATCH", "/v1/sessions/{s}"): ("SessionMutationRequest", ["baseRevision", "clientMutationId", "operations"], {"baseRevision": {"type": "integer", "minimum": 0}, "clientMutationId": {"$ref": "#/components/schemas/OpaqueId"}, "operations": {"type": "array", "minItems": 1, "items": {"$ref": "#/components/schemas/SessionMutation"}}, "currentPageId": {"type": "string"}}, {"baseRevision": 7, "clientMutationId": "mutation-01J2W5RFR3K24SFWDX2C0N9VW3", "operations": [{"op": "set", "fieldId": "contact.age", "value": "9007199254740993"}]}),
        ("POST", "/v1/sessions/{s}/attachments"): ("AttachmentCreateRequest", ["fileName", "mediaType", "sizeBytes", "sha256"], {"fileName": {"type": "string", "minLength": 1, "maxLength": 255}, "mediaType": {"type": "string", "pattern": "^[^/ ]+/[^/ ]+$"}, "sizeBytes": {"type": "integer", "minimum": 1}, "sha256": {"$ref": "#/components/schemas/Sha256"}}, {"fileName": "consent.pdf", "mediaType": "application/pdf", "sizeBytes": 1024, "sha256": "0" * 64}),
        ("POST", "/v1/sessions/{s}/attachments/{a}/complete"): ("AttachmentCompleteRequest", ["uploadToken", "sha256"], {"uploadToken": {"type": "string", "minLength": 24}, "sha256": {"$ref": "#/components/schemas/Sha256"}}, {"uploadToken": "upload-01J2W5RFR3K24SFWDX2C0N9VW3", "sha256": "0" * 64}),
        ("POST", "/v1/sessions/{s}/submissions"): ("SubmissionCreateRequest", ["sessionRevision", "reviewDigest", "acknowledgments", "attemptId"], {"sessionRevision": {"type": "integer", "minimum": 0}, "reviewDigest": {"$ref": "#/components/schemas/Sha256"}, "acknowledgments": {"type": "array", "items": {"$ref": "#/components/schemas/Acknowledgment"}}, "attemptId": {"$ref": "#/components/schemas/OpaqueId"}}, {"sessionRevision": 7, "reviewDigest": "0" * 64, "acknowledgments": [{"fieldId": "consent", "accepted": True}], "attemptId": "attempt-01J2W5RFR3K24SFWDX2C0N9VW3"}),
        ("POST", "/v1/workspaces/{w}/exports"): ("ExportCreateRequest", ["formId", "format", "filter", "columns"], {"formId": {"$ref": "#/components/schemas/OpaqueId"}, "format": {"enum": ["json", "relational-csv"]}, "filter": {"$ref": "#/components/schemas/SubmissionFilter"}, "columns": {"type": "array", "minItems": 1, "items": {"type": "string", "minLength": 1}}}, {"formId": "form-01J2W5RFR3K24SFWDX2C0N9VW3", "format": "json", "filter": {"status": ["submitted"]}, "columns": ["submissionId", "submittedAt", "answers"]}),
    }
    key = (method, path)
    if key in special:
        name, required, props, valid = special[key]
        return name, closed(required, props), valid, {}
    resource = resource_for(path)
    if path.endswith("/validate"):
        name, required, props, valid = "ValidationRunRequest", ["validationProfile"], {"validationProfile": {"enum": ["draft", "submission"]}}, {"validationProfile": "draft"}
    elif path.endswith("/review-requests"):
        name, required, props, valid = "ReviewRequestCreateRequest", ["reviewerIds", "message"], {"reviewerIds": {"type": "array", "minItems": 1, "items": {"$ref": "#/components/schemas/OpaqueId"}}, "message": {"type": "string", "minLength": 1, "maxLength": 2000}}, {"reviewerIds": ["user-01J2W5RFR3K24SFWDX2C0N9VW3"], "message": "Please review the release candidate."}
    elif path.endswith("/replay"):
        name, required, props, valid = "WebhookReplayRequest", ["reason"], {"reason": {"type": "string", "minLength": 1, "maxLength": 500}}, {"reason": "Receiver recovered."}
    elif path.endswith("/roles"):
        name, required, props, valid = "WorkspaceRoleAssignmentRequest", ["roles"], {"roles": {"type": "array", "minItems": 1, "items": {"enum": ["owner", "editor", "reviewer", "analyst"]}}}, {"roles": ["editor"]}
    else:
        verb = "Create" if method == "POST" else "Update"
        name = f"{resource}{verb}Request"
        properties = resource_write_properties(resource)
        required = [next(iter(properties))] if properties else []
        props = properties
        valid = {required[0]: example_for_property(required[0], props[required[0]])} if required else {}
    return name, closed(required, props), valid, {}


def example_for_property(name: str, schema: dict[str, Any]) -> Any:
    if name in {"name", "title", "label", "displayName"}: return "Example resource"
    if name == "email": return "author@example.test"
    if name == "url": return "https://receiver.example.test/hooks/submission"
    if name == "locale": return "en-US"
    if name == "roles": return ["editor"]
    if name == "events": return ["submission.created"]
    if name == "color": return "#164194"
    if name == "policyType": return "retention"
    if name == "blockType": return "markdown"
    if name == "formKey": return "example-form"
    if name == "accountStatus": return "active"
    if "enum" in schema: return schema["enum"][0]
    return "Example value"


def resource_write_properties(resource: str) -> dict[str, Any]:
    specific = {
        "Form": {"formKey": {"type": "string", "pattern": "^[a-z][a-z0-9-]{2,80}$"}, "title": {"type": "string", "minLength": 1, "maxLength": 200}},
        "Folder": {"name": {"type": "string", "minLength": 1, "maxLength": 120}, "parentId": {"anyOf": [{"$ref": "#/components/schemas/OpaqueId"}, {"type": "null"}]}},
        "Tag": {"label": {"type": "string", "minLength": 1, "maxLength": 80}, "color": {"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$"}},
        "Block": {"blockType": {"enum": ["markdown", "richText", "notice"]}, "content": closed(["text"], {"text": {"type": "string", "minLength": 1}})},
        "Theme": {"name": {"type": "string", "minLength": 1}, "tokens": closed(["primaryColor"], {"primaryColor": {"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$"}})},
        "LocaleBundle": {"locale": {"type": "string", "pattern": "^[a-z]{2,3}(-[A-Z]{2})?$"}, "messages": {"type": "object", "minProperties": 1, "additionalProperties": {"type": "string"}}},
        "ShareChannel": {"channelType": {"enum": ["link", "email", "embed"]}, "name": {"type": "string", "minLength": 1}},
        "Policy": {"policyType": {"enum": ["retention", "consent", "access"]}, "effect": {"enum": ["allow", "deny"]}},
        "Webhook": {"url": {"type": "string", "format": "uri"}, "events": {"type": "array", "minItems": 1, "items": {"enum": ["submission.created", "attachment.scanned"]}}},
        "Organization": {"name": {"type": "string", "minLength": 1, "maxLength": 160}},
        "OrganizationUser": {"email": {"type": "string", "format": "email"}, "roles": {"type": "array", "minItems": 1, "items": {"enum": ["administrator", "member"]}}},
        "PlatformAccount": {"accountStatus": {"enum": ["active", "suspended"]}},
    }
    return specific.get(resource, {"name": {"type": "string", "minLength": 1, "maxLength": 160}})


def response_model(resource: str, is_collection: bool) -> str:
    return f"{resource}{'Collection' if is_collection else 'Response'}"


def resource_example(resource: str) -> dict[str, Any]:
    now = "2026-09-18T00:00:00Z"
    if resource == "AuthorizedAsset":
        return {"id": "authorizedasset-01J2W5RFR3K24SFWDX2C0N9VW3", "downloadUrl": "https://transfer.example.test/assets/asset-01J2W5RFR3K24SFWDX2C0N9VW3?capability=redacted", "expiresAt": "2026-09-18T00:05:00Z", "contentType": "application/pdf"}
    if resource == "AuthenticatedSession":
        return {
            "safeIdentity": {"accountId": "account-01J2W5RFR3K24SFWDX2C0N9VW3", "username": "author@example.test", "displayName": "A. Author"},
            "activationState": "active",
            "accountStatus": "active",
            "organizations": [{
                "organizationId": "organization-01J2W5RFR3K24SFWDX2C0N9VW3",
                "name": "Example organization",
                "membershipState": "active",
                "workspaces": [{"workspaceId": "workspace-01J2W5RFR3K24SFWDX2C0N9VW3", "name": "Research", "roles": ["author"]}],
            }],
            "currentOrganizationId": "organization-01J2W5RFR3K24SFWDX2C0N9VW3",
        }
    value: dict[str, Any] = {"id": f"{resource.lower()}-01J2W5RFR3K24SFWDX2C0N9VW3", "kind": resource, "revision": 7, "status": "active", "createdAt": now, "updatedAt": now}
    extras: dict[str, dict[str, Any]] = {
        "Form": {"formKey": "example-form", "title": "Example form"}, "Draft": {"formId": "form-01J2W5RFR3K24SFWDX2C0N9VW3", "packageHash": "0" * 64},
        "Release": {"formId": "form-01J2W5RFR3K24SFWDX2C0N9VW3", "packageHash": "0" * 64, "definitionVersion": "4.0.0"},
        "RespondentSession": {"releaseId": "release-01J2W5RFR3K24SFWDX2C0N9VW3", "expiresAt": "2026-09-19T00:00:00Z", "sessionRevision": 7},
        "Submission": {"formId": "form-01J2W5RFR3K24SFWDX2C0N9VW3", "sessionId": "session-01J2W5RFR3K24SFWDX2C0N9VW3", "submittedAt": now},
        "Receipt": {"receiptCode": "receipt-01J2W5RFR3K24SFWDX2C0N9VW3", "submittedAt": now},
        "Attachment": {"fileName": "consent.pdf", "mediaType": "application/pdf", "sizeBytes": 1024, "sha256": "0" * 64},
        "ExportJob": {"format": "json", "state": "queued"}, "Webhook": {"url": "https://receiver.example.test/hooks/submission", "events": ["submission.created"]},
        "WebhookDelivery": {"webhookId": "webhook-01J2W5RFR3K24SFWDX2C0N9VW3", "attempt": 1}, "Folder": {"name": "Studies"}, "Tag": {"label": "priority", "color": "#164194"},
        "Block": {"blockType": "markdown"}, "Theme": {"name": "Default"}, "LocaleBundle": {"locale": "en-US"}, "ShareChannel": {"channelType": "link", "name": "Public link"},
        "Policy": {"policyType": "retention", "effect": "allow"}, "Organization": {"name": "Example organization"}, "OrganizationUser": {"email": "author@example.test", "roles": ["administrator"]},
        "PlatformAccount": {"accountStatus": "active"}, "WorkspaceRole": {"roles": ["editor"]}, "Invitation": {"email": "author@example.test", "expiresAt": "2026-09-19T00:00:00Z"},
        "OrganizationRecovery": {"safeDelivery": "verified-email", "revocation": "sessions-revoked", "ownerSafety": "confirmed", "idempotencyReplay": "redacted"},
        "PlatformRecovery": {"safeDelivery": "manual-security-review", "revocation": "sessions-revoked", "ownerSafety": "confirmed", "idempotencyReplay": "redacted"},
        "ImportCandidate": {"candidateDigest": "0" * 64, "expiresAt": "2026-09-19T00:00:00Z"}, "ValidationReport": {"valid": True, "diagnostics": []},
        "ReviewRequest": {"reviewerIds": ["user-01J2W5RFR3K24SFWDX2C0N9VW3"]}, "Activation": {"releaseId": "release-01J2W5RFR3K24SFWDX2C0N9VW3"},
        "PackageExport": {"package": load(CONTRACT / "fixtures/package.positive.json")}, "SubmissionOperation": {"submissionId": "submission-01J2W5RFR3K24SFWDX2C0N9VW3", "state": "not-submitted"},
        "Interpretation": {"submissionId": "submission-01J2W5RFR3K24SFWDX2C0N9VW3", "score": "12.5"}, "AccountAction": {"action": "recovery-requested"}, "StaffSession": {"userId": "user-01J2W5RFR3K24SFWDX2C0N9VW3", "expiresAt": "2026-09-19T00:00:00Z", "csrfToken": "csrf-01J2W5RFR3K24SFWDX2C0N9VW3"},
    }
    value.update(extras.get(resource, {}))
    return value


def resource_schemas() -> dict[str, Any]:
    base = {"id": {"$ref": "#/components/schemas/OpaqueId"}, "kind": {"type": "string"}, "revision": {"type": "integer", "minimum": 0}, "status": {"type": "string"}, "createdAt": {"type": "string", "format": "date-time"}, "updatedAt": {"type": "string", "format": "date-time"}}
    extras: dict[str, dict[str, Any]] = {
        "Form": {"formKey": {"type": "string"}, "title": {"type": "string"}}, "Draft": {"formId": {"$ref": "#/components/schemas/OpaqueId"}, "packageHash": {"$ref": "#/components/schemas/Sha256"}},
        "Release": {"formId": {"$ref": "#/components/schemas/OpaqueId"}, "packageHash": {"$ref": "#/components/schemas/Sha256"}, "definitionVersion": {"type": "string"}},
        "RespondentSession": {"releaseId": {"$ref": "#/components/schemas/OpaqueId"}, "expiresAt": {"type": "string", "format": "date-time"}, "sessionRevision": {"type": "integer", "minimum": 0}},
        "Submission": {"formId": {"$ref": "#/components/schemas/OpaqueId"}, "sessionId": {"$ref": "#/components/schemas/OpaqueId"}, "submittedAt": {"type": "string", "format": "date-time"}},
        "Receipt": {"receiptCode": {"$ref": "#/components/schemas/OpaqueId"}, "submittedAt": {"type": "string", "format": "date-time"}}, "Attachment": {"fileName": {"type": "string"}, "mediaType": {"type": "string"}, "sizeBytes": {"type": "integer"}, "sha256": {"$ref": "#/components/schemas/Sha256"}},
        "ExportJob": {"format": {"enum": ["json", "relational-csv"]}, "state": {"enum": ["queued", "running", "completed", "failed"]}}, "Webhook": {"url": {"type": "string", "format": "uri"}, "events": {"type": "array", "items": {"type": "string"}}},
        "WebhookDelivery": {"webhookId": {"$ref": "#/components/schemas/OpaqueId"}, "attempt": {"type": "integer", "minimum": 1}}, "Folder": {"name": {"type": "string"}}, "Tag": {"label": {"type": "string"}, "color": {"type": "string"}}, "Block": {"blockType": {"type": "string"}}, "Theme": {"name": {"type": "string"}}, "LocaleBundle": {"locale": {"type": "string"}}, "ShareChannel": {"channelType": {"type": "string"}, "name": {"type": "string"}}, "Policy": {"policyType": {"type": "string"}, "effect": {"type": "string"}},
        "Organization": {"name": {"type": "string"}}, "OrganizationUser": {"email": {"type": "string", "format": "email"}, "roles": {"type": "array", "items": {"type": "string"}}}, "PlatformAccount": {"accountStatus": {"type": "string"}}, "WorkspaceRole": {"roles": {"type": "array", "items": {"type": "string"}}}, "Invitation": {"email": {"type": "string", "format": "email"}, "expiresAt": {"type": "string", "format": "date-time"}}, "ImportCandidate": {"candidateDigest": {"$ref": "#/components/schemas/Sha256"}, "expiresAt": {"type": "string", "format": "date-time"}}, "ValidationReport": {"valid": {"type": "boolean"}, "diagnostics": {"type": "array", "items": {"$ref": "#/components/schemas/Diagnostic"}}}, "ReviewRequest": {"reviewerIds": {"type": "array", "items": {"$ref": "#/components/schemas/OpaqueId"}}}, "Activation": {"releaseId": {"$ref": "#/components/schemas/OpaqueId"}}, "PackageExport": {"package": {"$ref": "./package.schema.json"}}, "SubmissionOperation": {"submissionId": {"$ref": "#/components/schemas/OpaqueId"}, "state": {"enum": ["not-submitted", "submitted"]}}, "Interpretation": {"submissionId": {"$ref": "#/components/schemas/OpaqueId"}, "score": {"$ref": "#/components/schemas/CanonicalDecimal"}}, "AccountAction": {"action": {"type": "string"}}, "StaffSession": {"userId": {"$ref": "#/components/schemas/OpaqueId"}, "expiresAt": {"type": "string", "format": "date-time"}, "csrfToken": {"type": "string", "minLength": 8}},
    }
    extras.update({
        "OrganizationRecovery": {"safeDelivery": {"enum": ["verified-email", "administrator-assisted"]}, "revocation": {"const": "sessions-revoked"}, "ownerSafety": {"const": "confirmed"}, "idempotencyReplay": {"const": "redacted"}},
        "PlatformRecovery": {"safeDelivery": {"enum": ["verified-email", "manual-security-review"]}, "revocation": {"const": "sessions-revoked"}, "ownerSafety": {"const": "confirmed"}, "idempotencyReplay": {"const": "redacted"}},
    })
    safe_identity = closed(
        ["accountId", "username", "displayName"],
        {"accountId": {"$ref": "#/components/schemas/OpaqueId"}, "username": {"type": "string", "minLength": 1, "maxLength": 320}, "displayName": {"type": "string", "minLength": 1, "maxLength": 120}},
        "Safe staff identity; it excludes passwords, hashes, bearer credentials and session secrets.",
    )
    workspace_choice = closed(
        ["workspaceId", "name", "roles"],
        {"workspaceId": {"$ref": "#/components/schemas/OpaqueId"}, "name": {"type": "string", "minLength": 1, "maxLength": 160}, "roles": {"type": "array", "minItems": 1, "items": {"enum": ["administrator", "author", "reviewer", "translator", "publisher", "response-viewer", "response-exporter", "auditor"]}}},
    )
    organization_choice = closed(
        ["organizationId", "name", "membershipState", "workspaces"],
        {"organizationId": {"$ref": "#/components/schemas/OpaqueId"}, "name": {"type": "string", "minLength": 1, "maxLength": 160}, "membershipState": {"const": "active"}, "workspaces": {"type": "array", "items": {"$ref": "#/components/schemas/PermittedWorkspaceChoice"}}},
    )
    authenticated_session = closed(
        ["safeIdentity", "activationState", "accountStatus", "organizations", "currentOrganizationId"],
        {"safeIdentity": {"$ref": "#/components/schemas/SafeAccountIdentity"}, "activationState": {"enum": ["awaiting-setup", "active"]}, "accountStatus": {"const": "active"}, "organizations": {"type": "array", "items": {"$ref": "#/components/schemas/PermittedOrganizationChoice"}}, "currentOrganizationId": {"anyOf": [{"$ref": "#/components/schemas/OpaqueId"}, {"type": "null"}]}},
        "Authenticated safe identity, activation state and server-authorized organization/workspace choices.",
    )
    authenticated_session["if"] = {"properties": {"activationState": {"const": "awaiting-setup"}}, "required": ["activationState"]}
    authenticated_session["then"] = {"properties": {"organizations": {"maxItems": 0}, "currentOrganizationId": {"type": "null"}}}
    result: dict[str, Any] = {
        "SafeAccountIdentity": safe_identity,
        "PermittedWorkspaceChoice": workspace_choice,
        "PermittedOrganizationChoice": organization_choice,
        "AuthenticatedSession": authenticated_session,
    }
    for name, extra in extras.items():
        props = dict(base); props["kind"] = {"const": name}; props.update(extra)
        result[name] = closed(["id", "kind", "revision", "status", "createdAt", "updatedAt", *extra.keys()], props, f"Concrete {name} resource representation.")
    return result


def build_components(members: list[dict[str, Any]]) -> dict[str, Any]:
    schemas: dict[str, Any] = {
        "OpaqueId": {"type": "string", "minLength": 8, "maxLength": 200, "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"},
        "Sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
        "CanonicalInt64": {"type": "string", "pattern": "^(0|-[1-9][0-9]*|[1-9][0-9]*)$", "format": "canonical-int64", "description": "Canonical signed int64 base-10 string; JSON number is forbidden."},
        "CanonicalDecimal": {"type": "string", "pattern": "^(?:0|-?[1-9][0-9]*|-?(?:0|[1-9][0-9]*)\\.[0-9]*[1-9])$", "format": "canonical-decimal", "description": "Canonical expression-result decimal string with no redundant fractional zeroes; JSON number is forbidden."},
        "Diagnostic": closed(["pointer", "messageKey", "severity", "parameters"], {"fieldId": {"type": "string"}, "instanceId": {"type": "string"}, "rowPath": {"type": "array", "items": closed(["itemId"], {"itemId": {"$ref": "#/components/schemas/OpaqueId"}, "parentItemId": {"$ref": "#/components/schemas/OpaqueId"}})}, "pointer": {"type": "string", "pattern": "^/"}, "messageKey": {"type": "string"}, "severity": {"enum": ["error", "warning"]}, "parameters": {"type": "object", "additionalProperties": {"type": ["string", "number", "boolean"]}}}),
        "Problem": closed(["type", "title", "status", "code", "detail", "requestId", "errors"], {"type": {"type": "string", "format": "uri-reference"}, "title": {"type": "string"}, "status": {"type": "integer", "minimum": 400, "maximum": 599}, "code": {"type": "string", "pattern": "^[A-Z0-9_]+$"}, "detail": {"type": "string"}, "requestId": {"$ref": "#/components/schemas/OpaqueId"}, "errors": {"type": "array", "items": {"$ref": "#/components/schemas/Diagnostic"}}}),
        "Acknowledgment": closed(["fieldId", "accepted"], {"fieldId": {"type": "string", "minLength": 1}, "accepted": {"const": True}}),
        "SessionMutation": {"oneOf": [
            closed(["op", "fieldId", "value"], {"op": {"const": "set"}, "fieldId": {"type": "string"}, "value": {"anyOf": [{"$ref": "./input-answer.schema.json"}, {"$ref": "#/components/schemas/CanonicalInt64"}, {"$ref": "#/components/schemas/CanonicalDecimal"}]}}),
            closed(["op", "fieldId"], {"op": {"const": "clear"}, "fieldId": {"type": "string"}}),
            closed(["op", "fieldId", "itemId"], {"op": {"enum": ["addItem", "removeItem"]}, "fieldId": {"type": "string"}, "itemId": {"$ref": "#/components/schemas/OpaqueId"}}),
        ]},
        "SubmissionFilter": closed(["status"], {"status": {"type": "array", "minItems": 1, "items": {"enum": ["submitted", "voided"]}}, "from": {"type": "string", "format": "date-time"}, "to": {"type": "string", "format": "date-time"}}),
        "PublishedSchema": {"type": "object", "additionalProperties": True, "required": ["$schema", "$id"], "properties": {"$schema": {"const": "https://json-schema.org/draft/2020-12/schema"}, "$id": {"type": "string", "format": "uri"}}, "description": "A complete Draft 2020-12 schema document. Keywords, $defs, recursive references and extension annotations are intentionally preserved."},
        "CapabilityRegistry": closed(["registryVersion", "contractVersion", "versions", "schemas", "fieldCatalog", "controlValueCompatibility", "operatorSignatures", "limits", "operations", "assetSupplement", "openapi", "generation"], {"registryVersion": {"type": "string"}, "contractVersion": {"const": "4.0.0"}, "versions": {"type": "object", "required": ["contract", "openapi", "schemaDialect", "java", "typescript"], "additionalProperties": {"type": "string"}}, "schemas": {"type": "array", "minItems": 7, "items": closed(["kind", "version", "id", "sha256", "file", "resource"], {"kind": {"type": "string"}, "version": {"const": "4.0.0"}, "id": {"type": "string"}, "sha256": {"$ref": "#/components/schemas/Sha256"}, "file": {"type": "string"}, "resource": {"type": "string"}})}, "fieldCatalog": {"type": "array", "minItems": 17, "items": closed(["row", "controls", "canonicalTypes"], {"row": {"type": "integer", "minimum": 1}, "controls": {"type": "array", "minItems": 1, "items": {"type": "string"}}, "canonicalTypes": {"type": "array", "items": {"type": "string"}}})}, "controlValueCompatibility": {"type": "object", "minProperties": 17, "additionalProperties": {"type": "array", "minItems": 1, "items": {"type": "string"}}}, "operatorSignatures": {"type": "array", "minItems": 34, "items": {"type": "object"}}, "limits": {"type": "array", "minItems": 11, "items": {"type": "object"}}, "operations": closed(["count", "items", "statusPolicy"], {"count": {"const": 82}, "items": {"type": "array", "minItems": 82, "items": {"type": "object"}}, "statusPolicy": {"type": "string"}}), "assetSupplement": closed(["counted", "id", "implementationStatus", "reason"], {"counted": {"const": False}, "id": {"const": "M2-get-v1-workspaces-w-assets-assetid-authorized-asset"}, "implementationStatus": {"const": "planned"}, "reason": {"type": "string"}}), "openapi": closed(["file", "resource", "sha256", "version"], {"file": {"type": "string"}, "resource": {"type": "string"}, "sha256": {"$ref": "#/components/schemas/Sha256"}, "version": {"const": "3.1.0"}}), "generation": {"type": "object", "minProperties": 1, "additionalProperties": {"type": ["string", "object", "array"]}}}),
    }
    capability_registry = schemas["CapabilityRegistry"]
    capability_registry["required"].extend(["fieldTypes", "operators"])
    capability_registry["properties"]["fieldTypes"] = {
        "type": "array", "minItems": 1, "items": {"type": "string"},
        "deprecated": True, "description": "M1 compatibility alias derived from fieldCatalog; use fieldCatalog for catalog metadata.",
    }
    capability_registry["properties"]["operators"] = {
        "type": "array", "minItems": 1, "items": {"type": "string"},
        "deprecated": True, "description": "M1 compatibility alias derived from operatorSignatures; use operatorSignatures for arity metadata.",
    }
    schemas.update(resource_schemas())
    seen_requests: set[str] = set()
    resources: set[str] = set()
    for member in members:
        method, path = member["method"], member["path"]
        resources.add(resource_for(path))
        definition = request_definition(method, path)
        if definition and definition[0] not in seen_requests:
            name, schema, _, _ = definition; schemas[name] = schema; seen_requests.add(name)
    for resource in sorted(resources | {"AuthorizedAsset"}):
        if resource in {"CapabilityRegistry", "PublishedSchema", "BinaryAttachment"}: continue
        if resource == "AuthorizedAsset":
            schemas[resource] = closed(["id", "downloadUrl", "expiresAt", "contentType"], {"id": {"$ref": "#/components/schemas/OpaqueId"}, "downloadUrl": {"type": "string", "format": "uri"}, "expiresAt": {"type": "string", "format": "date-time"}, "contentType": {"type": "string"}})
        schemas[f"{resource}Response"] = closed(["requestId", resource[0].lower() + resource[1:]], {"requestId": {"$ref": "#/components/schemas/OpaqueId"}, resource[0].lower() + resource[1:]: {"$ref": f"#/components/schemas/{resource}"}})
        schemas[f"{resource}Collection"] = closed(["requestId", "items", "page"], {"requestId": {"$ref": "#/components/schemas/OpaqueId"}, "items": {"type": "array", "items": {"$ref": f"#/components/schemas/{resource}"}}, "page": closed(["limit", "nextCursor"], {"limit": {"type": "integer", "minimum": 1, "maximum": 200}, "nextCursor": {"anyOf": [{"type": "string"}, {"type": "null"}]}})})
    problem_example = {"type": "https://api.smartintake.invalid/problems/validation", "title": "Validation failed", "status": 422, "code": "VALIDATION_FAILED", "detail": "Correct the marked fields.", "requestId": "req-01J2W5RFR3K24SFWDX2C0N9VW3", "errors": [{"fieldId": "contact.email", "pointer": "/package/data/fields/0", "messageKey": "validation.required", "severity": "error", "parameters": {}}]}
    registry = load(CONTRACT / "capabilities.registry.json")
    # The concrete response model validates the live registry. Keep this
    # representative OpenAPI example deterministic without feeding its own
    # OpenAPI digest back into the generated component bundle.
    registry["openapi"]["sha256"] = "0" * 64
    component_bundle = {"openapi": "3.1.0", "info": {"title": "Smart Form Builder Lite 4.0.0 OpenAPI components", "version": "4.0.0"}, "components": {"securitySchemes": {"staffCookie": {"type": "apiKey", "in": "cookie", "name": "smartintake_staff", "description": "Opaque HttpOnly staff session cookie; sign-in validates Origin and binds a login-CSRF token before issuing it."}, "csrfHeader": {"type": "apiKey", "in": "header", "name": "X-CSRF-Token", "description": "Required for cookie-authenticated mutations."}, "respondentSession": {"type": "http", "scheme": "bearer", "bearerFormat": "opaque-session", "description": "Respondent authorization, valid only for its session or receipt."}}, "parameters": {"IfMatch": {"name": "If-Match", "in": "header", "required": True, "schema": {"type": "string", "pattern": '^"[A-Za-z0-9._-]+"$'}, "example": '"rev-7"'}, "IdempotencyKey": {"name": "Idempotency-Key", "in": "header", "required": True, "schema": {"$ref": "#/components/schemas/OpaqueId"}, "example": "idem-01J2W5RFR3K24SFWDX2C0N9VW3", "description": "Scoped to tenant, actor, operation and canonical request hash; retained for at least 7 days."}, "Cursor": {"name": "cursor", "in": "query", "schema": {"type": "string"}, "description": "Opaque stable-snapshot cursor. Pages are stable-sorted, duplicate-free and collectively contain every item exactly once."}, "Limit": {"name": "limit", "in": "query", "schema": {"type": "integer", "default": 50, "minimum": 1, "maximum": 200}}}, "headers": {"ETag": {"schema": {"type": "string"}, "description": "Strong entity tag."}, "Digest": {"schema": {"type": "string"}, "description": "Content digest for immutable publication bytes."}, "ContractSha256": {"schema": {"$ref": "#/components/schemas/Sha256"}, "description": "Published contract SHA-256."}, "RetryAfter": {"schema": {"type": "integer", "minimum": 1}, "description": "Seconds until the caller may retry a 429 response."}}, "examples": {"Problem": {"value": problem_example}, "CapabilityRegistry": {"value": registry}}, "responses": {}, "schemas": schemas, "x-contract-schema-resources": [{"$ref": f"./{name}"} for name in ["package.schema.json", "expression.schema.json", "input-answer.schema.json", "typed-answer.schema.json", "runtime-manifest.schema.json", "submission-envelope.schema.json", "event.schema.json"]]}}

    component_definitions = component_bundle["components"]
    component_definitions["parameters"].update({
        "LoginCsrfToken": {"name": "X-Login-CSRF-Token", "in": "header", "required": True, "schema": {"type": "string", "minLength": 24}, "description": "One-time value returned in the unauthenticated GET /v1/auth/session 401 response; it must match the server-bound login-CSRF cookie."},
        "LoginCsrfCookie": {"name": "smartintake_login_csrf", "in": "cookie", "required": True, "schema": {"type": "string", "minLength": 24}, "description": "Secure, HttpOnly, SameSite=Strict cookie set by unauthenticated GET /v1/auth/session and consumed with the matching X-Login-CSRF-Token."},
    })
    component_definitions["headers"]["LoginCsrfToken"] = {"schema": {"type": "string", "minLength": 24}, "example": "login-csrf-01J2W5RFR3K24SFWDX2C0N9VW3", "description": "One-time login-CSRF token issued only with an unauthenticated session response; sign-in consumes it."}
    component_definitions["headers"]["LoginCsrfSetCookie"] = {"schema": {"type": "string"}, "example": "smartintake_login_csrf=bound-01J2W5RFR3K24SFWDX2C0N9VW3; Secure; HttpOnly; SameSite=Strict; Path=/v1/auth", "description": "Sets smartintake_login_csrf as a Secure, HttpOnly, SameSite=Strict, short-lived cookie bound to the returned one-time token."}
    return component_bundle



def add_problem_responses(components: dict[str, Any]) -> None:
    response_codes = {
        "BadRequest": (400, "Malformed request"), "Unauthenticated": (401, "Authentication is required"),
        "Forbidden": (403, "Scope is insufficient"), "NotFound": (404, "Resource is absent or concealed"),
        "Conflict": (409, "Replay or state conflict"), "PreconditionFailed": (412, "ETag is stale"),
        "PreconditionRequired": (428, "If-Match is required"), "Unprocessable": (422, "Semantic validation failed"),
        "RateLimited": (429, "Rate limit exceeded"), "Gone": (410, "Session or capability expired"),
        "InternalError": (500, "Unexpected failure"),
    }
    for name, (status, description) in response_codes.items():
        problem = {"type": f"https://api.smartintake.invalid/problems/{name.lower()}", "title": description, "status": status, "code": name.upper(), "detail": description, "requestId": "req-01J2W5RFR3K24SFWDX2C0N9VW3", "errors": []}
        response: dict[str, Any] = {"description": description, "content": {"application/problem+json": {"schema": {"$ref": "#/components/schemas/Problem"}, "examples": {"problem": {"value": problem}}}}}
        if status == 429:
            response["headers"] = {"Retry-After": {"$ref": "#/components/headers/RetryAfter"}}
        components["components"]["responses"][name] = response
    components["components"]["responses"]["UnauthenticatedLoginCsrf"] = {
        "description": "No authenticated staff session is present. A one-time login-CSRF token and bound cookie are issued for the next sign-in attempt.",
        "headers": {"X-Login-CSRF-Token": {"$ref": "#/components/headers/LoginCsrfToken"}, "Set-Cookie": {"$ref": "#/components/headers/LoginCsrfSetCookie"}},
        "content": {"application/problem+json": {"schema": {"$ref": "#/components/schemas/Problem"}, "examples": {"anonymousLoginCsrf": {"value": {"type": "https://api.smartintake.invalid/problems/unauthenticated", "title": "Authentication is required", "status": 401, "code": "LOGIN_REQUIRED", "detail": "Sign in with the one-time login-CSRF token and bound cookie issued in this response.", "requestId": "req-01J2W5RFR3K24SFWDX2C0N9VW3", "errors": []}}}}},
    }


def success_content(resource: str, path: str, method: str, components: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    if path.startswith("/v1/schemas/"):
        return {"application/schema+json": {"schema": ref("schemas", "PublishedSchema"), "examples": {"schema": {"value": {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://contracts.smartintake.invalid/schemas/package/4.0.0", "type": "object", "title": "Package"}}}}}, {"ETag": ref("headers", "ETag"), "Digest": ref("headers", "Digest"), "X-Contract-SHA256": ref("headers", "ContractSha256")}
    if path == "/v1/capabilities":
        return {"application/json": {"schema": ref("schemas", "CapabilityRegistry"), "examples": {"registry": ref("examples", "CapabilityRegistry")}}}, {}
    if resource == "BinaryAttachment":
        return {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}, "example": "binary attachment bytes"}}, {"ETag": ref("headers", "ETag")}
    name = response_model(resource, collection_response(path, method))
    if collection_response(path, method):
        example = {"requestId": "req-01J2W5RFR3K24SFWDX2C0N9VW3", "items": [resource_example(resource)], "page": {"limit": 50, "nextCursor": None}}
    else:
        example = {"requestId": "req-01J2W5RFR3K24SFWDX2C0N9VW3", resource[0].lower() + resource[1:]: resource_example(resource)}
    headers = {"ETag": ref("headers", "ETag")}
    return {"application/json": {"schema": ref("schemas", name), "examples": {"success": {"value": example}}}}, headers


def operation(member: dict[str, Any], components: dict[str, Any], counted: bool = True) -> dict[str, Any]:
    method, path = member["method"].upper(), member["path"]
    roles, scope, security = roles_and_scope(method, path)
    if security == STAFF_SECURITY and not is_mutation(method): security = [{"staffCookie": []}]
    status, resource = success_status(method, path), resource_for(path)
    params = path_parameters(path)
    if collection_response(path, method): params += [ref("parameters", "Cursor"), ref("parameters", "Limit")]
    if needs_etag(method, path): params.append(ref("parameters", "IfMatch"))
    if is_mutation(method) and not path.startswith("/v1/auth/") and path != "/v1/invitations/accept": params.append(ref("parameters", "IdempotencyKey"))
    if path == "/v1/auth/sign-in": params += [ref("parameters", "LoginCsrfToken"), ref("parameters", "LoginCsrfCookie")]
    content, headers = success_content(resource, path, method, components)
    responses: dict[str, Any] = {status: {"description": "Successful response.", **({"headers": headers} if headers else {}), "content": {} if status == "204" else content}, "400": ref("responses", "BadRequest"), "401": ref("responses", "Unauthenticated"), "403": ref("responses", "Forbidden"), "404": ref("responses", "NotFound"), "429": ref("responses", "RateLimited"), "500": ref("responses", "InternalError")}
    if path == "/v1/auth/session": responses["401"] = ref("responses", "UnauthenticatedLoginCsrf")
    if is_mutation(method): responses.update({"409": ref("responses", "Conflict"), "422": ref("responses", "Unprocessable")})
    if needs_etag(method, path): responses.update({"412": ref("responses", "PreconditionFailed"), "428": ref("responses", "PreconditionRequired")})
    if path.startswith("/v1/sessions/") or path.startswith("/v1/public/"): responses["410"] = ref("responses", "Gone")
    category = "prd-named" if member["id"].startswith("ON-") else ("submission-interpretation" if path.endswith("/submissions/{id}/interpretation") else "supporting-crud")
    result: dict[str, Any] = {"operationId": member["id"], "summary": member["title"], "description": "Published M2 contract. Implementation is intentionally deferred unless marked implemented.", "x-m0-counted": counted, "x-m0-category": category if counted else "m2-supplemental", "x-m0-inventory-id": member["id"], "x-prd-citation": member["citation"], "x-authorization": {"roles": roles, "tenantScope": scope}, "x-implementation-status": "implemented" if path in {"/v1/capabilities", "/v1/schemas/{kind}/{version}"} else "contract-published", "responses": responses}
    if params: result["parameters"] = params
    if security: result["security"] = security
    if is_mutation(method):
        definition = request_definition(method, path)
        if definition is None:
            result["x-request-body"] = "none"
        else:
            name, _, valid, invalid = definition
            result["requestBody"] = {"required": True, "content": {"application/json": {"schema": ref("schemas", name), "examples": {"valid": {"value": valid}, "invalid": {"value": invalid}}}}}
        result["x-replay"] = "Idempotency-Key is scoped to tenant, actor, operation and canonical request hash, retained for at least seven days; equal requests replay the original result and changed-body reuse is 409. Session mutation replay keys are clientMutationId plus body."
    if path.startswith("/v1/auth/") or path == "/v1/invitations/accept":
        result["x-replay"] = "Authentication proofs are operation-specific and one-time where applicable; retries never replay credentials, tokens, cookies, reset links, activation links or transfer capabilities."
    if path in {"/v1/auth/sign-in", "/v1/auth/activate", "/v1/auth/recovery", "/v1/auth/reset", "/v1/invitations/accept"}:
        result["x-secret-issuance-replay"] = "Secret, activation, reset and session issuance never replay credentials, tokens, cookies or transfer capabilities; a replay response is redacted."
    if path == "/v1/auth/sign-in":
        result["x-login-csrf-origin-protection"] = "Validate an allow-listed Origin and a one-time login-CSRF token before issuing a SameSite, HttpOnly staff cookie."
    if path == "/v1/auth/session":
        result["x-login-csrf-bootstrap"] = "The unauthenticated 401 response issues one short-lived one-time X-Login-CSRF-Token header and its bound Secure, HttpOnly, SameSite=Strict cookie; a consumed or expired token requires a fresh unauthenticated session response."
    if collection_response(path, method):
        result["x-pagination"] = "Results use a stable total order and a snapshot cursor: no duplicate items, no missing items, and deterministic continuation while the cursor is valid."
    if needs_etag(method, path): result["x-concurrency"] = "Strong ETag and If-Match are required; missing is 428, stale is 412."
    if path.startswith("/v1/sessions/") and method == "PATCH": result["x-concurrency"] = "baseRevision is required; stale base is 409 without partial application; identical clientMutationId/body replays first."
    return result


def main() -> None:
    named, total = load(NAMED), load(TOTAL)
    components = build_components(total["members"])
    add_problem_responses(components)
    named_ids = {m["id"] for m in named["members"]}
    paths: dict[str, dict[str, Any]] = defaultdict(dict)
    for member in total["members"]: paths[member["path"]][member["method"].lower()] = operation(member, components, member["id"] in named_ids or member["id"].startswith("OS-"))
    supplemental = {"id": "M2-get-v1-workspaces-w-assets-assetid-authorized-asset", "method": "GET", "path": "/v1/workspaces/{w}/assets/{assetId}", "title": "Authorized asset metadata and transfer capability", "citation": {"source": "docs/source-handoff/Smart-Form-Builder-Lite-PRD-v1.1.md", "lines": "568"}}
    paths[supplemental["path"]]["get"] = operation(supplemental, components, False)
    paths[supplemental["path"]]["get"].update({"description": "Uncounted M2 secure endpoint design for the PRD-named authorized asset capability; contract-published, not implemented.", "x-m0-source-id": "ONS-authorized-asset-api-prd-568-c6c3e1e8e1", "security": [{"staffCookie": []}], "x-authorization": {"roles": ["workspace.response.export"], "tenantScope": "workspace"}, "x-m2-endpoint-design": {"reason": "PRD line 568 names capability but supplies no method/path.", "transferCapabilityMaxAgeSeconds": 300}})
    document = {"openapi": "3.1.0", "jsonSchemaDialect": "https://spec.openapis.org/oas/3.1/dialect/base", "info": {"title": "Smart Form Builder Lite API", "version": "4.0.0", "description": "Normative M2 operation contract; entries marked contract-published do not claim runtime implementation."}, "servers": [{"url": "https://api.example.invalid", "description": "Deployment chooses its base URL."}], "paths": dict(sorted(paths.items())), "x-m0-operation-inventory": {"oNamed": {"source": NAMED.relative_to(ROOT).as_posix(), "count": named["total"]}, "oTotal": {"source": TOTAL.relative_to(ROOT).as_posix(), "count": total["total"]}, "countedOperationIds": [m["id"] for m in total["members"]], "legacyPolicy": "Prototype routes are isolated in legacy-prototype-compatibility.yaml and never count as normative M2 operations."}}
    header = "# GENERATED by tools/openapi/generate_openapi.py from frozen M0 inventories. DO NOT EDIT.\n"
    API.write_text(header + yaml.safe_dump(document, sort_keys=False, allow_unicode=True, width=120), encoding="utf-8")
    COMPONENTS.write_text(header + yaml.safe_dump(components, sort_keys=False, allow_unicode=True, width=120), encoding="utf-8")


if __name__ == "__main__":
    main()
