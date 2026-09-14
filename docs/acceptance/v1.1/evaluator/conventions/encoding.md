# Encoding conventions

UTF-8 without BOM, LF line endings, exactly one trailing newline, no trailing whitespace, and no tabs. JSON artifacts use `json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True, separators=(",", ": ")) + "\n"`. Arrays retain the specified semantic order. Expected outcomes are derived solely from the PRD/handoff; absent native translations and package wire instances remain blocked rather than invented.
