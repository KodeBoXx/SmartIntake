import { describe, expect, it, beforeEach } from 'vitest';
import { AUTHORING_STORAGE_PREFIX, authoringStorageKey, clearAuthoringStorage } from './authoring-cache';

describe('authoring cache', () => {
  beforeEach(() => localStorage.clear());

  it('namespaces draft state by account identity', () => {
    expect(authoringStorageKey('account-one', 'workspace', 'form', 'draft'))
      .not.toBe(authoringStorageKey('account-two', 'workspace', 'form', 'draft'));
  });

  it('clears only SmartIntake authoring entries', () => {
    localStorage.setItem(`${AUTHORING_STORAGE_PREFIX}account-one.workspace.form.draft`, 'draft');
    localStorage.setItem('unrelated.preference', 'keep');

    clearAuthoringStorage();

    expect(localStorage.getItem(`${AUTHORING_STORAGE_PREFIX}account-one.workspace.form.draft`)).toBeNull();
    expect(localStorage.getItem('unrelated.preference')).toBe('keep');
  });
});
