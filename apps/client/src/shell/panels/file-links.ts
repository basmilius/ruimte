import { FileLocationSchema, type FileLocation } from '@ruimte/contracts';
import i18next from 'i18next';
import { create } from 'zustand';
import { ignoreRefusal, perform } from '@/actions/client-actions';
import { absoluteOf, basenameOf, isAbsolutePath } from '@/shell/panels/files-tree';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { machineTransport } from '@/transport';
import { machineAnswers } from '@/transport/features';

export interface FileRef extends FileLocation {
    directory: boolean;
    endpointId?: string;
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
    'glb',
    'gltf',
    'go',
    'gz',
    'gql',
    'graphql',
    'h',
    'hpp',
    'htm',
    'html',
    'ico',
    'ini',
    'java',
    'jar',
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
    'stl',
    'svelte',
    'svg',
    'swift',
    'tar',
    'tgz',
    'toml',
    'ts',
    'tsv',
    'tsx',
    'txt',
    'usdz',
    'vue',
    'webm',
    'webp',
    'xml',
    'yaml',
    'yml',
    'zip',
    'zsh'
]);

const EXTENSIONLESS_FILES = new Set(['changelog', 'dockerfile', 'gemfile', 'justfile', 'license', 'makefile', 'procfile', 'readme']);

