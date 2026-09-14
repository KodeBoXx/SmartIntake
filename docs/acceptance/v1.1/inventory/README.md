# M0 authoritative inventory

Generated from the repository PRD/handoff by `tools/acceptance/generate_inventory.py`. Run `python3 tools/acceptance/generate_inventory.py --check` for the strict M0 gate. The current handoff declares seven formerly removed whole-Core IDs but does not enumerate them, so that strict gate intentionally fails rather than inventing a denial list. Use `--check --allow-unenumerated-denial-list` only to reproduce the remaining inventory while the authoritative source is corrected. This is provenance and denominator material only; it assigns no product acceptance status.
