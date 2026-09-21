export const FROZEN_STAFF_SCREENS = [
  'sign-in', 'setup', 'activation', 'recovery', 'platform-organizations', 'organization-settings',
  'user-list', 'add-user', 'user-detail', 'role-assignment', 'invitation-delivery', 'catalog',
  'builder', 'review-publish', 'responses', 'response-detail', 'export-history', 'provider-policy',
] as const;

/** The frozen UI_staff_total denominator uses these six state categories for every staff screen. */
export const REQUIRED_STAFF_STATES = ['loading', 'empty-or-no-access', 'invalid', 'denied', 'expired', 'email-unavailable'] as const;
export type FrozenStaffScreen = typeof FROZEN_STAFF_SCREENS[number];
