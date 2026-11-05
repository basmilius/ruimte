import { dlopen, FFIType, read } from 'bun:ffi';

/*
 * A rename that refuses a taken name in the same system call that makes it, so nothing that lands at
 * the target between a look and the move is ever replaced: `renamex_np` with `RENAME_EXCL` on macOS,
 * `renameat2` with `RENAME_NOREPLACE` on Linux (glibc 2.28) and `MoveFileExW` without
 * `MOVEFILE_REPLACE_EXISTING` on Windows. Node's own rename replaces on every platform. Where none of
 * these is there, or the volume refuses the flag, the move fails with `ENOTSUP` instead of replacing.
 */

// <sys/stdio.h> on macOS and <linux/fs.h> on Linux.
const RENAME_EXCL = 0x4;
const RENAME_NOREPLACE = 0x1;
const AT_FDCWD = -100;

const DARWIN_ERRORS: Record<number, string> = {
    1: 'EPERM',
    2: 'ENOENT',
    13: 'EACCES',
    16: 'EBUSY',
    17: 'EEXIST',
    18: 'EXDEV',
    20: 'ENOTDIR',
    21: 'EISDIR',
    22: 'EINVAL',
    28: 'ENOSPC',
    30: 'EROFS',
    45: 'ENOTSUP',
    62: 'ELOOP',
    63: 'ENAMETOOLONG',
    66: 'ENOTEMPTY',
    78: 'ENOSYS'
};

const LINUX_ERRORS: Record<number, string> = {
    1: 'EPERM',
    2: 'ENOENT',
    13: 'EACCES',
    16: 'EBUSY',
    17: 'EEXIST',
    18: 'EXDEV',
    20: 'ENOTDIR',
    21: 'EISDIR',
    // A volume that does not know the flag answers EINVAL, and the into-itself case is refused before a move.
    22: 'ENOTSUP',
    28: 'ENOSPC',
    30: 'EROFS',
    36: 'ENAMETOOLONG',
    38: 'ENOTSUP',
    39: 'ENOTEMPTY',
    40: 'ELOOP',
    95: 'ENOTSUP'
};

// What `GetLastError` answers, from winerror.h.
const WINDOWS_ERRORS: Record<number, string> = {
    2: 'ENOENT',
    3: 'ENOENT',
    5: 'EACCES',
    17: 'EXDEV',
    32: 'EBUSY',
    80: 'EEXIST',
    145: 'ENOTEMPTY',
    183: 'EEXIST',
    206: 'ENAMETOOLONG'
};

type Move = (from: string, to: string) => number;

function fail(code: string, from: string, to: string): NodeJS.ErrnoException {
    return Object.assign(new Error(`${code}: rename '${from}' -> '${to}'`), { code, syscall: 'rename', path: from, dest: to });
}

function cString(path: string): Buffer {
    return Buffer.from(`${path}\0`, 'utf8');
}

/* Zero on success, or the errno of the failed call, read right after it on the same thread. */
function darwin(): Move {
    const { symbols } = dlopen('/usr/lib/libSystem.B.dylib', {
        renamex_np: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
        __error: { args: [], returns: FFIType.ptr }
    });
    return (from, to) => (symbols.renamex_np(cString(from), cString(to), RENAME_EXCL) === 0 ? 0 : read.i32(symbols.__error()!, 0));
}

function linux(): Move {
    const { symbols } = dlopen('libc.so.6', {
        renameat2: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
        __errno_location: { args: [], returns: FFIType.ptr }
    });
    return (from, to) =>
        symbols.renameat2(AT_FDCWD, cString(from), AT_FDCWD, cString(to), RENAME_NOREPLACE) === 0 ? 0 : read.i32(symbols.__errno_location()!, 0);
}

function windows(): Move {
    const { symbols } = dlopen('kernel32.dll', {
        MoveFileExW: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
        GetLastError: { args: [], returns: FFIType.u32 }
    });
    const wide = (path: string): Buffer => Buffer.from(`${path}\0`, 'utf16le');
    return (from, to) => (symbols.MoveFileExW(wide(from), wide(to), 0) !== 0 ? 0 : symbols.GetLastError());
}

let native: { move: Move; errors: Record<number, string> } | null | undefined;

function load(): { move: Move; errors: Record<number, string> } | null {
    if (native !== undefined) {
        return native;
    }
    try {
        native =
            process.platform === 'darwin'
                ? { move: darwin(), errors: DARWIN_ERRORS }
                : process.platform === 'linux'
                  ? { move: linux(), errors: LINUX_ERRORS }
                  : process.platform === 'win32'
                    ? { move: windows(), errors: WINDOWS_ERRORS }
                    : null;
    } catch {
        native = null;
    }
    return native;
}

/* Moves `from` to `to`, a file, a folder or a link alike, and fails with `EEXIST` when `to` is taken. */
export async function renameNoReplace(from: string, to: string): Promise<void> {
    const loaded = load();
    if (loaded === null) {
        throw fail('ENOTSUP', from, to);
    }
    const error = loaded.move(from, to);
    if (error !== 0) {
        throw fail(loaded.errors[error] ?? 'EIO', from, to);
    }
}
