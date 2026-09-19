#!/usr/bin/env python3
"""Fail closed if M5's browser evidence diverges from frozen route/state authority."""
from __future__ import annotations
import hashlib, importlib.util, json, pathlib, re, subprocess, sys

root = pathlib.Path(__file__).resolve().parents[2]
STAFF_REQUIRED_STATES = {'loading', 'empty-or-no-access', 'invalid', 'denied', 'expired', 'email-unavailable'}


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def evaluator_digest_helper():
    helper_path = root / 'docs/acceptance/v1.1/evaluator/tools/validate_corpus.py'
    spec = importlib.util.spec_from_file_location('m5_evaluator_digest_helper', helper_path)
    if spec is None or spec.loader is None:
        raise RuntimeError('cannot import evaluator corpus digest helper')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def artifact_map(manifest: dict[str, object]) -> dict[str, str]:
    artifacts = manifest.get('artifacts')
    if not isinstance(artifacts, list):
        raise ValueError('evaluator manifest artifacts must be a list')
    listed: dict[str, str] = {}
    for artifact in artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get('path'), str) or not isinstance(artifact.get('sha256'), str):
            raise ValueError('evaluator manifest artifact must contain path and sha256 strings')
        path, digest = artifact['path'], artifact['sha256']
        if pathlib.PurePosixPath(path).is_absolute() or '..' in pathlib.PurePosixPath(path).parts or not re.fullmatch(r'[0-9a-f]{64}', digest):
            raise ValueError(f'invalid evaluator manifest artifact: {path!r}')
        if path in listed:
            raise ValueError(f'duplicate evaluator manifest artifact: {path}')
        listed[path] = digest
    return listed


def verify_evaluator_authority(evaluator_root: pathlib.Path, manifest_path: pathlib.Path, expected_manifest_digest: str, expected_corpus_digest: str) -> None:
    if manifest_path.parent != evaluator_root:
        raise ValueError('evaluator manifest must be rooted in the evaluator directory')
    if sha256(manifest_path) != expected_manifest_digest:
        raise ValueError('M5 evaluator manifest digest mismatch')
    manifest = json.loads(manifest_path.read_text())
    listed = artifact_map(manifest)
    helper = evaluator_digest_helper()
    actual = {file.relative_to(evaluator_root).as_posix(): sha256(file) for file in helper.corpus_files(evaluator_root)}
    if listed != actual:
        raise ValueError('M5 evaluator artifact path-to-SHA map mismatch')
    digest = helper.corpus_digest(evaluator_root)
    if manifest.get('corpusDigest') != digest or digest != expected_corpus_digest:
        raise ValueError('M5 evaluator corpus digest mismatch')


def expected_template(requirement_route: str) -> str:
    """Translate frozen denominator placeholders to their declared Angular names."""
    replacements = {'w': ':workspaceId', 'f': ':formId', 'd': ':draftId', 'shareId': ':shareId'}
    if requirement_route.startswith('/sessions/'):
        replacements['s'] = ':sessionId'
    elif '/submissions/' in requirement_route:
        replacements['s'] = ':submissionId'
    elif '{s}' in requirement_route:
        raise ValueError(f'cannot bind denominator placeholder in route {requirement_route}')
    return re.sub(r'\{([^}]+)\}', lambda match: replacements[match.group(1)], requirement_route)


def route_templates(route_source: str) -> dict[str, str]:
    templates: dict[str, str] = {}
    for kind in ('auth', 'staff', 'publicPage'):
        for path, screen in re.findall(rf"{kind}\('([^']+)',\s*'([^']+)'\)", route_source):
            # Catalog intentionally has a secondary /new route. The denominator
            # binds its canonical screen route, which is declared first.
            templates.setdefault(screen, f'/{path}')
    templates['not-found'] = '/not-found'
    return templates


def validate_denominator_semantics(ui_total: dict[str, object], ui_staff: dict[str, object]) -> tuple[set[str], set[str]]:
    members = ui_total.get('members')
    staff_members = ui_staff.get('members')
    if not isinstance(members, list) or not isinstance(staff_members, list):
        raise ValueError('denominator members must be lists')
    if ui_total.get('total') != len(members) or ui_staff.get('total') != len(staff_members):
        raise ValueError('denominator totals must equal discovered member counts')
    route_titles: set[str] = set()
    route_states: set[str] = set()
    for member in members:
        if not isinstance(member, dict) or not isinstance(member.get('title'), str) or not isinstance(member.get('route'), str) or not isinstance(member.get('states'), str):
            raise ValueError('UI_total member lacks title, route, or state cluster')
        states = set(member['states'].split('/'))
        if not states or '' in states:
            raise ValueError(f'UI_total member has an invalid state cluster: {member.get("title")}')
        if member['title'] in route_titles:
            raise ValueError(f'duplicate UI_total title: {member["title"]}')
        route_titles.add(member['title'])
        route_states.update(states)
    staff_screens: set[str] = set()
    staff_states: set[str] = set()
    for member in staff_members:
        if not isinstance(member, dict) or not isinstance(member.get('screen'), str) or not isinstance(member.get('required_states'), list):
            raise ValueError('UI_staff_total member lacks screen or required state list')
        states = set(member['required_states'])
        if states != STAFF_REQUIRED_STATES:
            raise ValueError(f'UI_staff_total required state categories mismatch for {member["screen"]}: {sorted(states)}')
        if member['screen'] in staff_screens:
            raise ValueError(f'duplicate UI_staff_total screen: {member["screen"]}')
        staff_screens.add(member['screen'])
        staff_states.update(states)
    return route_states, staff_states


