import { createContext, useContext, useMemo } from 'react';
import { runAsPerson } from '@/actions/client-actions';
import { absoluteOf, basenameOf, isAbsolutePath } from '@/shell/panels/files-tree';

export interface FileRef {
    /* As it was written: absolute, or relative to the folder the text is read in. */
    path: string;
    /* One-based, when the reference named a line. */
    line?: number;
    /* A trailing separator is the only thing that says a reference means a directory. */
    directory: boolean;
}

/*
 * The extensions a bare file name has to carry to read as a file, so `useFiles.getState` and `v1.2`
 * stay text where `README.md` does not. A reference with a separator in it needs no list:
 * `apps/client/src/main.tsx` already says what it is, whatever comes after the dot.
 */
const FILE_EXTENSIONS = new Set([
    'astro',
    'bash',
    'bat',
    'c',
    'cc',
    'cfg',
    'cjs',
    'conf',
    'cpp',
    'cs',
    'css',
    'csv',
    'cts',
    'fish',
    'gif',
    'go',
    'gql',
    'graphql',
    'h',
    'hpp',
    'htm',
    'html',
    'ico',
    'ini',
    'java',
    'jpeg',
    'jpg',
    'js',
    'json',
    'json5',
    'jsonc',
    'jsx',
    'kt',
    'kts',
    'less',
    'lock',
    'log',
    'md',
    'mdx',
    'mjs',
    'mov',
    'mp4',
    'mts',
    'pdf',
    'php',
    'png',
    'proto',
    'prisma',
    'ps1',
    'py',
    'rb',
    'rs',
    'sass',
    'scss',
    'sh',
    'sql',
    'svelte',
    'svg',
    'swift',
    'toml',
    'ts',
    'tsv',
    'tsx',
    'txt',
    'vue',
    'webm',
    'webp',
    'xml',
    'yaml',
    'yml',
    'zsh'
]);

const EXTENSIONLESS_FILES = new Set(['changelog', 'dockerfile', 'gemfile', 'justfile', 'license', 'makefile', 'procfile', 'readme']);

/* Characters no path a person means carries; a glob or a sentence fragment ends here. */
const NOT_IN_A_PATH = /[\s*?<>|"`]/;

/* A scheme belongs to a URL, so `https://x` and `mailto:me` are nobody's file. A drive letter is one
   character, which is why the pattern asks for two before the colon. */
const URL_SCHEME = /^[A-Za-z][A-Za-z\d+.-]+:/;

/* Punctuation a sentence leaves on the end of a path. A line number is taken off before this runs. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/* `path:42`, `path:42:7` and `path#L42` all name a line; the column is read and dropped, since the
   viewer scrolls to lines. */
const parseLineSuffix = (text: string): { path: string; line?: number } => {
    const hash = /^(.+?)#L(\d+)$/.exec(text);
    if (hash) {
        return { path: hash[1]!, line: Number(hash[2]) };
    }
    const colon = /^(.+?):(\d+)(?::\d+)?$/.exec(text);
    if (colon) {
        return { path: colon[1]!, line: Number(colon[2]) };
    }
    return { path: text };
};

/* A name that is nothing but a dot and one word is a dotfile (`.env`, `.gitignore`), not an extension. */
const isDotfile = (name: string): boolean => name.length > 1 && name.startsWith('.') && !name.slice(1).includes('.');

/*
 * The file an agent wrote down, or null where the text is just text. Text becomes a link on its
 * shape alone: nothing here asks the daemon whether the file is there, since a read costs a whole
 * file and the viewer already says so when it cannot open one.
 */
export const parseFileRef = (text: string): FileRef | null => {
    const token = text.trim().replace(TRAILING_PUNCTUATION, '');
    // A home-relative path resolves on the daemon's machine and against a home this side cannot name.
    if (token === '' || token.startsWith('~') || NOT_IN_A_PATH.test(token) || URL_SCHEME.test(token)) {
        return null;
    }
    if (/[\\/]$/.test(token)) {
        return { path: token, directory: true };
    }
    const { path, line } = parseLineSuffix(token);
    // `./` says the same thing as nothing at all, and a bare `.` or `..` names no file.
    const normalized = path.replace(/^\.[\\/]/, '');
    const name = basenameOf(normalized);
    if (normalized === '' || name === '.' || name === '..') {
        return null;
    }
    const extension = /\.([A-Za-z\d]+)$/.exec(name)?.[1]?.toLowerCase();
    const separated = /[\\/]/.test(normalized);
    const known = isDotfile(name) || EXTENSIONLESS_FILES.has(name.toLowerCase()) || (extension !== undefined && (separated || FILE_EXTENSIONS.has(extension)));
    return known ? { path: normalized, ...(line === undefined ? {} : { line }), directory: false } : null;
};

/* Where the file sits on the daemon's machine, or null when only a folder would say and none is known. */
export const resolveFileRef = (cwd: string | null, ref: FileRef): string | null => {
    if (isAbsolutePath(ref.path)) {
        return ref.path.replace(/[\\/]+$/, '') || ref.path;
    }
    return cwd === null ? null : absoluteOf(cwd, ref.path);
};

/*
 * A reference followed: a file opens as a tab in the preview, a folder is brought into view in the
 * files panel, which is the only one of the two that can draw a directory.
 */
export const openFileLink = async (cwd: string | null, ref: FileRef): Promise<void> => {
    const path = resolveFileRef(cwd, ref);
    if (path === null) {
        return;
    }
    if (ref.directory) {
        await runAsPerson('file.reveal', { path });
        return;
    }
    await runAsPerson('file.preview', { path, line: ref.line ?? null });
};

/*
 * The folder a relative reference in rendered text counts from: a chat's own cwd, which is a
 * worktree as often as it is the project, the folder of the file the preview is drawing, or the
 * project itself. Null where nobody said, and there only an absolute path is a link.
 */
export const FileLinkContext = createContext<string | null>(null);

export const useFileLinkCwd = (): string | null => useContext(FileLinkContext);

/* The reference a piece of text names, only where this spot on screen could open it. */
export const useFileLinkTarget = (text: string): FileRef | null => {
    const cwd = useFileLinkCwd();
    return useMemo(() => {
        const ref = parseFileRef(text);
        return ref === null || resolveFileRef(cwd, ref) === null ? null : ref;
    }, [text, cwd]);
};
