import { isImageMime } from '@ruimte/contracts';

/* The extension of a file name, lowercase and without the dot; a name that has none answers empty. */
export const extensionOf = (name: string): string => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown']);
const HTML_EXTENSIONS = new Set(['html', 'htm']);

export const isMarkdownName = (name: string): boolean => MARKDOWN_EXTENSIONS.has(extensionOf(name));

export const isHtmlName = (name: string): boolean => HTML_EXTENSIONS.has(extensionOf(name));

// The daemon serves these for a client whose platform decodes them; Chromium decodes none of the three.
const UNDRAWN_IMAGE_MIMES = new Set(['image/heic', 'image/heif', 'image/tiff']);

/* Whether this app draws an image of this type, known before a byte of it is fetched. */
export const drawsImageMime = (mime: string): boolean => isImageMime(mime) && !UNDRAWN_IMAGE_MIMES.has(mime);

/* The name a person knows an image format by: `image/heic` is HEIC. */
export const imageFormatName = (mime: string): string => mime.replace(/^image\//, '').toUpperCase();
