"""Deterministic T22 response export formats and independent byte verifier."""
from __future__ import annotations

import csv
import hashlib
import io
import json
from pathlib import Path
import zipfile


JSON_CONTENT_TYPE = "application/json"
CSV_BUNDLE_CONTENT_TYPE = "application/vnd.smartintake.relational-csv+zip"
CSV_BUNDLE_FORMAT = "relational-csv-bundle"
ROOT_TABLE = "responses.csv"
LEVEL_TABLES = ("repeater_level_1.csv", "repeater_level_2.csv", "repeater_level_3.csv")
DICTIONARY_TABLE = "data_dictionary.csv"
INTERPRETATION_MANIFEST = "interpretation_manifest.json"


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

def package_dictionary(package):
    """Independent recursive traversal of the canonical field graph."""
    rows=[]
    def walk(field, path, parent=None):
        row={"fieldId":field["id"],"keyPath":path+[field.get("key",field["id"])],"type":field["type"],"unit":field.get("unit"),"parentFieldId":parent,"optionIds":[x["id"] for x in field.get("options",[]) if isinstance(x,dict) and "id" in x],"ordered":bool(field.get("ordered",field["type"]=="list"))}
        rows.append(row)
        for child in field.get("properties",[]): walk(child,row["keyPath"],field["id"])
        schema=field.get("itemSchema")
        if isinstance(schema,dict):
            # item schemas are canonical object definitions, not an implicit
            # transport segment. Preserve their actual sibling key and id.
            schema_row={"fieldId":schema["id"],"keyPath":row["keyPath"]+[schema["key"]],"type":schema["type"],"unit":schema.get("unit"),"parentFieldId":field["id"],"optionIds":[x["id"] for x in schema.get("options",[]) if isinstance(x,dict) and "id" in x],"ordered":bool(schema.get("ordered",False))}
            rows.append(schema_row)
            for child in schema.get("properties",[]): walk(child,schema_row["keyPath"],schema["id"])
    for field in package["data"]["fields"]: walk(field,[])
    return rows


def formula_safe(value):
    value = "" if value is None else str(value)
    return "'" + value if value[:1] in ("=", "+", "-", "@") else value


def csv_bytes(fieldnames, rows):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fieldnames, lineterminator="\n", extrasaction="raise")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def export_document(dataset):
    return {
        "schemaVersion": "t22-response-export/v1",
        "responses": dataset["responses"],
        "dataDictionary": dataset["exportDictionary"],
        "interpretationManifest": dataset["exportInterpretation"],
    }

def derive_export_rows(dataset):
    """Derive every export value/link from declared fields and InputAnswer values."""
    fields=dataset["package"]["data"]["fields"]
    by_key={field["key"]:field for field in fields}
    required={"canonicalText":"text","canonicalInteger":"integer","repeaterLevel1":"list"}
    if set(required)-set(by_key) or any(by_key[key].get("type") != kind for key,kind in required.items()):
        raise ValueError("responses package lacks declared canonical text/integer/repeater fields")
    text_id, integer_id, root_id=(by_key[key]["id"] for key in required)
    level2_id=f"{root_id}-level2"; level3_id=f"{root_id}-level3"; quantity_id=f"{root_id}-quantity"
    rows=[]
    for response in dataset["responses"]:
        answers=response.get("answers",{})
        text=answers.get(text_id,{}); integer=answers.get(integer_id,{}); root=answers.get(root_id,{})
        if text.get("status")!="answered" or not isinstance(text.get("value"),str) or integer.get("status")!="answered" or not isinstance(integer.get("value"),str):
            raise ValueError("response is missing declared typed InputAnswer values")
        if integer["value"] in ("-0","") or not integer["value"].lstrip("-").isdigit() or (integer["value"].lstrip("-").startswith("0") and integer["value"].lstrip("-")!="0"):
            raise ValueError("integer InputAnswer is not canonical decimal string")
        try:
            one=root["value"]["items"][0]; two=one["fields"][level2_id]["value"]["items"][0]; three=two["fields"][level3_id]["value"]["items"][0]
            quantity=three["fields"][quantity_id]
            if root["status"]!="answered" or quantity.get("status")!="answered" or not isinstance(quantity.get("value"),str): raise ValueError
        except (KeyError, IndexError, TypeError, ValueError) as exc: raise ValueError("recursive list/object InputAnswer graph is invalid") from exc
        rows.append({"id":response["id"],"submissionId":response["submissionId"],"releaseId":response["releaseId"],"canonicalText":text["value"],"integer":integer["value"],"textFieldId":text_id,"integerFieldId":integer_id,"levels":[
            {"level":1,"itemId":one["itemId"],"parentItemId":None,"fieldId":root_id,"ordinal":0,"typedValue":"","valueFieldId":""},
            {"level":2,"itemId":two["itemId"],"parentItemId":one["itemId"],"fieldId":level2_id,"ordinal":0,"typedValue":"","valueFieldId":""},
            {"level":3,"itemId":three["itemId"],"parentItemId":two["itemId"],"fieldId":level3_id,"ordinal":0,"typedValue":quantity["value"],"valueFieldId":quantity_id},
        ]})
    return rows


