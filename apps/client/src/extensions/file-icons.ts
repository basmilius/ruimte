import { setFileIconOverride } from '@adecore/ui';

// Per file extension, every icon given for it, the latest last. Taking one out leaves the others, so the one before shows again.
const icons = new Map<string, { url: string }[]>();

/* One extension's icons for these file extensions. Answers how to take them out again. */
export function addFileIcons(url: string, extensions: readonly string[]): () => void {
    const given = { url };
    const names = [...new Set(extensions.map((name) => name.toLowerCase()))];

    for (const name of names) {
        icons.set(name, [...(icons.get(name) ?? []), given]);
    }

    setFileIconOverride((path) => icons.get(path.slice(path.lastIndexOf('.') + 1).toLowerCase())?.at(-1)?.url ?? null);

    return () => {
        for (const name of names) {
            const rest = (icons.get(name) ?? []).filter((each) => each !== given);

            if (rest.length === 0) {
                icons.delete(name);
            } else {
                icons.set(name, rest);
            }
        }
    };
}
