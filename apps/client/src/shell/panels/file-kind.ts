/* The extension of a file name, lowercase and without the dot; a name that has none answers empty. */
export const extensionOf = (name: string): string => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown']);
const HTML_EXTENSIONS = new Set(['html', 'htm']);

export const isMarkdownName = (name: string): boolean => MARKDOWN_EXTENSIONS.has(extensionOf(name));

export const isHtmlName = (name: string): boolean => HTML_EXTENSIONS.has(extensionOf(name));
