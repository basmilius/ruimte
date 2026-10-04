import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { pathToFileUri } from '@ruimte/smart-editor-lsp';
import type { Editor } from '@ruimte/smart-editor';
import { EditorLanguage } from '@/language/editor-language';
import { lspLanguageIdOf } from '@/language/language-ids';
import { acquireProjectLanguage } from '@/language/project-language';
import { useProject } from '@/state/project';
import { useTransport } from '@/transport/context';

/* One value that an effect sets and a render reads, which is how an effect's result reaches the tree without a state update inside the effect. */
function createHolder<T>(): { get(): T | null; set(value: T | null): void; subscribe(listener: () => void): () => void } {
    let value: T | null = null;
    const listeners = new Set<() => void>();
    return {
        get: () => value,
        set: (next) => {
            value = next;
            for (const listener of [...listeners]) {
                listener();
            }
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        }
    };
}

/*
 * The language servers' side of an open editor, or null where there is none: no project to run a
 * server in, or a file whose language no server here serves. The document stays open on the
 * daemon exactly as long as the editor lives.
 */
export function useEditorLanguage(editor: Editor | null, path: string, language: string | undefined): EditorLanguage | null {
    const transport = useTransport();
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const folder = useProject((s) => s.current?.folder ?? null);
    const holder = useMemo(() => createHolder<EditorLanguage>(), []);

    useEffect(() => {
        const languageId = lspLanguageIdOf(language);
        if (editor === null || projectId === null || folder === null || languageId === null) {
            return;
        }
        const held = acquireProjectLanguage(transport, projectId, folder);
        const editorLanguage = new EditorLanguage(held.language, editor, pathToFileUri(path), languageId);
        holder.set(editorLanguage);
        return () => {
            holder.set(null);
            editorLanguage.dispose();
            held.release();
        };
    }, [transport, editor, projectId, folder, path, language, holder]);

    return useSyncExternalStore(holder.subscribe, holder.get);
}
