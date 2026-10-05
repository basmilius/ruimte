import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import type { EditorLanguage } from '@/language/editor-language';
import { InlinePromptCard } from './InlinePromptCard';
import { InlineProposalCard } from './InlineProposalCard';

/*
 * What an inline edit draws over an editor: the question in a row above the selected lines, and once
 * there is a session, its card in the row the editor makes under them. Both rows are the editor's, so
 * they scroll with the text; this only fills them.
 */
export function InlineEditLayer({ language }: { language: EditorLanguage }) {
    const feature = language.inlineEdit;
    const { prompt, promptContainer, session, container } = useStore(feature.store, (view) => view);

    return (
        <>
            {prompt !== null &&
                promptContainer !== null &&
                createPortal(<InlinePromptCard feature={feature} language={language} prompt={prompt} />, promptContainer)}
            {session !== null && container !== null && createPortal(<InlineProposalCard language={language} session={session} />, container)}
        </>
    );
}
