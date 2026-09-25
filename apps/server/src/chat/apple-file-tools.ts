import { constants, type Stats } from 'node:fs';
import { lstat, open, opendir, realpath, stat, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { isBuildOutput } from '../fs/visibility.ts';
import type { AppleToolCall, AppleToolResult } from './apple-tools.ts';

const MAX_OUTPUT_BYTES = 6000;
const MAX_FILE_BYTES = 256 * 1024;
const VISIBLE_DOTFILES = new Set(['.gitignore', '.gitattributes', '.editorconfig']);
const PROTECTED_NAMES = /^(?:credentials?(?:\..*)?|secrets?(?:\..*)?|auth\.json|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|p12|pfx|keystore))$/i;
const permittedName = (name: string): boolean => (!name.startsWith('.') || VISIBLE_DOTFILES.has(name)) && !PROTECTED_NAMES.test(name);

type FileCall = Extract<AppleToolCall, { name: 'list_files' | 'read_file' | 'search_files' | 'edit_file' | 'write_file' }>;
interface CheckedPath {
    root: string;
    target: string;
    path: string;
}

const checkedPath = async (cwd: string, path: string, signal?: AbortSignal, create = false): Promise<CheckedPath> => {
    signal?.throwIfAborted();
    if (!path || isAbsolute(path) || path.includes('\\') || path.includes('\0') || Buffer.byteLength(path) > 1024) {
        throw new Error('Use a relative project path of at most 1024 bytes.');
    }
    const parts = path.split('/').filter((part) => part !== '' && part !== '.');
    if (parts.some((part) => part === '..' || !permittedName(part))) {
        throw new Error('Parent traversal, hidden state, and credential files are unavailable.');
    }
    const root = await realpath(cwd);
    let target = root;
    for (const [index, part] of parts.entries()) {
        target = join(target, part);
        if (create && index === parts.length - 1) {
            break;
        }
        if ((await lstat(target)).isSymbolicLink()) {
            throw new Error('Symbolic links are unavailable in this PoC.');
        }
    }
    await verifyPath(root, create ? dirname(target) : target);
    signal?.throwIfAborted();
    return { root, target, path: parts.join('/') || '.' };
};

const verifyPath = async (root: string, target: string): Promise<void> => {
    const resolved = await realpath(target);
    const local = relative(root, resolved);
    if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local) || resolved !== target) {
        throw new Error('The path changed or leaves the project folder.');
    }
};

const sameFile = (before: Stats, after: Stats): boolean =>
    before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;

const textFromBytes = (bytes: Uint8Array): string => {
    if (bytes.some((byte) => (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) || byte === 127)) {
        throw new Error('Binary files are unavailable.');
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
};

const readOpened = async (handle: FileHandle, signal?: AbortSignal): Promise<{ text: string; metadata: Stats }> => {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_FILE_BYTES) {
        throw new Error('Only regular text files of at most 256 KiB are available.');
    }
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
        signal?.throwIfAborted();
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (bytesRead === 0) {
            break;
        }
        length += bytesRead;
    }
    if (length > MAX_FILE_BYTES || !sameFile(before, await handle.stat())) {
        throw new Error('The file changed during the read or exceeds 256 KiB.');
    }
    signal?.throwIfAborted();
    return { text: textFromBytes(buffer.subarray(0, length)), metadata: before };
};

const readSnapshot = async (checked: CheckedPath, signal?: AbortSignal): Promise<{ text: string; metadata: Stats }> => {
    const handle = await open(checked.target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const snapshot = await readOpened(handle, signal);
        await verifyPath(checked.root, checked.target);
        if (!sameFile(snapshot.metadata, await stat(checked.target))) {
            throw new Error('The file changed during the read.');
        }
        signal?.throwIfAborted();
        return snapshot;
    } finally {
        await handle.close();
    }
};

const listFiles = async (cwd: string, path: string, signal?: AbortSignal): Promise<string> => {
    const checked = await checkedPath(cwd, path, signal);
    const directory = await opendir(checked.target);
    const entries: Array<{ name: string; kind: 'directory' | 'file' }> = [];
    let truncated = false;
    let scanned = 0;
    for await (const entry of directory) {
        signal?.throwIfAborted();
        if (++scanned > 1000) {
            truncated = true;
            break;
        }
        if (!permittedName(entry.name) || (!entry.isFile() && !entry.isDirectory())) {
            continue;
        }
        const next = { name: entry.name, kind: entry.isDirectory() ? ('directory' as const) : ('file' as const) };
        if (
            entries.length === 40 ||
            Buffer.byteLength(JSON.stringify({ path: checked.path, entries: [...entries, next], truncated: false })) > MAX_OUTPUT_BYTES
        ) {
            truncated = true;
            break;
        }
        entries.push(next);
    }
    await verifyPath(checked.root, checked.target);
    signal?.throwIfAborted();
    entries.sort((left, right) => left.name.localeCompare(right.name));
    return JSON.stringify({ path: checked.path, entries, truncated });
};

