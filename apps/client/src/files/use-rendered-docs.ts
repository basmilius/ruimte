import { useEffect } from 'react';
import { RENDERED_DOC_COMMENTS } from '@/features';
import type { EditorLanguage } from '@/language/ruimte-editor-language';
import { useSettings } from '@/state/settings';

export function renderedDocsSettings(
    setting: boolean,
    feature: boolean = RENDERED_DOC_COMMENTS
): { readonly renderDocComments: boolean; readonly enabled: boolean } {
    return { renderDocComments: feature && setting, enabled: feature };
}

export function useRenderedDocs(language: EditorLanguage | null): void {
    const setting = useSettings((s) => s.codeRenderDocs);

    useEffect(() => {
        language?.renderedDocs.configure(renderedDocsSettings(setting));
    }, [language, setting]);
}
