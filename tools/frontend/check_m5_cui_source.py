#!/usr/bin/env python3
"""Prevent new M5 shells from replacing available Cui primitives with HTML equivalents."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'frontend/src/app'
FORBIDDEN = re.compile(r'<\s*/?\s*(?:button|select|table|input)\b', re.IGNORECASE)
REQUIRED: dict[str, tuple[set[str], set[str]]] = {
    'shells/app-root.component.ts': ({'CuiToastHostComponent'}, {'cui-toast-host'}),
    'shells/staff-shell.component.ts': ({'CuiAppShellComponent', 'CuiHeaderComponent', 'CuiNavItemComponent', 'CuiSidebarShellComponent'}, {'cui-app-shell', 'cui-header', 'cui-nav-item', 'cui-sidebar-shell'}),
    'shells/public-shell.component.ts': ({'CuiCardComponent'}, {'cui-card'}),
    'features/auth/auth-page.component.ts': ({'CuiAlertComponent', 'CuiButtonComponent', 'CuiCardComponent', 'CuiInputComponent'}, {'cui-alert', 'cui-button', 'cui-card', 'cui-input'}),
    'features/public/public-page.component.ts': ({'CuiAlertComponent', 'CuiButtonComponent', 'CuiCardComponent', 'CuiEmptyStateComponent', 'CuiInputComponent'}, {'cui-alert', 'cui-button', 'cui-card', 'cui-empty-state', 'cui-input'}),
    'features/staff/not-found.component.ts': ({'CuiButtonComponent', 'CuiEmptyStateComponent'}, {'cui-button', 'cui-empty-state'}),
    'features/staff/staff-page.component.ts': ({'CuiAlertComponent', 'CuiButtonComponent', 'CuiCardComponent', 'CuiConfirmDialogComponent', 'CuiDataTableComponent', 'CuiDrawerComponent', 'CuiDropdownComponent', 'CuiEmptyStateComponent', 'CuiIconComponent', 'CuiPopoverComponent', 'CuiStatsStripComponent', 'CuiToastService'}, {'cui-alert', 'cui-button', 'cui-card', 'cui-confirm-dialog', 'cui-data-table', 'cui-drawer', 'cui-dropdown', 'cui-empty-state', 'cui-icon', 'cui-popover', 'cui-stats-strip'}),
}


def fail(message: str) -> None:
    print(f'M5 Cui source guard failed: {message}', file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    checked = 0
    for relative, (imports, selectors) in REQUIRED.items():
        path = SOURCE / relative
        content = path.read_text()
        forbidden = FORBIDDEN.search(content)
        if forbidden:
            fail(f'{relative} contains bespoke <{forbidden.group(0).split("<")[-1].strip()}> control markup')
        missing_imports = sorted(name for name in imports if name not in content)
        if missing_imports:
            fail(f'{relative} is missing required Cui imports: {missing_imports}')
        missing_selectors = sorted(selector for selector in selectors if f'<{selector}' not in content)
        if missing_selectors:
            fail(f'{relative} is missing required Cui selectors: {missing_selectors}')
        checked += 1
    print(f'M5 Cui source guard verified {checked} shell/feature sources with no bespoke control equivalents')


if __name__ == '__main__':
    main()
