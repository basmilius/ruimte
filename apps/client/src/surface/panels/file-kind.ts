import { isImageMime } from '@ruimte/contracts';

/* The extension of a file name, lowercase and without the dot; a name that has none answers empty. */
export function extensionOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown']);
const HTML_EXTENSIONS = new Set(['html', 'htm']);

const PATCH_EXTENSIONS = new Set(['patch', 'diff']);
const DELIMITED_EXTENSIONS = new Set(['csv', 'tsv']);

export function isPatchName(name: string): boolean {
    return PATCH_EXTENSIONS.has(extensionOf(name));
}

export function isMarkdownName(name: string): boolean {
    return MARKDOWN_EXTENSIONS.has(extensionOf(name));
}

export function isHtmlName(name: string): boolean {
    return HTML_EXTENSIONS.has(extensionOf(name));
}

export function isDelimitedName(name: string): boolean {
    return DELIMITED_EXTENSIONS.has(extensionOf(name));
}

// TIFF still needs a platform decoder; HEIC and HEIF go through the shared display decoder.
const UNDRAWN_IMAGE_MIMES = new Set(['image/tiff']);

/* Whether this app draws an image of this type, known before a byte of it is fetched. */
export function drawsImageMime(mime: string): boolean {
    return isImageMime(mime) && !UNDRAWN_IMAGE_MIMES.has(mime);
}

/* The name a person knows an image format by: `image/heic` is HEIC. */
export function imageFormatName(mime: string): string {
    return mime.replace(/^image\//, '').toUpperCase();
}