def csv_tables(dataset):
    root_rows, levels = [], {1: [], 2: [], 3: []}
    for response in derive_export_rows(dataset):
        root_rows.append({
            "id": response["id"], "submissionId": response["submissionId"],
            "releaseId": response["releaseId"], "canonicalText": formula_safe(response["canonicalText"]),
            "integer": response["integer"], "answerStatus": "answered",
            "answerValue": response["integer"],
        })
        for level in response["levels"]:
            levels[level["level"]].append({
                "responseId": response["id"], "submissionId": response["submissionId"],
                "itemId": level["itemId"], "parentItemId": level["parentItemId"] or "",
                "fieldId": level["fieldId"], "ordinal": str(level["ordinal"]),
                "typedValue": level["typedValue"] if level["level"] == 3 else "",
                "valueFieldId":level["valueFieldId"],
            })
    return {
        ROOT_TABLE: csv_bytes(("id", "submissionId", "releaseId", "canonicalText", "integer", "answerStatus", "answerValue"), root_rows),
        LEVEL_TABLES[0]: csv_bytes(("responseId", "submissionId", "itemId", "parentItemId", "fieldId", "ordinal", "typedValue","valueFieldId"), levels[1]),
        LEVEL_TABLES[1]: csv_bytes(("responseId", "submissionId", "itemId", "parentItemId", "fieldId", "ordinal", "typedValue","valueFieldId"), levels[2]),
        LEVEL_TABLES[2]: csv_bytes(("responseId", "submissionId", "itemId", "parentItemId", "fieldId", "ordinal", "typedValue","valueFieldId"), levels[3]),
        DICTIONARY_TABLE: csv_bytes(("fieldId", "keyPath", "type", "unit", "parentFieldId", "optionIds", "ordered"), [{**row,"keyPath":"/".join(row["keyPath"]),"unit":row["unit"] or "","parentFieldId":row["parentFieldId"] or "","optionIds":"|".join(row["optionIds"]),"ordered":str(row["ordered"]).lower()} for row in package_dictionary(dataset["package"])]),
        INTERPRETATION_MANIFEST: canonical(dataset["exportInterpretation"]) + b"\n",
    }


def deterministic_zip(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, files[name])
    return output.getvalue()


def build_export_artifacts(dataset):
    """Return immutable actual JSON and CSV-bundle bytes for the frozen corpus."""
    return {
        "json": canonical(export_document(dataset)) + b"\n",
        CSV_BUNDLE_FORMAT: deterministic_zip(csv_tables(dataset)),
    }


def _compare_exact(actual, expected, name):
    if actual != expected:
        raise ValueError("content differs from frozen expected " + name)


