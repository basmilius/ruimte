import { FileTree, useFileTree, messageOf } from '@adecore/ui';
import { absoluteOf } from '@ruimte/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { basenameOf } from '@/paths/file-path';
import { buildTreeInput, LOADING_NAME, type EntryCache } from '@/surface/panels/files-tree';
import type { Transport } from '@/transport/index';

/*
 * The folders of a project to pick one from, read a level at a time as a person opens them. `onSelect`
 * hands the folder relative to `root`, the empty string for the root itself. The React Compiler leaves
 * this as written (a try with a finally), so its memo stays by hand.
 */
export function ProjectFolderPicker({
    root,
    transport,
    label,
    onSelect,
    onError
}: {
    root: string;
    transport: Transport;
    label: string;
    onSelect(directory: string): void;
    onError(message: string): void;
}) {
    const rootName = basenameOf(root);
    const [cache, setCache] = useState<EntryCache>(new Map());
    const directories = useRef<string[]>(['']);
    const loading = useRef(new Set<string>());
    const loaded = useRef(new Set<string>());
    const active = useRef(true);
    const select = (path: string | null): void => {
        const selected = path?.replace(/\/$/, '');
        if (selected === rootName) {
            onSelect('');
        } else if (selected?.startsWith(`${rootName}/`) && !selected.endsWith(`/${LOADING_NAME}`)) {
            onSelect(selected.slice(rootName.length + 1));
        }
    };
    const { model } = useFileTree({
        paths: [`${rootName}/${LOADING_NAME}`],
        flattenEmptyDirectories: false,
        initialExpansion: 'closed',
        unsafeCSS: `[data-item-path$="/${LOADING_NAME}"] { display: none !important; }`,
        onSelectionChange: (paths) => select(paths.at(-1) ?? null)
    });
    const input = useMemo(() => buildTreeInput(root, cache, true), [root, cache]);
    useEffect(() => {
        directories.current = ['', ...input.paths.filter((path) => path.endsWith('/')).map((path) => path.slice(0, -1))];
    }, [input]);

    useEffect(() => {
        active.current = true;
        const load = async (directory: string): Promise<void> => {
            if (loading.current.has(directory) || loaded.current.has(directory)) {
                return;
            }
            loading.current.add(directory);
            const path = directory === '' ? root : absoluteOf(root, directory);
            try {
                const result = await transport.request('fs.list', { path, depth: 1, hidden: true });
                if (active.current) {
                    loaded.current.add(directory);
                    setCache((previous) =>
                        new Map(previous).set(
                            path,
                            result.entries.filter((entry) => entry.kind === 'directory' && entry.name !== '.git' && entry.name !== '.ruimte')
                        )
                    );
                }
            } catch (error) {
                if (active.current) {
                    onError(messageOf(error));
                }
            } finally {
                loading.current.delete(directory);
            }
        };
        void load('');
        const unsubscribe = model.subscribe(() => {
            for (const directory of directories.current) {
                const path = directory === '' ? `${rootName}/` : `${rootName}/${directory}/`;
                if (FileTree.directoryHandle(model, path)?.isExpanded()) {
                    void load(directory);
                }
            }
        });
        return () => {
            active.current = false;
            unsubscribe();
        };
        // `onError` is a new function on every render of the caller; the tree reads once per root.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [root, rootName, model, transport]);

    useEffect(() => {
        const expanded = directories.current.filter((directory) =>
            FileTree.directoryHandle(model, directory === '' ? `${rootName}/` : `${rootName}/${directory}/`)?.isExpanded()
        );
        FileTree.resetExpandedPaths(
            model,
            [`${rootName}/`, ...input.paths.map((path) => `${rootName}/${path}`)],
            new Set(['', ...expanded].map((directory) => (directory === '' ? `${rootName}/` : `${rootName}/${directory}/`)))
        );
    }, [model, rootName, input]);

    // The tree draws only the rows its own height holds, so it needs a height of its own; a cap on its parent leaves it none.
    return <FileTree.Root model={model} className="h-56" label={label} resetKey={root} onFocusMove={select} />;
}
