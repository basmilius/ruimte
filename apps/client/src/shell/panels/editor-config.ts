import type { FsReadResult } from '@ruimte/contracts';
import type { EditorIndentation } from '@adecore/editor';
import { dirnameOf } from '@/shell/panels/files-tree';
import { isUnderFolder } from '@/state/fs-watch';

export const DEFAULT_INDENTATION: EditorIndentation = { tabSize: 4, insertSpaces: true };

const MIN_TAB_SIZE = 1;
const MAX_TAB_SIZE = 16;

export interface EditorConfigSection {
    glob: string;
    properties: Readonly<Record<string, string>>;
}

export interface EditorConfig {
    /* Stops the search for more files further up. */
    root: boolean;
    sections: readonly EditorConfigSection[];
}

/* One `.editorconfig` and the folder it sits in. */
export interface EditorConfigFile {
    dir: string;
    config: EditorConfig;
}

/* Keys and values compare in lowercase, as the format says. A line it cannot read is skipped. */
export function parseEditorConfig(text: string): EditorConfig {
    let root = false;
    const sections: { glob: string; properties: Record<string, string> }[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line === '' || line.startsWith('#') || line.startsWith(';')) {
            continue;
        }
        if (line.startsWith('[') && line.endsWith(']')) {
            sections.push({ glob: line.slice(1, -1), properties: {} });
            continue;
        }
        const cut = line.indexOf('=');
        if (cut < 1) {
            continue;
        }
        const key = line.slice(0, cut).trim().toLowerCase();
        const value = line
            .slice(cut + 1)
            .trim()
            .toLowerCase();
        const section = sections.at(-1);
        if (section === undefined) {
            if (key === 'root') {
                root = value === 'true';
            }
        } else {
            section.properties[key] = value;
        }
    }
    return { root, sections };
}

/* The glob of a section as a regular expression over a path relative to the file's folder: `*`, `**`, `?`, `[set]`, `[!set]`, `{a,b}`, `{1..3}` and `\` escapes. */
export function globToRegExp(glob: string): RegExp {
    // A pattern with a slash is anchored to the file's folder; one without matches a name at any depth.
    const anchored = glob.replace(/^\//, '');
    const pattern = glob.includes('/') ? anchored : `**/${anchored}`;
    let source = '';
    let braces = 0;
    for (let i = 0; i < pattern.length; i++) {
        const character = pattern[i]!;
        if (character === '\\' && i + 1 < pattern.length) {
            source += escapeRegExp(pattern[++i]!);
        } else if (character === '*') {
            if (pattern[i + 1] === '*') {
                i++;
                // `**/` also matches nothing, so `**/a` finds `a` at the top.
                if (pattern[i + 1] === '/') {
                    i++;
                    source += '(?:.*/)?';
                } else {
                    source += '.*';
                }
            } else {
                source += '[^/]*';
            }
        } else if (character === '?') {
            source += '[^/]';
        } else if (character === '[') {
            const close = pattern.indexOf(']', i + 2);
            if (close === -1) {
                source += '\\[';
            } else {
                const set = pattern.slice(i + 1, close);
                source += set.startsWith('!') ? `[^${escapeSet(set.slice(1))}]` : `[${escapeSet(set)}]`;
                i = close;
            }
        } else if (character === '{') {
            const close = matchingBrace(pattern, i);
            const body = close === -1 ? null : pattern.slice(i + 1, close);
            const range = body === null ? null : /^(-?\d+)\.\.(-?\d+)$/.exec(body);
            if (range !== null) {
                source += `(?:${numberRange(Number(range[1]), Number(range[2]))})`;
                i = close;
            } else if (body !== null && body.includes(',')) {
                braces++;
                source += '(?:';
            } else {
                source += '\\{';
            }
        } else if (character === '}' && braces > 0) {
            braces--;
            source += ')';
        } else if (character === ',' && braces > 0) {
            source += '|';
        } else {
            source += escapeRegExp(character);
        }
    }
    return new RegExp(`^${source}$`);
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function escapeSet(text: string): string {
    return text.replace(/[\]\\^]/g, '\\$&');
}

function matchingBrace(text: string, open: number): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '\\') {
            i++;
        } else if (text[i] === '{') {
            depth++;
        } else if (text[i] === '}' && --depth === 0) {
            return i;
        }
    }
    return -1;
}

function numberRange(from: number, to: number): string {
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    // A range this wide is a typo, and spelling it out would make a pattern nobody can run.
    if (high - low > 1000) {
        return '-?\\d+';
    }
    return Array.from({ length: high - low + 1 }, (_, i) => String(low + i)).join('|');
}