def validate_route_template_bindings(corpus: dict[str, object], ui_total: dict[str, object], ui_staff: dict[str, object], route_source: str, state_source: str) -> None:
    if 'routes' in corpus or 'staffScreens' in corpus:
        raise ValueError('browser corpus must derive route and staff cases from frozen denominators, not maintain duplicate lists')
    templates = route_templates(route_source)
    ui_members = ui_total['members']
    assert isinstance(ui_members, list)
    for member in ui_members:
        assert isinstance(member, dict)
        required = expected_template(member['route'])
        screen = member['title'].removeprefix('staff-')
        if templates.get(screen) != required:
            raise ValueError(f'authoritative route-template mismatch for {member["title"]}: expected {required}, found {templates.get(screen)}')
    staff_templates = corpus.get('staffScreenTemplates')
    if not isinstance(staff_templates, dict):
        raise ValueError('browser corpus lacks staffScreenTemplates binding')
    staff_members = ui_staff['members']
    assert isinstance(staff_members, list)
    expected_screens = {member['screen'] for member in staff_members if isinstance(member, dict)}
    if set(staff_templates) != expected_screens:
        raise ValueError('M5 staff template corpus does not discover every UI_staff_total screen exactly once')
    for screen in expected_screens:
        if staff_templates.get(screen) != templates.get(screen):
            raise ValueError(f'authoritative staff route-template mismatch for {screen}: expected {templates.get(screen)}, found {staff_templates.get(screen)}')
    declared_states = set(re.findall(r"'([a-z-]+)'", re.search(r'export type M5StubState = (.*?);', state_source, re.S).group(1)))
    route_states, staff_states = validate_denominator_semantics(ui_total, ui_staff)
    missing_states = (route_states | staff_states) - declared_states
    if missing_states:
        raise ValueError(f'M5 stub state union omits frozen denominator states: {sorted(missing_states)}')
    if "loadComponent: () => import('./shells/staff-shell.component')" not in route_source or "loadComponent: () => import('./shells/public-shell.component')" not in route_source:
        raise ValueError('staff and public shell boundaries must remain lazy')
    if re.search(r"import \{ (?:StaffShellComponent|PublicShellComponent|StaffPageComponent|PublicPageComponent|AuthPageComponent) \}", route_source):
        raise ValueError('M5 feature components must not be eagerly imported by app.routes')
    compatibility = re.search(r"\{ path: 'catalog/builder', canActivate: \[m5StaffGuard\], loadComponent: .*? \},", route_source)
    if not compatibility:
        raise ValueError('M1 compatibility route must remain a shell-less guarded lazy route')


def main() -> None:
    corpus = json.loads((root / 'frontend/e2e/m5-route-corpus.json').read_text())
    for key in ('uiTotal', 'uiStaffTotal'):
        source = root / corpus['authority'][key]
        actual = sha256(source)
        expected = corpus['authority'][f'{key}Sha256']
        if actual != expected:
            raise SystemExit(f'M5 corpus authority digest mismatch for {key}: {actual} != {expected}')
    ui_total = json.loads((root / corpus['authority']['uiTotal']).read_text())
    ui_staff = json.loads((root / corpus['authority']['uiStaffTotal']).read_text())
    try:
        validate_route_template_bindings(corpus, ui_total, ui_staff, (root / 'frontend/src/app/app.routes.ts').read_text(), (root / 'frontend/src/app/core/m5-session.store.ts').read_text())
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        raise SystemExit(f'M5 denominator and template validation failed: {error}') from error
    authority = corpus['authority']
    manifest = root / authority['evaluatorManifest']
    try:
        verify_evaluator_authority(manifest.parent, manifest, authority['evaluatorManifestSha256'], authority['corpusDigest'])
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f'M5 evaluator checksum authority validation failed: {error}') from error
    package = json.loads((root / 'frontend/package.json').read_text())
    if package.get('scripts', {}).get('e2e:install') != 'playwright install --with-deps chromium':
        raise SystemExit('M5 Chromium provisioning must be reproducible via npm run e2e:install')
    for path in ('frontend/e2e', 'frontend/playwright.config.ts'):
        for file in (root / path).rglob('*') if (root / path).is_dir() else [root / path]:
            if file.is_file() and re.search(r'\b(test\.(?:skip|only)|describe\.(?:skip|only)|quarantine)\b', file.read_text()):
                raise SystemExit(f'Forbidden skipped/focused/quarantined browser test marker in {file.relative_to(root)}')
    source_guard = subprocess.run([sys.executable, 'tools/frontend/check_m5_cui_source.py'], cwd=root, text=True, capture_output=True)
    if source_guard.returncode:
        raise SystemExit(f'M5 Cui source guard failed:\n{source_guard.stdout}{source_guard.stderr}')
    route_states, staff_states = validate_denominator_semantics(ui_total, ui_staff)
    print(f'M5 browser corpus verified: UI_total={ui_total["total"]} across {sum(len(member["states"].split("/")) for member in ui_total["members"])} route-state cases, UI_staff_total={ui_staff["total"]} across {ui_staff["total"] * len(staff_states)} staff-state cases, evaluator={authority["corpusDigest"]}, zero skip/focus/quarantine markers')


if __name__ == '__main__':
    main()
