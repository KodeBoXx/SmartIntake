/**
 * Frozen M3 timezone allow-list. Expression evaluation never consults host
 * Intl/tzdb data; sessions record this registry identity with their artifact.
 * Calendar operators themselves are timezone-independent.
 */
export const PINNED_TIMEZONE_DATABASE = 'IANA-tzdb-2025b-m3-subset-1';
export const PINNED_TIMEZONES = new Set([
  'UTC', 'Africa/Cairo', 'Africa/Johannesburg', 'America/Anchorage', 'America/Argentina/Buenos_Aires',
  'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/New_York', 'America/Phoenix',
  'America/Sao_Paulo', 'America/Toronto', 'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Kolkata', 'Asia/Seoul',
  'Asia/Singapore', 'Asia/Tokyo', 'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Melbourne',
  'Australia/Perth', 'Australia/Sydney', 'Europe/Amsterdam', 'Europe/Berlin', 'Europe/London',
  'Europe/Madrid', 'Europe/Paris', 'Europe/Rome', 'Europe/Stockholm', 'Pacific/Auckland', 'Pacific/Honolulu',
]);
