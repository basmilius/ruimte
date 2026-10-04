import { useEffect, useReducer } from 'react';
import { useStore } from 'zustand';
import type { EditorLanguage } from './editor-language';
import { AnchoredPopup } from './AnchoredPopup';
import { HoverCard } from './HoverCard';

/*
 * Every card a language feature opens over the editor. Each feature keeps its own state and these
 * only draw it, placed by the screen position of the character it belongs to, which is read again
 * whenever the editor scrolls or resizes.
 */
export function LanguagePopups({ language }: { language: EditorLanguage }) {
    const [, redraw] = useReducer((count: number) => count + 1, 0);
    const hover = useStore(language.hover.store, (state) => state.hover);

    useEffect(() => language.editor.onViewChange(redraw), [language]);

    const hoverRect = hover === null ? null : language.editor.rectAt(hover.anchor);
    return hover !== null && hoverRect !== null ? (
        <AnchoredPopup rect={hoverRect} onPointerEnter={() => language.hover.holdCard(true)} onPointerLeave={() => language.hover.holdCard(false)}>
            <HoverCard language={language} problems={hover.problems} />
        </AnchoredPopup>
    ) : null;
}
