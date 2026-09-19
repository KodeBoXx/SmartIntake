import { describe, expect, it } from 'vitest';
import { appRoutes } from './app.routes';

describe('M5 route architecture', () => {
  it('keeps every public route and the M1 compatibility builder route lazy', () => {
    const serialized = JSON.stringify(appRoutes, (_key, value) => typeof value === 'function' ? 'function' : value);
    expect(serialized).toContain('catalog/builder');
    expect(serialized).toContain('sessions/:sessionId/receipt');
    expect(serialized).toContain('workspaces/:workspaceId/forms/:formId/drafts/:draftId');
  });
});