def verify_export_artifacts(dataset, json_bytes, bundle_bytes):
    """Parse and deep-compare independently supplied immutable artifact bytes."""
    derived_rows=derive_export_rows(dataset)
    dictionary=dataset.get("exportDictionary")
    if not isinstance(dictionary,list) or dictionary != package_dictionary(dataset["package"]):
        raise ValueError("authoritative dictionary differs from independently traversed package graph")
    runtime_manifest={"format":"t22-relational-csv-zip/v1","tables":["responses.csv","repeater_level_1.csv","repeater_level_2.csv","repeater_level_3.csv","data_dictionary.csv","interpretation_manifest.json"]}
    package_hash=hashlib.sha256(canonical(dataset["package"])).hexdigest(); dictionary_hash=hashlib.sha256(canonical(dictionary)).hexdigest(); runtime_hash=hashlib.sha256(canonical(runtime_manifest)).hexdigest()
    expected_key=hashlib.sha256(canonical({"packageHash":package_hash,"runtimeManifestHash":runtime_hash,"dictionaryHash":dictionary_hash,"releaseId":dataset["release"]["id"],"definitionVersion":dataset["package"]["definitionVersion"]})).hexdigest()
    interpretation=dataset["exportInterpretation"]
    bindings={"releaseId":dataset["release"]["id"],"definitionVersion":dataset["package"]["definitionVersion"],"packageHash":package_hash,"dictionaryHash":dictionary_hash,"runtimeManifestHash":runtime_hash,"interpretationKey":expected_key}
    if any(interpretation.get(key)!=value for key,value in bindings.items()): raise ValueError("interpretation hashes do not bind package/release/dictionary/runtime")
    expected = build_export_artifacts(dataset)
    try:
        document = json.loads(json_bytes)
    except (TypeError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("JSON export cannot be parsed") from exc
    if document != export_document(dataset):
        raise ValueError("JSON export response/dictionary/interpretation content differs")
    # Canonical reserialization proves exact typed values as well as the full row set.
    _compare_exact(bytes(json_bytes), expected["json"], "JSON export bytes")
    try:
        with zipfile.ZipFile(io.BytesIO(bundle_bytes)) as archive:
            names = archive.namelist()
            expected_tables = csv_tables(dataset)
            parsed_tables = {}
            if len(names) != len(set(names)) or set(names) != set(expected_tables):
                raise ValueError("CSV bundle missing, extra, or duplicate files")
            for name, wanted in expected_tables.items():
                actual = archive.read(name)
                if name.endswith(".csv"):
                    # Parse before byte equality so a malformed/unescaped formula cell is never
                    # accepted just because it has a coincidental byte sequence.
                    parsed = list(csv.DictReader(io.StringIO(actual.decode("utf-8"), newline="")))
                    wanted_rows = list(csv.DictReader(io.StringIO(wanted.decode("utf-8"), newline="")))
                    if parsed != wanted_rows:
                        raise ValueError("CSV typed row set differs: " + name)
                    parsed_tables[name] = parsed
                    # Formula protection applies to text cells.  Canonical signed
                    # integer strings (for example INT64_MIN) deliberately retain
                    # their leading minus and are typed by the data dictionary.
                    for row in parsed:
                        for column in ("canonicalText", "typedValue"):
                            value=row.get(column, "")
                            if column == "typedValue" and name == "repeater_level_3.csv": continue
                            if value and value[:1] in ("=", "+", "-", "@"):
                                raise ValueError("unescaped formula cell: " + name)
                else:
                    if json.loads(actual) != dataset["exportInterpretation"]:
                        raise ValueError("interpretation manifest differs")
                _compare_exact(actual, wanted, name)
            roots = parsed_tables[ROOT_TABLE]
            if len(roots) != 10000 or len({row["id"] for row in roots}) != 10000 or any(row["id"] != row["submissionId"] for row in roots):
                raise ValueError("root response/submission IDs are missing, duplicate, or mismatched")
            parents = {row["id"]: {""} for row in roots}
            for name in LEVEL_TABLES:
                rows = parsed_tables[name]
                if len(rows) != 10000 or len({(row["responseId"], row["itemId"]) for row in rows}) != 10000:
                    raise ValueError("repeater rows are missing or duplicated: " + name)
                for row in rows:
                    if row["responseId"] not in parents or row["submissionId"] != row["responseId"] or row["parentItemId"] not in parents[row["responseId"]]:
                        raise ValueError("repeater parentItemId linkage differs: " + name)
                for row in rows: parents[row["responseId"]].add(row["itemId"])
    except zipfile.BadZipFile as exc:
        raise ValueError("CSV bundle cannot be parsed") from exc
    return {
        "jsonSha256": hashlib.sha256(json_bytes).hexdigest(),
        "csvBundleSha256": hashlib.sha256(bundle_bytes).hexdigest(),
        "responseCount": len(dataset["responses"]),
        "bundleFiles": sorted(csv_tables(dataset)),
    }


def write_export_artifacts(dataset, output_dir):
    output = Path(output_dir); output.mkdir(parents=True, exist_ok=True)
    artifacts = build_export_artifacts(dataset)
    paths = {"json": output / "responses.json", CSV_BUNDLE_FORMAT: output / "responses-relational-csv.zip"}
    for name, path in paths.items():
        path.write_bytes(artifacts[name])
    return paths
