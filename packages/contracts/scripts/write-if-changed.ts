import { readFile, writeFile } from 'node:fs/promises';

export async function writeIfChanged(path: string, content: string): Promise<boolean> {
    const current = await readFile(path, 'utf8').catch(() => null);
    if (current === content) {
        return false;
    }
    await writeFile(path, content);
    return true;
}
