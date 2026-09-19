import registry from '../../../../backend/src/main/resources/contracts/m3-timezone-registry.json';

/**
 * The Java runtime classpath and browser bundle consume this exact checked-in
 * registry. It is generated from IANA tzdata 2025b and never falls back to the
 * host's Intl/tzdb data.
 */
export const PINNED_TIMEZONE_DATABASE = registry.version;
export const PINNED_TIMEZONE_REGISTRY_SHA256 = registry.zoneIdentifiersSha256;
export const PINNED_TIMEZONES = new Set(registry.zoneIdentifiers);