const readFile = async (cwd: string, path: string, offset: number, limit = 100, signal?: AbortSignal): Promise<string> => {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('Use a nonnegative line offset and a line limit from 1 through 100.');
    }
    const checked = await checkedPath(cwd, path, signal);
    const { text } = await readSnapshot(checked, signal);
    const lines = text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n');
    if (text.endsWith('\n')) {
        lines.pop();
    }
    if (offset > lines.length) {
        throw new Error(`The line offset exceeds the file's ${lines.length} lines.`);
    }
    let end = Math.min(offset + limit, lines.length);
    const result = () =>
        JSON.stringify({
            path: checked.path,
            offset,
            totalLines: lines.length,
            content: lines.slice(offset, end).join('\n'),
            nextOffset: end < lines.length ? end : null,
            truncated: end < lines.length,
            ...(end < lines.length ? { notice: 'Partial file. Continue Read at nextOffset to read the remaining lines.' } : {})
        });
    while (Buffer.byteLength(result()) > MAX_OUTPUT_BYTES && end > offset) {
        end--;
    }
    if (end === offset && offset < lines.length) {
        throw new Error('This line exceeds the 6000-byte tool output limit.');
    }
    signal?.throwIfAborted();
    return result();
};

interface IgnoreRule {
    base: string;
    pattern: Bun.Glob;
    basenameOnly: boolean;
}

