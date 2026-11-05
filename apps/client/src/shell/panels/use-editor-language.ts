import type { Editor } from '@adecore/editor';
import { createHolder, lspLanguageIdOf, realTimers } from '@adecore/editor-react';
import { pathToFileUri } from '@adecore/lsp';
import { storedPathOf } from '@ruimte/contracts';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { customLanguageIdOf } from '@/language/language-ids-host';
import { draftFiles } from '@/language/project-files';
import { EditorLanguage } from '@/language/ruimte-editor-language';
import { acquireProjectLanguage } from '@/language/ruimte-project-language';
import { participateInSave } from '@/language/save-participation';
import { useEndpointId } from '@/state/current-endpoint';
import { useProject } from '@/state/project';
import { textDrafts } from '@/state/text-drafts';
import { useTransport } from '@/transport/context';

/*
 * The language id of a file that no catalog server knows but a server of a person's own serves, once the
 * machine has said which servers the project has, and again when they change. Null while nothing serves it.
 */
function useOwnLanguageId(enabled: boolean, path: string, language: string | undefined): string | null {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const folder = useProject((s) => s.current?.folder ?? null);
    // Kept by hand: an effect depends on it.
    const holder = useMemo(() => createHolder<string>(), []);

    useEffect(() => {
        if (!enabled || projectId === null || folder === null) {
            return;
        }
        const held = acquireProjectLanguage(transport, projectId, folder, draftFiles(endpointId, transport, projectId));
        const stored = storedPathOf(folder, path);
        const read = (): void => holder.set(customLanguageIdOf(held.language.status.getSnapshot(), language, stored));
        read();
        const stop = held.language.status.subscribe(read);
        return () => {
            stop();
            holder.set(null);
            held.release();
        };
    }, [transport, endpointId, enabled, projectId, folder, path, language, holder]);

    return useSyncExternalStore(holder.subscribe, holder.get);
}

/*
 * The language side of an open editor, or null where there is none: no project to run a server in.
 * A file whose language no server here serves still gets one, unserved (`served`), for the features
 * that need no server. The document stays open on the daemon exactly as long as the editor lives
 * and a server serves it.
 */
export function useEditorLanguage(editor: Editor | null, path: string, language: string | undefined): EditorLanguage | null {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const folder = useProject((s) => s.current?.folder ?? null);
    // Kept by hand: an effect depends on it.
    const holder = useMemo(() => createHolder<EditorLanguage>(), []);
    const builtIn = lspLanguageIdOf(language);
    const ownId = useOwnLanguageId(editor !== null && builtIn === null, path, language);
    const serverLanguageId = builtIn ?? ownId;
    const serve = serverLanguageId !== null;
    const languageId = serverLanguageId ?? language ?? 'plaintext';

    useEffect(() => {
        if (editor === null || projectId === null || folder === null) {
            return;
        }
        const held = acquireProjectLanguage(transport, projectId, folder, draftFiles(endpointId, transport, projectId));
        const editorLanguage = new EditorLanguage(held.language, editor, pathToFileUri(path), languageId, realTimers, { serve });
        // The same path FileEditor hands the draft, so the keys match; a document no server serves has nothing to take part with.
        const offSave = serve ? textDrafts.participate(endpointId, path, (reason) => participateInSave(editorLanguage, reason)) : undefined;
        holder.set(editorLanguage);
        return () => {
            offSave?.();
            holder.set(null);
            editorLanguage.dispose();
            held.release();
        };
    }, [transport, endpointId, editor, projectId, folder, path, languageId, serve, holder]);

    return useSyncExternalStore(holder.subscribe, holder.get);
}
