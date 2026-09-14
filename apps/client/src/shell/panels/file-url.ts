/*
 * The same file as a page the desktop shell can load. Every segment is percent-encoded, so a space,
 * a `#` or a `?` in a folder name stays part of the path instead of starting a fragment or a query,
 * and the page keeps the folder as its base: assets next to it resolve on their own.
 */
export const localFileUrl = (path: string): string => {
    const slashed = path.replaceAll('\\', '/');
    // A Windows path opens on its drive letter; the URL's own root goes in front of it.
    const rooted = slashed.startsWith('/') ? slashed : `/${slashed}`;
    return `file://${rooted.split('/').map(encodeURIComponent).join('/')}`;
};
