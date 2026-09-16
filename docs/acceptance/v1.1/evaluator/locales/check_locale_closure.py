#!/usr/bin/env python3
"""Check evaluator locale-pack closure without consulting product output."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
LOCALES = Path(__file__).resolve().parent
PACKAGES = ROOT / "packages"
ORACLES = ROOT / "oracles"
REVIEW = ROOT / "review"
FIXTURES = ROOT / "fixtures"
FIXTURE_GROUPS = tuple(FIXTURES / name for name in ("t01-t07.json", "t08-t15.json", "t17-t24.json", "t25-t32.json"))
LOCALE_KEY_PREFIXES = (
    "ack.", "accessibility.", "confirmation", "error.", "form.", "glossary.",
    "guidance.", "msg.", "narration.", "opt.", "page.", "q.", "qa.",
    "review.", "rtl.", "system.",
)
STALE_FIXTURE_KEY_FIELDS = {"staleKey"}


def load(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def humanize(identifier: str) -> str:
    words: list[str] = []
    token = ""
    for char in identifier:
        if char in ".-_":
            if token:
                words.append(token)
                token = ""
        elif char.isupper() and token:
            words.append(token)
            token = char
        else:
            token += char
    if token:
        words.append(token)
    return " ".join(words).capitalize()


def package_key(prefix: str, value: str) -> str:
    return f"{prefix}.{value.replace('_', '-')}"


def package_contract() -> tuple[dict[str, str], dict[str, int]]:
    expected: dict[str, str] = {}
    counts = {"packageQuestions": 0, "packagePages": 0, "packageOptions": 0, "guidance": 0}
    for package_path in (PACKAGES / "package-hc.json", PACKAGES / "package-nhc.json"):
        package = load(package_path)
        fields = package["data"]["fields"]
        english = package["translations"]["en"]["messages"]
        pages = [page for phase in package["flow"]["phases"] for page in phase["pages"]]
        def recursive_fields(field: dict[str, Any]):
            yield field
            for child in field.get("properties", []):
                yield from recursive_fields(child)
            for schema_name in ("itemSchema", "rowSchema"):
                schema = field.get(schema_name)
                if isinstance(schema, dict):
                    yield from recursive_fields(schema)

        for field in (nested for root in fields for nested in recursive_fields(root)):
            label_key = field["labelKey"]
            if label_key not in english or field.get("descriptionKey") != label_key:
                raise ValueError(f"{package_path.name}: {field['id']} locale metadata is unresolved")
            expected[label_key] = english[label_key]
            if field in fields:
                # Guidance content is referenced by ID in the canonical package;
                # the global locale pack owns its localized wording.
                expected[f"guidance.{field['id']}"] = english.get(f"guidance.{field['id']}", f"Guidance for {english[label_key]}")
                counts["guidance"] += 1
            counts["packageQuestions"] += 1
            for option in field.get("options", []):
                if set(option) != {"id", "labelKey"} or option["labelKey"] not in english:
                    raise ValueError(f"{package_path.name}: {field['id']} option is not a locale-key reference")
                expected[option["labelKey"]] = english[option["labelKey"]]
                counts["packageOptions"] += 1
        for page in pages:
            expected[f"page.{page['id']}"] = english.get(f"page.{page['id']}", page["titleKey"].replace(".", " ").title())
            counts["packagePages"] += 1
    return expected, counts


def oracle_contract() -> tuple[dict[str, str], dict[str, int]]:
    author = load(ORACLES / "author-oracle.json")
    status_map = load(REVIEW / "status-label-map.json")
    expected: dict[str, str] = {}
    counts = {"authorQuestions": 0, "authorPages": 0, "reviewStatuses": 0, "fixed": 0}

    for field in author["fields"]:
        canonical_key = field["expected"]["key"]
        expected[f"q.author.{canonical_key}"] = humanize(canonical_key.rsplit(".", 1)[-1])
        counts["authorQuestions"] += 1
    for page in author["pages"]:
        expected[f"page.author.{page['page'].lower().replace(' ', '-')}"] = page["phase"]
        counts["authorPages"] += 1

    for row in status_map["map"]:
        status = row["status"]
        expected[f"review.status.{status}"] = row["display"] or "Not applicable"
        counts["reviewStatuses"] += 1
    expected.update(
        {
            "review.value.false": "No",
            "review.value.zero": "0",
            "error.reviewStale": "Review content has changed. Review and acknowledge it again.",
            "error.locale.missingMandatoryKey": "A mandatory localized message is missing.",
            "error.locale.staleMandatoryKey": "A mandatory localized message is stale.",
            "rtl.mixedDirectionIdentifier": "Patient identifier: asset-ABC-123",
            "accessibility.localeToggle": "Language and direction updated; values and item identifiers are unchanged.",
            "guidance.rich.heading": "Before you begin",
            "guidance.rich.item.1": "Provide the requested information.",
            "guidance.rich.item.2": "Review answers before submission.",
            "guidance.safeEmailPlaceholder": "name@example.test",
            "guidance.approvedQa.question": "Does an estimate take a payment?",
            "guidance.approvedQa.answer": "No. This form only collects information.",
            "guidance.approvedQa.paraphrase": "Will this charge me?",
            "guidance.noApprovedAnswer": "No approved answer is available.",
        }
    )
    counts["fixed"] = 14
    return expected, counts


def base_contract() -> dict[str, str]:
    return {
        "ack.review": "I confirm this review.",
        "confirmation": "Submission recorded.",
        "form.description": "Complete the required fields.",
        "form.title": "Synthetic intake",
        "glossary.estimate": "Estimate",
        "guidance.detailed": "Review each answer before continuing.",
        "guidance.short": "Select the best answer.",
        "msg.itemCount.zero": "{count} items",
        "msg.itemCount.one": "{count} item",
        "msg.itemCount.two": "{count} items",
        "msg.itemCount.few": "{count} items",
        "msg.itemCount.many": "{count} items",
        "msg.itemCount.other": "{count} items",
        "narration.equipment": "Equipment questions",
        "page.intake": "Intake",
        "page.review": "Review",
        "qa.estimate.answer": "A best available value.",
        "qa.estimate.paraphrase.1": "Use the closest known value.",
        "qa.estimate.question": "What does estimate mean?",
        "system.notProvided": "Not provided",
    }


def is_locale_message_key(value: str) -> bool:
    return value.startswith(LOCALE_KEY_PREFIXES)


def fixture_contract() -> tuple[dict[str, str], dict[str, int], set[str]]:
    """Collect every explicit message-key reference from every fixture group.

    A ``staleKey`` is intentionally the inverse of a required pack member: T12
    verifies that it is rejected. Keep that negative-fixture meaning explicit
    rather than renaming it into the positive locale contract.
    """
    references: set[str] = set()
    stale_references: set[str] = set()
    fixture_text: dict[str, str] = {}
    counts = {"fixtureGroups": 0, "fixtureKeyOccurrences": 0, "staleFixtureKeyOccurrences": 0}

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            content_key = value.get("contentKey")
            content_text = value.get("text")
            if isinstance(content_key, str) and is_locale_message_key(content_key) and isinstance(content_text, str):
                fixture_text.setdefault(content_key, content_text)
            translations = value.get("translations")
            english_messages = translations.get("en", {}).get("messages", {}) if isinstance(translations, dict) else {}
            if isinstance(english_messages, dict):
                for key, text in english_messages.items():
                    if (
                        isinstance(key, str)
                        and key.startswith(("q.", "guidance.", "opt."))
                        and isinstance(text, str)
                    ):
                        fixture_text.setdefault(key, text)
            for field, child in value.items():
                if isinstance(child, str) and is_locale_message_key(child):
                    if field in STALE_FIXTURE_KEY_FIELDS:
                        stale_references.add(child)
                        counts["staleFixtureKeyOccurrences"] += 1
                    else:
                        references.add(child)
                        counts["fixtureKeyOccurrences"] += 1
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    for fixture_path in FIXTURE_GROUPS:
        walk(load(fixture_path))
        counts["fixtureGroups"] += 1

    values: dict[str, str] = {}
    for key in references:
        # An empty value means this fixture references an existing contract key
        # (for example T12's removed ``ack.review``), not that it may be
        # silently omitted from expected-key closure.
        values[key] = fixture_text.get(key, "")
    return values, counts, stale_references


def expected_contract() -> tuple[dict[str, str], dict[str, int]]:
    expected = base_contract()
    package_values, package_counts = package_contract()
    oracle_values, oracle_counts = oracle_contract()
    fixture_values, fixture_counts, _ = fixture_contract()
    overlap = set(expected) & (set(package_values) | set(oracle_values))
    conflicting = sorted(
        key for key in overlap
        if expected[key] != (package_values | oracle_values)[key]
    )
    if conflicting:
        raise ValueError(f"duplicate locale keys: {conflicting}")
    expected.update(package_values)
    expected.update(oracle_values)
    for key, value in fixture_values.items():
        if key in expected and value and expected[key] != value:
            raise ValueError(f"fixture reference {key} conflicts with frozen English value")
        if key not in expected:
            if not value:
                raise ValueError(f"fixture reference {key} has no exact frozen English value")
            expected[key] = value
    return expected, package_counts | oracle_counts | fixture_counts


def value_has_script(value: str, locale: str) -> bool:
    if locale == "hi":
        return any("\u0900" <= character <= "\u097f" for character in value)
    if locale == "ar":
        return any("\u0600" <= character <= "\u06ff" for character in value)
    return True


def oracle_source_failures() -> list[str]:
    """Assert the non-package oracle contracts covered by the frozen keys."""
    failures: list[str] = []
    respondent = load(ORACLES / "respondent-oracle.json")
    focus = load(ORACLES / "focus-oracle.json")
    review_projection = load(REVIEW / "review-projection.json")
    fixtures = load(FIXTURES / "t08-t15.json")
    if respondent.get("startLocale") != "en":
        failures.append("respondent oracle no longer starts in the English pack")
    focus_text = json.dumps(focus, ensure_ascii=False)
    if "Toggle locale" not in focus_text or "mixed-direction identifiers are not scrambled" not in focus_text:
        failures.append("focus oracle locale/mixed-direction contract is absent")
    if "REVIEW_STALE" not in json.dumps(review_projection, ensure_ascii=False):
        failures.append("review oracle stale-review error contract is absent")
    fixture_text = json.dumps(fixtures, ensure_ascii=False)
    if "mixed-direction-identifier" not in fixture_text and "rtl/mixed-direction" not in fixture_text.lower():
        failures.append("fixture oracle mixed-direction case is absent")
    if "locales/key-inventory.json" not in json.dumps(load(FIXTURES / "t08-t15.json"), ensure_ascii=False):
        failures.append("T12 fixture no longer binds the locale inventory")
    return failures


def check() -> None:
    inventory = load(LOCALES / "key-inventory.json")
    expectations = load(LOCALES / "locale-expectations.json")
    plural_map = load(LOCALES / "plural-map.json")
    invalid = load(LOCALES / "invalid-variant.json")
    expected, counts = expected_contract()
    _, _, stale_fixture_keys = fixture_contract()
    expected_keys = set(expected)
    failures = oracle_source_failures()

    if inventory.get("referenceClosure", {}).get("keyCount") != len(expected_keys):
        failures.append("key-inventory referenceClosure keyCount is stale")
    if inventory.get("referenceClosure", {}).get("missingReferenceCount") != 0:
        failures.append("key-inventory does not declare zero missing references")

    for locale in ("en", "hi", "ar"):
        inventory_pack = inventory["localePacks"].get(locale, {})
        expectation_pack = expectations["localePacks"].get(locale, {})
        values = inventory_pack.get("messageValues")
        expectation_values = expectation_pack.get("values")
        if not isinstance(values, dict) or not isinstance(expectation_values, dict):
            failures.append(f"{locale}: missing values object")
            continue
        if values != expectation_values:
            failures.append(f"{locale}: inventory and expectation packs differ")
        if set(values) != expected_keys:
            failures.append(f"{locale}: exact key-set mismatch missing={sorted(expected_keys - set(values))} surplus={sorted(set(values) - expected_keys)}")
        for key, value in values.items():
            if not isinstance(value, str) or not value.strip():
                failures.append(f"{locale}: {key} is null or blank")
            elif not value_has_script(value, locale):
                failures.append(f"{locale}: {key} lacks required native script")
        if locale == "en":
            for key, english_value in expected.items():
                if english_value and values.get(key) != english_value:
                    failures.append(f"en: {key} differs from its frozen source value")
        else:
            if inventory_pack.get("reviewState") != "pending-native-review":
                failures.append(f"{locale}: reviewState is not pending-native-review")
            if inventory_pack.get("approvalClaim") is not False or expectation_pack.get("approvalClaim") is not False:
                failures.append(f"{locale}: must not claim linguistic approval")
            if expectation_pack.get("nativeReview") != "pending":
                failures.append(f"{locale}: nativeReview is not pending")

    for locale, definition in plural_map["locales"].items():
        values = inventory["localePacks"][locale]["messageValues"]
        for category in definition["categories"]:
            if f"msg.itemCount.{category}" not in values:
                failures.append(f"{locale}: missing plural category {category}")
    for record in invalid["records"]:
        if record["expected"].get("variant") == "missing ack.review" and "ack.review" not in expected_keys:
            failures.append("invalid variant does not target a mandatory key")
    for key in stale_fixture_keys:
        if key in expected_keys:
            failures.append(f"stale fixture key {key} was incorrectly added to the locale contract")

    if failures:
        raise ValueError("\n".join(failures))
    print(
        "PASS locale closure: "
        f"keys={len(expected)} packageQuestions={counts['packageQuestions']} "
        f"guidance={counts['guidance']} packageOptions={counts['packageOptions']} "
        f"authorQuestions={counts['authorQuestions']} reviewStatuses={counts['reviewStatuses']} "
        f"fixtureGroups={counts['fixtureGroups']} fixtureKeyOccurrences={counts['fixtureKeyOccurrences']} "
        "missing-reference=0"
    )


if __name__ == "__main__":
    try:
        check()
    except (KeyError, TypeError, ValueError) as error:
        print(f"FAIL locale closure: {error}", file=sys.stderr)
        raise SystemExit(1)
