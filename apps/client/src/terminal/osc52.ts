// Past this a copy is a runaway program rather than a person's selection.
const MAX_BASE64 = 4 * 1024 * 1024;

/*
 * The text an OSC 52 sequence (`<selection>;<base64>`) asks to put on the clipboard. Null for a
 * query (`?`), which would hand the clipboard to whatever runs in the terminal, for an empty payload,
 * which asks to clear it, and for anything that is not base64.
 */
export const osc52Text = (data: string): string | null => {
    const separator = data.indexOf(';');
    const payload = separator < 0 ? '' : data.slice(separator + 1);
    if (payload === '' || payload === '?' || payload.length > MAX_BASE64) {
        return null;
    }
    try {
        const binary = atob(payload);
        return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
    } catch {
        return null;
    }
};
