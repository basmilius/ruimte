import { useEffect, useState } from 'react';
import type { EditorLanguage } from './ruimte-editor-language';

/* The kinds of language server that serve the file, once the daemon has said, and again when what they offer changes. */
export function useServingKinds(language: EditorLanguage): readonly string[] {
    const [kinds, setKinds] = useState<readonly string[]>([]);

    useEffect(() => {
        let alive = true;
        const read = (): void => {
            if (alive) {
                setKinds((before) => {
                    const next = language.project.service.serversOf(language.uri);
                    return before.length === next.length && before.every((kind, index) => kind === next[index]) ? before : next;
                });
            }
        };
        void language.document.ready.then(read);
        const subscription = language.project.service.onProvidersChanged((uri) => {
            if (uri === language.uri) {
                read();
            }
        });
        return () => {
            alive = false;
            subscription.dispose();
        };
    }, [language]);

    return kinds;
}