/* Bare prose is stricter than a delimited link target. */
const NOT_IN_A_PATH = /[\s*?<>|"`]/;

/* A scheme belongs to a URL, so `https://x` and `mailto:me` are nobody's file. A drive letter is one
   character, which is why the pattern asks for two before the colon. */
const URL_SCHEME = /^[A-Za-z][A-Za-z\d+.-]+:/;

/* Sentence punctuation is outside a delimited path. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

function parseLineSuffix(text: string): FileLocation {
    const match = /^(.+?)(?::(\d+)(?::(\d+))?(?:-(\d+))?|#L(\d+)(?:C(\d+))?(?:-L?(\d+))?)$/.exec(text);
    if (!match) {
        return { path: text };
    }
    const line = Number(match[2] ?? match[5]);
    const column = match[3] ?? match[6];
    const endLine = match[4] ?? match[7];
    return {
        path: match[1]!,
        line,
        ...(column === undefined ? {} : { column: Number(column) }),
        ...(endLine === undefined ? {} : { endLine: Number(endLine) })
    };
}

/* A name that is nothing but a dot and one word is a dotfile (`.env`, `.gitignore`), not an extension. */
function isDotfile(name: string): boolean {
    return name.length > 1 && name.startsWith('.') && !name.slice(1).includes('.');
}

/*
 * The file an agent wrote down, or null where the text is just text. Text becomes a link on its
 * shape alone; where the file is, and whether it is there, is asked when the link is followed.
 */
export function parseFileRef(text: string, allowSpaces = false): FileRef | null {
    let token = text.trim().replace(TRAILING_PUNCTUATION, '');
    const quoted = /^(?:"([^"\r\n]+)"|'([^'\r\n]+)'|`([^`\r\n]+)`|<([^<>\r\n]+)>)(.*)$/.exec(token);
    if (quoted) {
        token = (quoted[1] ?? quoted[2] ?? quoted[3] ?? quoted[4])! + quoted[5]!;
        allowSpaces = true;
    }
    const hasControl = Array.from(token).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
    // A home-relative path resolves on the daemon's machine and against a home this side cannot name.
    if (token === '' || token.startsWith('~') || hasControl || (allowSpaces ? /[*?<>|"`]/.test(token) : NOT_IN_A_PATH.test(token))) {
        return null;
    }
    const location = FileLocationSchema.safeParse(parseLineSuffix(token));
    if (!location.success) {
        return null;
    }
    const { path, ...position } = location.data;
    if (URL_SCHEME.test(path)) {
        return null;
    }
    if (/[\\/]$/.test(path)) {
        return position.line === undefined ? { path, directory: true } : null;
    }
    // `./` says the same thing as nothing at all, and a bare `.` or `..` names no file.
    const normalized = path.replace(/^\.[\\/]/, '');
    const name = basenameOf(normalized);
    if (normalized === '' || name === '.' || name === '..') {
        return null;
    }
    const extension = /\.([A-Za-z\d]+)$/.exec(name)?.[1]?.toLowerCase();
    const separated = /[\\/]/.test(normalized);
    const known = separated || isDotfile(name) || EXTENSIONLESS_FILES.has(name.toLowerCase()) || (extension !== undefined && FILE_EXTENSIONS.has(extension));
    return known ? { path: normalized, ...position, directory: false } : null;
}

/*
 * The path without `.` and `..`, so one file reached two ways gets one tab. A `..` past the root stays
 * at the root; a relative path keeps the ones it cannot take back.
 */
export function normalizedPath(path: string): string {
    const separator = /^[a-zA-Z]:\\|^\\\\/.test(path) ? '\\' : '/';
    const root = /^[a-zA-Z]:[\\/]/.test(path) ? path.slice(0, 3) : /^[\\/]{2}/.test(path) ? path.slice(0, 2) : /^[\\/]/.test(path) ? path.slice(0, 1) : '';
    // On a POSIX machine a backslash is part of a name, so only a Windows path splits on it.
    const separators = /^[a-zA-Z]:[\\/]|^\\\\/.test(path) ? /[\\/]+/ : /\/+/;
    const parts: string[] = [];
    for (const part of path.slice(root.length).split(separators)) {
        if (part === '' || part === '.') {
            continue;
        }
        if (part !== '..') {
            parts.push(part);
        } else if (parts.length > 0 && parts.at(-1) !== '..') {
            parts.pop();
        } else if (root === '') {
            parts.push('..');
        }
    }
    return root + parts.join(separator) || path;
}

/* Where the file sits on the daemon's machine, or null when only a folder would say and none is known. */
export function resolveFileRef(cwd: string | null, ref: FileRef): string | null {
    if (isAbsolutePath(ref.path)) {
        return normalizedPath(ref.path);
    }
    return cwd === null ? null : normalizedPath(absoluteOf(cwd, ref.path));
}

interface FileChoice {
    matches: string[];
    ref: FileRef;
    endpointId: string;
}

/* The files one link could mean, while a person picks one in `FileChoiceDialog`. */
export const useFileChoice = create<{ choice: FileChoice | null }>(() => ({ choice: null }));

/*
 * Where the machine finds what the link names. Null when it cannot tell (an older machine, a failed
 * ask), and the link opens where it points, as it always did.
 */
async function located(cwd: string | null, ref: FileRef, path: string, endpointId: string): Promise<string[] | null> {
    const transport = machineTransport(endpointId);
    if (!machineAnswers(transport.connection, 'fs.locate')) {
        return null;
    }
    const { current, currentEndpointId } = useProject.getState();
    const folder = currentEndpointId === endpointId ? (current?.folder ?? null) : null;
    try {
        const { matches } = await transport.request('fs.locate', {
            path: isAbsolutePath(ref.path) ? path : ref.path,
            cwd: cwd ?? folder ?? path,
            ...(folder === null ? {} : { folder }),
            ...(ref.directory ? { directory: true } : {})
        });
        return matches;
    } catch {
        return null;
    }
}

/* A file opens as a tab in the preview, a folder is brought into view in the files panel, which is the only one of the two that can draw a directory. */
export async function openLocatedFile(path: string, ref: FileRef, endpointId: string): Promise<void> {
    if (ref.directory) {
        await perform('file.reveal', { path }).catch(ignoreRefusal);
        return;
    }
    await perform('file.preview', { path, line: ref.line, column: ref.column, endLine: ref.endLine, endpointId }).catch(ignoreRefusal);
}

/*
 * A reference followed. The machine is asked where it leads only now and not while it is drawn, since
 * every path of every message would cost a request and a message of yesterday may name a file gone
 * since. One place opens, more ask a person, none says so.
 */
export async function openFileLink(cwd: string | null, ref: FileRef, endpointId = ref.endpointId ?? currentEndpointId()): Promise<void> {
    if (endpointId !== currentEndpointId()) {
        useToasts.getState().show({ kind: 'error', title: i18next.t('panels:file.wrongMachine') });
        return;
    }
    const path = resolveFileRef(cwd, ref);
    if (path === null) {
        return;
    }
    const matches = await located(cwd, ref, path, endpointId);
    if (matches === null) {
        await openLocatedFile(path, ref, endpointId);
    } else if (matches.length === 0) {
        useToasts.getState().show({ kind: 'error', title: i18next.t('panels:file.notFound', { path: ref.path }) });
    } else if (matches.length === 1) {
        await openLocatedFile(matches[0]!, ref, endpointId);
    } else {
        useFileChoice.setState({ choice: { matches, ref, endpointId } });
    }
}
