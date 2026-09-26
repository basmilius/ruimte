/* The IANA time zone this machine is set to, or null when the runtime does not say. */
export const localTimeZone = (): string | null => Intl.DateTimeFormat().resolvedOptions().timeZone || null;
