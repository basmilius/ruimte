import { setFileIconOverride } from '@adecore/ui';

const icons = new Map<string, string>();

/* One extension's icons for these file extensions. Answers how to take them out again. */
export function addFileIcons(url: string, extensions: readonly string[]): () => void {
    for (const name of extensions) {
        icons.set(name.toLowerCase(), url);
    }

    setFileIconOverride((path) => icons.get(path.slice(path.lastIndexOf('.') + 1).toLowerCase()) ?? null);

    return () => {
        for (const name of extensions) {
            icons.delete(name.toLowerCase());
        }
    };
}