/* A path below a folder, with forward slashes, or null when it is not below it. */
function relativeTo(dir: string, path: string): string | null {
    return isUnderFolder(path, dir) ? path.slice(dir.length + 1).replace(/\\/g, '/') : null;
}

function sizeOf(value: string | undefined): number | undefined {
    const size = value === undefined ? Number.NaN : Number(value);
    return Number.isInteger(size) && size >= MIN_TAB_SIZE && size <= MAX_TAB_SIZE ? size : undefined;
}

/*
 * The indentation the `.editorconfig` files say a path gets, nearest file first. Sections of a nearer
 * file win over a farther one and later sections over earlier ones; a file with `root = true` ends the
 * walk. What no file says is left out.
 */
export function resolveIndentation(files: readonly EditorConfigFile[], path: string): Partial<EditorIndentation> {
    const properties = resolveProperties(files, path);
    const style = properties.indent_style;
    const indentSize = properties.indent_size === 'tab' ? undefined : sizeOf(properties.indent_size);
    const tabWidth = sizeOf(properties.tab_width);
    const tabSize = style === 'tab' ? (tabWidth ?? indentSize) : (indentSize ?? tabWidth);
    return {
        ...(tabSize === undefined ? {} : { tabSize }),
        ...(style === 'tab' ? { insertSpaces: false } : style === 'space' ? { insertSpaces: true } : {})
    };
}

/* The longest line a path is held to, or null when the files name no number (`off` included). */
export function resolveMaxLineLength(files: readonly EditorConfigFile[], path: string): number | null {
    const value = Number(resolveProperties(files, path).max_line_length);
    return Number.isInteger(value) && value > 0 ? value : null;
}

/* What the sections that apply to a path say, nearest file first winning and later sections over earlier ones. */
function resolveProperties(files: readonly EditorConfigFile[], path: string): Record<string, string> {
    const properties: Record<string, string> = {};
    const rootAt = files.findIndex((file) => file.config.root);
    const applicable = rootAt === -1 ? files : files.slice(0, rootAt + 1);
    for (const file of [...applicable].reverse()) {
        const relative = relativeTo(file.dir, path);
        if (relative === null) {
            continue;
        }
        for (const section of file.config.sections) {
            if (globToRegExp(section.glob).test(relative)) {
                Object.assign(properties, section.properties);
            }
        }
    }
    return properties;
}

/* The folders a file's `.editorconfig` files can be in, nearest first, up to the project folder it is in or, outside one, the file's own. */
export function editorConfigDirs(path: string, roots: readonly string[]): string[] {
    const root = roots.filter((candidate) => isUnderFolder(path, candidate)).sort((left, right) => right.length - left.length)[0];
    const dirs: string[] = [];
    let dir = dirnameOf(path);
    while (dirs.length < 64) {
        dirs.push(dir);
        if (root === undefined || dir === root || !isUnderFolder(dir, root)) {
            break;
        }
        dir = dirnameOf(dir);
    }
    return dirs;
}

export type ReadText = (path: string) => Promise<FsReadResult>;

/* Reads the files nearest first and stops at one that is a root. A folder with none, or one that cannot be read, has none. */
export async function loadEditorConfigs(path: string, roots: readonly string[], read: ReadText): Promise<EditorConfigFile[]> {
    const files: EditorConfigFile[] = [];
    for (const dir of editorConfigDirs(path, roots)) {
        const result = await read(`${dir}/.editorconfig`).catch(() => null);
        if (result?.kind === 'text') {
            const config = parseEditorConfig(result.text);
            files.push({ dir, config });
            if (config.root) {
                break;
            }
        }
    }
    return files;
}

/* What the project's `.editorconfig` files say for a file, over the defaults. */
export async function indentationFor(path: string, roots: readonly string[], read: ReadText): Promise<EditorIndentation> {
    return (await editorStyleFor(path, roots, read)).indentation;
}

export interface EditorStyle {
    indentation: EditorIndentation;
    /* The column a line is held to, drawn as a line in the editor; null when no file names one. */
    maxLineLength: number | null;
}

/* The indentation and the line length the `.editorconfig` files say for a file, read once. */
export async function editorStyleFor(path: string, roots: readonly string[], read: ReadText): Promise<EditorStyle> {
    const files = await loadEditorConfigs(path, roots, read);
    return { indentation: { ...DEFAULT_INDENTATION, ...resolveIndentation(files, path) }, maxLineLength: resolveMaxLineLength(files, path) };
}
