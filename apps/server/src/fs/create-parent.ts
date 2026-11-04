import { dlopen, FFIType, read, type Pointer } from 'bun:ffi';
import { closeSync, constants, fstatSync, mkdirSync, openSync, realpathSync, statSync, type Stats } from 'node:fs';
import { join, parse, relative, sep } from 'node:path';

export interface CreateParent {
    open(name: string, flags: number, mode: number): number;
    mkdir(name: string): Stats;
}

function failure(code: string, path: string): NodeJS.ErrnoException {
    return Object.assign(new Error(`${code}: the destination folder changed or cannot be opened: ${path}`), { code, path });
}

function sameFolder(expected: Stats, actual: Stats, path: string): void {
    if (!actual.isDirectory() || actual.dev !== expected.dev || actual.ino !== expected.ino) {
        throw failure('ESTALE', path);
    }
}

function posix() {
    const darwin = process.platform === 'darwin';
    const library = darwin ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6';
    const errnoName = darwin ? '__error' : '__errno_location';
    // Apple's syscall entry has a fixed mode argument; the public variadic wrapper uses a different ABI on arm64.
    // https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/open-base.c
    const openName = darwin ? '__openat' : 'openat';
    const { symbols } = dlopen(library, {
        [openName]: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
        mkdirat: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
        [errnoName]: { args: [], returns: FFIType.ptr }
    });

    const check = (result: number, path: string): number => {
        if (result >= 0) {
            return result;
        }

        const errno = read.i32(symbols[errnoName]!() as Pointer, 0);
        const codes: Record<number, string> = {
            1: 'EPERM',
            2: 'ENOENT',
            13: 'EACCES',
            17: 'EEXIST',
            20: 'ENOTDIR',
            21: 'EISDIR',
            22: 'EINVAL',
            28: 'ENOSPC',
            30: 'EROFS'
        };

        if (errno === (darwin ? 62 : 40)) {
            throw failure('ELOOP', path);
        }

        if (errno === (darwin ? 63 : 36)) {
            throw failure('ENAMETOOLONG', path);
        }

        throw failure(codes[errno] ?? 'EIO', path);
    };

    return {
        open: (parent: number, name: string, flags: number, mode: number) =>
            check(symbols[openName]!(parent, Buffer.from(`${name}\0`), flags, mode) as number, name),
        mkdir: (parent: number, name: string) => check(symbols.mkdirat(parent, Buffer.from(`${name}\0`), 0o777), name)
    };
}

let posixCalls: ReturnType<typeof posix> | undefined;

function withPosixParent<T>(base: string, expected: Stats, parts: string[], run: (parent: CreateParent) => T): T {
    const native = (posixCalls ??= posix());
    const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
    const handles: number[] = [];

    try {
        const first = openSync(base, directoryFlags);
        handles.push(first);
        sameFolder(expected, fstatSync(first), base);

        if (realpathSync(`/dev/fd/${first}`) !== base) {
            throw failure('ESTALE', base);
        }

        let parent = first;

        for (const part of parts) {
            let next: number;

            try {
                next = native.open(parent, part, directoryFlags, 0);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw error;
                }

                try {
                    native.mkdir(parent, part);
                } catch (mkdirError) {
                    if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') {
                        throw mkdirError;
                    }
                }

                next = native.open(parent, part, directoryFlags, 0);
            }

            handles.push(next);
            parent = next;
        }

        return run({
            open: (name, flags, mode) => native.open(parent, name, flags | constants.O_NOFOLLOW, mode),
            mkdir: (name) => {
                native.mkdir(parent, name);
                const created = native.open(parent, name, directoryFlags, 0);

                try {
                    return fstatSync(created);
                } finally {
                    closeSync(created);
                }
            }
        });
    } finally {
        for (const descriptor of handles.reverse()) {
            closeSync(descriptor);
        }
    }
}

function windows() {
    return dlopen('kernel32.dll', {
        CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.ptr },
        GetFileInformationByHandle: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
        CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
        GetLastError: { args: [], returns: FFIType.u32 }
    });
}

let windowsCalls: ReturnType<typeof windows> | undefined;

function withWindowsParent<T>(base: string, expected: Stats, parts: string[], run: (parent: CreateParent) => T): T {
    const { symbols } = (windowsCalls ??= windows());
    const handles: Pointer[] = [];

    const hold = (path: string): void => {
        // No FILE_SHARE_DELETE: every ancestor stays in place until the operation ends. FILE_LIST_DIRECTORY (0x1) beside
        // FILE_READ_ATTRIBUTES (0x80), since a handle that only reads attributes takes no part in the sharing check.
        const handle = symbols.CreateFileW(Buffer.from(`${path}\0`, 'utf16le'), 0x81, 0x3, null, 3, 0x02200000, null);

        if (typeof handle !== 'number' || handle <= 0 || !Number.isSafeInteger(handle)) {
            const error = symbols.GetLastError();

            throw failure(error === 2 || error === 3 ? 'ENOENT' : 'EACCES', path);
        }

        handles.push(handle);
        const info = Buffer.alloc(52);

        if (symbols.GetFileInformationByHandle(handle, info) === 0) {
            throw failure('EACCES', path);
        }

        const attributes = info.readUInt32LE(0);

        if ((attributes & 0x400) !== 0 || (attributes & 0x10) === 0) {
            throw failure('ENOTDIR', path);
        }
    };

    try {
        const root = parse(base).root;
        let current = root;
        hold(root);

        for (const part of relative(root, base).split(sep).filter(Boolean)) {
            current = join(current, part);
            hold(current);
        }

        sameFolder(expected, statSync(base), base);

        for (const part of parts) {
            current = join(current, part);

            try {
                mkdirSync(current);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                    throw error;
                }
            }

            hold(current);
        }

        return run({
            open: (name, flags, mode) => openSync(join(current, name), flags, mode),
            mkdir: (name) => {
                const path = join(current, name);
                mkdirSync(path);
                hold(path);

                return statSync(path);
            }
        });
    } finally {
        for (const handle of handles.reverse()) {
            symbols.CloseHandle(handle);
        }
    }
}

/* All path components below the checked directory are opened without following links. The callback must finish before the handles close. */
export function withCreateParent<T>(base: string, expected: Stats, parts: string[], run: (parent: CreateParent) => T): T {
    if (parts.some((part) => part === '' || part === '.' || part === '..' || part.includes(sep))) {
        throw failure('EINVAL', base);
    }

    if (process.platform === 'win32') {
        return withWindowsParent(base, expected, parts, run);
    }

    if (process.platform === 'darwin' || process.platform === 'linux') {
        return withPosixParent(base, expected, parts, run);
    }

    throw failure('ENOTSUP', base);
}
