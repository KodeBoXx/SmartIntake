from __future__ import annotations

import unittest
from pathlib import Path

from tools.openapi import validate_openapi as validator


class OpenApiInventoryValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.api = validator.API
        self.components = validator.COMPONENTS
        self.api_bytes = self.api.read_bytes()
        self.components_bytes = self.components.read_bytes()

    def tearDown(self) -> None:
        self.api.write_bytes(self.api_bytes)
        self.components.write_bytes(self.components_bytes)

    def test_frozen_inventory_and_generated_bytes_pass(self) -> None:
        self.assertEqual([], validator.validate(check_generated=True))

    def test_rejects_silent_prototype_route_substitution(self) -> None:
        text = self.api.read_text(encoding="utf-8")
        self.api.write_text(text.replace("/v1/capabilities:", "/v1/health:", 1), encoding="utf-8")
        errors = validator.validate(check_generated=False)
        self.assertTrue(any("prototype or substituted key" in error or "counted O_total mismatch" in error for error in errors), errors)

    def test_rejects_counted_supplemental_asset_endpoint(self) -> None:
        text = self.api.read_text(encoding="utf-8")
        needle = "operationId: M2-get-v1-workspaces-w-assets-assetid-authorized-asset\n"
        self.assertIn(needle, text)
        self.api.write_text(text.replace("      x-m0-counted: false\n", "      x-m0-counted: true\n", 1), encoding="utf-8")
        errors = validator.validate(check_generated=False)
        self.assertTrue(any("not in frozen O_total" in error or "supplemental" in error for error in errors), errors)

    def test_rejects_missing_schema_reference(self) -> None:
        text = self.components.read_text(encoding="utf-8")
        self.components.write_text(text.replace("- $ref: ./event.schema.json", "- $ref: ./event.schema.json.removed", 1), encoding="utf-8")
        errors = validator.validate(check_generated=False)
        self.assertTrue(any("seven M2 JSON Schema" in error for error in errors), errors)

    def test_rejects_generic_fallback_schema(self) -> None:
        text = self.components.read_text(encoding="utf-8")
        self.components.write_text(text.replace("  x-contract-schema-resources:", "    RequestEnvelope:\n      type: object\n  x-contract-schema-resources:", 1), encoding="utf-8")
        errors = validator.validate(check_generated=False)
        self.assertTrue(any("forbidden generic fallback" in error for error in errors), errors)

    def test_rejects_invalid_selected_response_example(self) -> None:
        text = self.api.read_text(encoding="utf-8")
        self.api.write_text(text.replace("requestId: req-01J2W5RFR3K24SFWDX2C0N9VW3", "requestId: invalid id", 1), encoding="utf-8")
        errors = validator.validate(check_generated=False)
        self.assertTrue(any("success response" in error and "example is invalid" in error for error in errors), errors)

    def test_session_contract_keeps_authenticated_200_and_anonymous_login_csrf_401(self) -> None:
        document = validator.load_yaml(self.api)
        components = validator.load_yaml(self.components)
        session = document["paths"]["/v1/auth/session"]["get"]
        success = session["responses"]["200"]
        success_ref = success["content"]["application/json"]["schema"]["$ref"]
        success_example = success["content"]["application/json"]["examples"]["success"]["value"]["authenticatedSession"]
        self.assertTrue(success_ref.endswith("/schemas/AuthenticatedSessionResponse"))
        self.assertEqual("active", success_example["activationState"])
        self.assertEqual("author", success_example["organizations"][0]["workspaces"][0]["roles"][0])
        self.assertTrue(session["responses"]["401"]["$ref"].endswith("/responses/UnauthenticatedLoginCsrf"))
        anonymous = components["components"]["responses"]["UnauthenticatedLoginCsrf"]
        self.assertTrue(anonymous["headers"]["X-Login-CSRF-Token"]["$ref"].endswith("/headers/LoginCsrfToken"))
        self.assertTrue(anonymous["headers"]["Set-Cookie"]["$ref"].endswith("/headers/LoginCsrfSetCookie"))
        self.assertEqual(401, anonymous["content"]["application/problem+json"]["examples"]["anonymousLoginCsrf"]["value"]["status"])


if __name__ == "__main__":
    unittest.main()
