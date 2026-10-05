import { useEffect } from 'react';
import type { EditorLanguage } from '@/language/editor-language';
import { useSettings } from '@/state/settings';

/* Hands the rows above declarations what the person asked of them in the settings. */
export function useCodeVision(language: EditorLanguage | null): void {
    const usages = useSettings((s) => s.codeVisionUsages);
    const authors = useSettings((s) => s.codeVisionAuthors);

    useEffect(() => {
        language?.codeVision.configure({ usages, authors });
    }, [language, usages, authors]);
}