const readIgnores = async (cwd: string, path: string, signal?: AbortSignal): Promise<IgnoreRule[]> => {
    try {
        const checked = await checkedPath(cwd, path === '.' ? '.gitignore' : `${path}/.gitignore`, signal);
        const { text } = await readSnapshot(checked, signal);
        if (Buffer.byteLength(text) > 8192) {
            return [];
        }
        // Conservatively keep exclusions: negated rules never reopen a path for this bounded search.
        return text
            .split(/\r?\n/)
            .slice(0, 200)
            .flatMap((line) => {
                const pattern = line.trim();
                if (!pattern || pattern.startsWith('#') || pattern.startsWith('!') || pattern.includes('\\')) {
                    return [];
                }
                const normalized = pattern.replace(/^\//, '').replace(/\/$/, '');
                return [
                    {
                        base: path === '.' ? '' : `${path}/`,
                        pattern: new Bun.Glob(normalized),
                        basenameOnly: !normalized.includes('/') && !pattern.startsWith('/')
                    }
                ];
            });
    } catch {
        signal?.throwIfAborted();
        return [];
    }
};

const searchFiles = async (cwd: string, call: Extract<FileCall, { name: 'search_files' }>, signal?: AbortSignal): Promise<string> => {
    if (!call.query || Buffer.byteLength(call.query) > 1024) {
        throw new Error('Use a nonempty literal query of at most 1024 bytes.');
    }
    const start = await checkedPath(cwd, call.path, signal);
    const filter = call.glob ? new Bun.Glob(call.glob) : null;
    const matches: Array<{ path: string; line: number; text: string }> = [];
    const rootRules = await readIgnores(cwd, '.', signal);
    const queue = [{ path: start.path, depth: 0, rules: rootRules }];
    let scanned = 0;
    let files = 0;
    let bytes = 0;
    let truncated = false;
    let skipped = 0;
    search: while (queue.length > 0) {
        signal?.throwIfAborted();
        const current = queue.shift()!;
        const checked = await checkedPath(cwd, current.path, signal);
        const rules = current.path === '.' ? current.rules : [...current.rules, ...(await readIgnores(cwd, current.path, signal))];
        const directory = await opendir(checked.target);
        for await (const entry of directory) {
            signal?.throwIfAborted();
            if (++scanned > 2000 || files >= 200 || bytes >= 4 * 1024 * 1024) {
                truncated = true;
                break search;
            }
            const path = current.path === '.' ? entry.name : `${current.path}/${entry.name}`;
            if (
                !permittedName(entry.name) ||
                isBuildOutput(entry.name) ||
                rules.some((rule) => path.startsWith(rule.base) && rule.pattern.match(rule.basenameOnly ? entry.name : path.slice(rule.base.length)))
            ) {
                continue;
            }
            if (entry.isDirectory()) {
                if (current.depth < 8) {
                    queue.push({ path, depth: current.depth + 1, rules });
                } else {
                    truncated = true;
                }
                continue;
            }
            if (!entry.isFile() || (filter && !filter.match(relative(start.target, join(checked.target, entry.name))) && !filter.match(entry.name))) {
                continue;
            }
            files++;
            let text: string;
            try {
                const snapshot = await readSnapshot(await checkedPath(cwd, path, signal), signal);
                text = snapshot.text;
                bytes += snapshot.metadata.size;
            } catch {
                signal?.throwIfAborted();
                skipped++;
                continue;
            }
            for (const [index, line] of text.split(/\r?\n/).entries()) {
                const found = line.indexOf(call.query);
                if (found < 0) {
                    continue;
                }
                const next = { path, line: index + 1, text: line.slice(Math.max(0, found - 60), found + 180) };
                if (
                    matches.length >= 30 ||
                    Buffer.byteLength(JSON.stringify({ matches: [...matches, next], truncated: false, scannedFiles: files, skippedFiles: skipped })) >
                        MAX_OUTPUT_BYTES - 100
                ) {
                    truncated = true;
                    break search;
                }
                matches.push(next);
            }
        }
        await verifyPath(checked.root, checked.target);
    }
    signal?.throwIfAborted();
    return JSON.stringify({ matches, truncated, scannedFiles: files, skippedFiles: skipped });
};

const writeFile = async (cwd: string, call: Extract<FileCall, { name: 'write_file' }>, signal?: AbortSignal): Promise<AppleToolResult> => {
    const bytes = Buffer.from(call.content);
    if (bytes.length > MAX_FILE_BYTES) {
        throw new Error('New text files are limited to 256 KiB.');
    }
    textFromBytes(bytes);
    const checked = await checkedPath(cwd, call.path, signal, true);
    // O_EXCL makes an intervening file or symlink a refusal, never an overwrite.
    const handle = await open(checked.target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
    try {
        await verifyPath(checked.root, dirname(checked.target));
        signal?.throwIfAborted();
        await handle.writeFile(bytes);
    } catch (error) {
        const opened = await handle.stat();
        const named = await lstat(checked.target).catch(() => null);
        if (named?.dev === opened.dev && named.ino === opened.ino) {
            await unlink(checked.target);
        }
        throw error;
    } finally {
        await handle.close();
    }
    return {
        output: JSON.stringify({ path: checked.path, created: true, bytes: bytes.length }),
        failed: false,
        changes: [{ path: checked.path, kind: 'add', diff: '' }]
    };
};

const editFile = async (cwd: string, call: Extract<FileCall, { name: 'edit_file' }>, signal?: AbortSignal): Promise<AppleToolResult> => {
    if (!call.oldText) {
        throw new Error('An edit must name nonempty text to replace exactly once.');
    }
    const checked = await checkedPath(cwd, call.path, signal);
    const snapshot = await readSnapshot(checked, signal);
    const index = snapshot.text.indexOf(call.oldText);
    if (index < 0 || snapshot.text.indexOf(call.oldText, index + 1) >= 0) {
        return {
            output: 'Edit rejected: oldText must match exactly once. No file was changed. Read the file again and copy a short unique passage exactly, preserving heading markers, spaces, and real line breaks. Then submit a corrected Edit.',
            failed: true,
            recoverable: true
        };
    }
    const next = snapshot.text.slice(0, index) + call.newText + snapshot.text.slice(index + call.oldText.length);
    const bytes = Buffer.from(next);
    if (bytes.length > MAX_FILE_BYTES) {
        throw new Error('Edited text files are limited to 256 KiB.');
    }
    textFromBytes(bytes);
    const handle = await open(checked.target, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const current = await readOpened(handle, signal);
        await verifyPath(checked.root, checked.target);
        const named = await stat(checked.target);
        if (
            current.metadata.nlink !== 1 ||
            !sameFile(snapshot.metadata, current.metadata) ||
            !sameFile(current.metadata, named) ||
            current.text !== snapshot.text
        ) {
            throw new Error('The file changed or has multiple hard links. Read it again before editing.');
        }
        signal?.throwIfAborted();
        // Use the checked descriptor so a swapped final name cannot redirect the write.
        await handle.writeFile(bytes);
        await handle.truncate(bytes.length);
    } finally {
        await handle.close();
    }
    return {
        output: JSON.stringify({ path: checked.path, replaced: 1, bytes: bytes.length }),
        failed: false,
        changes: [{ path: checked.path, kind: 'update', diff: '' }]
    };
};

export const executeAppleFileTool = async (cwd: string, call: FileCall, signal?: AbortSignal): Promise<AppleToolResult> => {
    switch (call.name) {
        case 'list_files':
            return { output: await listFiles(cwd, call.path, signal), failed: false };
        case 'read_file':
            return { output: await readFile(cwd, call.path, call.offset, call.limit, signal), failed: false };
        case 'search_files':
            return { output: await searchFiles(cwd, call, signal), failed: false };
        case 'write_file':
            return writeFile(cwd, call, signal);
        case 'edit_file':
            return editFile(cwd, call, signal);
    }
};
