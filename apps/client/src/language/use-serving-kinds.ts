import { useEffect, useState } from 'react';
import type { EditorLanguage } from './ruimte-editor-language';

export function useServingKinds(language: EditorLanguage): readonly string[] {
    const [kinds, setKinds] = useState<readonly string[]>([]);

    useEffect(() => {
        return language.onProvidersChanged(() => {
            setKinds((before) => {
                const next = language.app.project.language.service.serversOf(language.uri);
                return before.length === next.length && before.every((kind, index) => kind === next[index]) ? before : next;
            });
        });
    }, [language]);

    return kinds;
}
