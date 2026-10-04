import { useEffect, useReducer } from 'react';
import { useStore } from 'zustand';
import type { EditorLanguage } from './editor-language';
import { AnchoredPopup } from './AnchoredPopup';
import { CompletionPopup } from './CompletionPopup';
import { HoverCard } from './HoverCard';
import { PeekPanel } from './PeekPanel';
import { PickPopup } from './PickPopup';
import { RenameCard } from './RenameCard';
import { SymbolPicker } from './SymbolPicker';
import { SignatureCard } from './SignatureCard';

/*
 * Every card a language feature opens over the editor. Each feature keeps its own state and these
 * only draw it, placed by the screen position of the character it belongs to, which is read again
 * whenever the editor scrolls or resizes.
 */
export function LanguagePopups({ language }: { language: EditorLanguage }) {
    const [, redraw] = useReducer((count: number) => count + 1, 0);
    const hover = useStore(language.popups, (state) => state.hover);
    const completion = useStore(language.popups, (state) => state.completion);
    const signature = useStore(language.popups, (state) => state.signature);
    const pick = useStore(language.popups, (state) => state.pick);
    const rename = useStore(language.popups, (state) => state.rename);
    const peek = useStore(language.popups, (state) => state.peek);
    const symbols = useStore(language.popups, (state) => state.symbols);

    useEffect(() => language.editor.onViewChange(redraw), [language]);

    const hoverRect = hover === null ? null : language.editor.rectAt(hover.anchor);
    const completionRect = completion === null ? null : language.editor.rectAt(completion.anchor);
    const signatureRect = signature === null ? null : language.editor.rectAt(signature.anchor);
    const pickRect = pick === null ? null : language.editor.rectAt(pick.anchor);
    const renameRect = rename === null ? null : language.editor.rectAt(rename.range.start);
    const renameEnd = rename === null ? null : language.editor.rectAt(rename.range.end);
    return (
        <>
            {hover !== null && hoverRect !== null && (
                <AnchoredPopup rect={hoverRect} onPointerEnter={() => language.hover.holdCard(true)} onPointerLeave={() => language.hover.holdCard(false)}>
                    <HoverCard language={language} problems={hover.problems} info={hover.info} anchor={hover.anchor} position={hover.position} />
                </AnchoredPopup>
            )}
            {signature !== null && signatureRect !== null && (
                <AnchoredPopup rect={signatureRect} placement={{ prefer: 'above' }}>
                    <SignatureCard model={signature.model} />
                </AnchoredPopup>
            )}
            {completion !== null && completionRect !== null && <CompletionPopup language={language} view={completion} rect={completionRect} />}
            {pick !== null && pickRect !== null && <PickPopup language={language} view={pick} rect={pickRect} />}
            {symbols !== null && <SymbolPicker language={language} view={symbols} />}
            {peek !== null && <PeekPanel language={language} view={peek} />}
            {rename !== null && renameRect !== null && <RenameCard language={language} view={rename} rect={renameRect} endRect={renameEnd} />}
        </>
    );
}
