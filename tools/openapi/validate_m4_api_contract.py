#!/usr/bin/env python3
"""Validate the additive M4 mutation protocol and its immutable legacy boundary."""
from pathlib import Path
import hashlib
import yaml

ROOT = Path(__file__).resolve().parents[2]
API = ROOT / "docs/api/openapi-4.1.0.yaml"
LEGACY = ROOT / "docs/api/openapi.yaml"
LEGACY_RESOURCE = ROOT / "backend/src/main/resources/contracts/openapi-4.0.0.yaml"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


api = yaml.safe_load(API.read_text(encoding="utf-8"))
require(api["info"]["version"] == "4.1.0", "M4 API info.version must be 4.1.0")
require(LEGACY.read_bytes() == LEGACY_RESOURCE.read_bytes(), "immutable 4.0.0 OpenAPI resource drifted")
schemas = api["components"]["schemas"]
mutation = schemas["SessionMutation"]
variants = mutation["oneOf"]
ops = [variant["properties"]["op"]["const"] for variant in variants]
require(ops == ["set", "clear", "markInvalid", "addItem", "removeItem", "moveItem"],
        f"unexpected M4 operation union: {ops}")
require(mutation["discriminator"]["propertyName"] == "op", "M4 operation union needs an op discriminator")
require(schemas["RuntimeRowPath"]["maxItems"] == 3, "rowPath depth must be bounded to three")
require(schemas["SessionMutationRequest"]["properties"]["operations"]["maxItems"] == 1000,
        "operation batch must be bounded to 1000")
by_op = {variant["properties"]["op"]["const"]: variant for variant in variants}
require(by_op["set"]["properties"]["value"]["$ref"] == "#/components/schemas/InputAnswerValue",
        "set must use the typed input-answer envelope")
require("initialFields" in by_op["addItem"]["properties"], "addItem must expose initialFields")
require("beforeItemId" in by_op["moveItem"]["properties"], "moveItem must use identity placement")
require("toIndex" not in by_op["moveItem"]["properties"], "moveItem must not expose index placement")
require(by_op["markInvalid"]["properties"]["reason"]["const"] == "UNPARSEABLE_INPUT",
        "markInvalid must use the canonical marker reason")
require((ROOT / "backend/src/main/resources/contracts/openapi-4.1.0.yaml").read_bytes() == API.read_bytes(),
        "published M4 OpenAPI resource drifted")
print("M4 API contract passed: version=4.1.0, operations=6, rowDepth=3, batch=1000, legacySha256="
      + hashlib.sha256(LEGACY.read_bytes()).hexdigest())
