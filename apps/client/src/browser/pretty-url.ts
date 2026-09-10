const HTTPS = 'https://';

/*
 * The address as a person reads it: `https://` carries no information, since it is what the web is,
 * and a bare origin has no path to end in a slash. Everything else stays whole. `http://` is a
 * warning and keeps its scheme, and so do `file:` and every other scheme; a path that really ends
 * in a slash keeps it, because there the slash is part of the address.
 */
export const prettyUrl = (url: string): string => {
    if (!url.startsWith(HTTPS)) {
        return url;
    }
    const rest = url.slice(HTTPS.length);
    if (rest === '') {
        return url;
    }
    const withoutSlash = rest.slice(0, -1);
    return rest.endsWith('/') && !withoutSlash.includes('/') ? withoutSlash : rest;
};
