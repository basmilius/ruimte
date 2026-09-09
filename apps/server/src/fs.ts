import { rename, writeFile } from 'node:fs/promises';

// A crash between the two steps leaves a stray temp file, never a half-written file.
export const writeAtomic = async (target: string, content: string, mode = 0o600): Promise<void> => {
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, content, { mode });
    await rename(temp, target);
};

export const isNotFound = (e: unknown): boolean => typeof e === 'object' && e !== null && 'code' in e && e.code === 'ENOENT';
