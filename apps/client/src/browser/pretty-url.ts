const HTTPS = 'https://';

/*
 * The address as a person reads it: `https://` is what the web defaults to, and a bare origin has no
 * path to end in a slash, so both go. `http://` is a warning and stays, like every other scheme and
 * the slash at the end of a real path.
 */
export function prettyUrl(url: string): string {
    if (!url.startsWith(HTTPS)) {
        return url;
    }
    const rest = url.slice(HTTPS.length);
    if (rest === '') {
        return url;
    }
    const withoutSlash = rest.slice(0, -1);
    return rest.endsWith('/') && !withoutSlash.includes('/') ? withoutSlash : rest;
}
