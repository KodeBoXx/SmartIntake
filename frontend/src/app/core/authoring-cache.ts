export const AUTHORING_STORAGE_PREFIX = 'smart-intake.authoring.';

export function authoringStorageKey(accountId: string | null | undefined, workspaceId: string, formId: string, draftId: string): string {
  const account = accountId?.trim() || 'unidentified';
  return `${AUTHORING_STORAGE_PREFIX}${encodeURIComponent(account)}.${encodeURIComponent(workspaceId)}.${encodeURIComponent(formId)}.${encodeURIComponent(draftId)}`;
}

export function clearAuthoringStorage(storage: Storage = localStorage): void {
  try {
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key?.startsWith(AUTHORING_STORAGE_PREFIX)) storage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable in private browsing contexts.
  }
}
