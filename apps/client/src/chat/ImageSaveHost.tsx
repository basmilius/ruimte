import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import { FileTree, useFileTree } from '@adecore/ui';
import { GeneratedImageSaveDialog } from '@/chat/GeneratedImageSaveDialog';
import { imageSaveDialog, ImageSaveSession, validImageFileName } from '@/chat/image-save';
import { absoluteOf, basenameOf, buildTreeInput, LOADING_NAME, type EntryCache } from '@/shell/panels/files-tree';
import type { Transport } from '@/transport';

function ImageSaveFolders({ session, transport }: { session: ImageSaveSession; transport: Transport }) {
    const { t } = useTranslation('chat');
    const root = session.root.folder;
    const label = basenameOf(root);
    const [cache, setCache] = useState<EntryCache>(new Map());
    const directories = useRef<string[]>(['']);
    const loading = useRef(new Set<string>());
    const loaded = useRef(new Set<string>());
    const active = useRef(true);
    const select = (path: string | null): void => {
        const selected = path?.replace(/\/$/, '');
        if (selected === label) {
            session.selectDirectory('');
        } else if (selected?.startsWith(`${label}/`) && !selected.endsWith(`/${LOADING_NAME}`)) {
            session.selectDirectory(selected.slice(label.length + 1));
        }
    };
    const { model } = useFileTree({
        paths: [`${label}/${LOADING_NAME}`],
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
                    session.state.setState({ error: error instanceof Error ? error.message : String(error) });
                }
            } finally {
                loading.current.delete(directory);
            }
        };
        void load('');
        const unsubscribe = model.subscribe(() => {
            for (const directory of directories.current) {
                const path = directory === '' ? `${label}/` : `${label}/${directory}/`;
                if (FileTree.directoryHandle(model, path)?.isExpanded()) {
                    void load(directory);
                }
            }
        });
        return () => {
            active.current = false;
            unsubscribe();
        };
    }, [root, label, model, transport, session]);

    useEffect(() => {
        const expanded = directories.current.filter((directory) =>
            FileTree.directoryHandle(model, directory === '' ? `${label}/` : `${label}/${directory}/`)?.isExpanded()
        );
        FileTree.resetExpandedPaths(
            model,
            [`${label}/`, ...input.paths.map((path) => `${label}/${path}`)],
            new Set(['', ...expanded].map((directory) => (directory === '' ? `${label}/` : `${label}/${directory}/`)))
        );
    }, [model, label, input]);

    return <FileTree.Root model={model} label={t('generatedImage.folder')} resetKey={root} onFocusMove={select} />;
}

function ImageSaveBody({ session, transport }: { session: ImageSaveSession; transport: Transport }) {
    const state = useStore(session.state);
    return (
        <GeneratedImageSaveDialog
            open={!state.closed}
            onOpenChange={(open) => !open && session.close()}
            projectName={session.root.projectName}
            folderTree={<ImageSaveFolders session={session} transport={transport} />}
            fileName={state.name}
            onFileNameChange={(name) => session.name(name)}
            destinationPath={session.path()}
            pending={state.pending}
            error={state.error}
            exists={state.target?.exists === true}
            canSave={validImageFileName(state.name) && state.checkedPath === session.path()}
            onSave={() => void session.save(false)}
            onReplace={() => void session.save(true)}
        />
    );
}

export function ImageSaveHost() {
    const session = useStore(imageSaveDialog, (state) => state.session);
    useEffect(() => () => session?.close(), [session]);
    return session === null ? null : <ImageSaveBody key={session.root.folder} session={session} transport={session.transport} />;
}
