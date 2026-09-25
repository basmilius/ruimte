const DISPLAY_NAME_MAX_LENGTH = 100;

// A name a provider or an app hands over, as untrusted text: control characters out, whitespace folded, length capped.
export const cleanDisplayName = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }
    const folded = value
        .replace(/\p{Cc}/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return folded.length === 0 ? null : Array.from(folded).slice(0, DISPLAY_NAME_MAX_LENGTH).join('').trim();
};
