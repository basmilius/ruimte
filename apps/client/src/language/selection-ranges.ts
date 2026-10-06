import type { EditorRange } from '@adecore/editor';
import type { SelectionRange } from '@adecore/lsp';
import type { EditorLanguage } from './editor-language';

const METHOD = 'textDocument/selectionRange';

/* The links of one answer, the smallest range first. */
export function selectionChainOf(selection: SelectionRange): EditorRange[] {
    const chain: EditorRange[] = [];
    for (let link: SelectionRange | undefined = selection; link; link = link.parent) {
        chain.push(link.range);
    }
    return chain;
}

/*
 * Extend and Shrink Selection grow through the ranges the language server knows around the caret, which
 * follow the syntax of the file. Where no server offers them the editor grows by its own rule.
 */
export class SelectionRangesFeature {
    constructor(language: EditorLanguage) {
        const { editor, project, uri } = language;
        editor.setSelectionRanges(async (positions) => {
            if (!project.service.supports(METHOD, uri)) {
                return null;
            }
            const chains = await project.service.selectionRanges(uri, positions);
            return chains === null || chains.length !== positions.length ? null : chains.map(selectionChainOf);
        });
        language.onDispose(() => editor.setSelectionRanges(null));
    }
}
