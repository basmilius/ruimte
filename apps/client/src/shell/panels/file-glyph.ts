import { File, FileCode, FileImage, FileJson, FileText, type LucideIcon } from 'lucide-react';

const BY_EXTENSION: Record<string, LucideIcon> = {
    avif: FileImage,
    css: FileCode,
    gif: FileImage,
    go: FileCode,
    html: FileCode,
    ico: FileImage,
    js: FileCode,
    json: FileJson,
    jsonc: FileJson,
    jpeg: FileImage,
    jpg: FileImage,
    jsx: FileCode,
    md: FileText,
    mdx: FileText,
    php: FileCode,
    png: FileImage,
    py: FileCode,
    rs: FileCode,
    svg: FileImage,
    ts: FileCode,
    tsx: FileCode,
    txt: FileText,
    webp: FileImage,
    yaml: FileCode,
    yml: FileCode
};

/* The glyph on a viewer tab. The tree draws its own icons inside a shadow root nothing here can
   reach, so a tab picks a Lucide one by extension and stays in the app's own icon set. */
export const fileGlyph = (name: string): LucideIcon => {
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    return BY_EXTENSION[extension] ?? File;
};
