import type { EditorEngine } from '@adecore/editor';
import { codeHighlighter } from '@/code-highlighter';
import { isApplePlatform } from '@/desktop/bridge';
import { RUIMTE_EDITOR_KEYMAP } from '@/shell/editor-keymap';
import { shellShortcuts } from '@/terminal/keymap';
import SearchWorker from './search.worker.ts?worker';

let loading: Promise<EditorEngine> | null = null;
let loaded: EditorEngine | null = null;

/*
 * The editor loads with the first file opened. It colors with the highlighter the viewer's `codeToHtml`
 * sits on (`highlight.ts`), so a grammar loads once for both, and it hands back the shortcuts any text
 * field does, so the palette opens from a file the way it does from the composer.
 */
export function loadEditorEngine(): Promise<EditorEngine> {
    loading ??= createEngine().then(
        (engine) => {
            loaded = engine;
            return engine;
        },
        (error: unknown) => {
            loading = null;
            throw error;
        }
    );
    return loading;
}

async function createEngine(): Promise<EditorEngine> {
    const apple = isApplePlatform();
    const { createSmartEditorEngine, shikiScopeColors, shikiTokenizers } = await import('@adecore/editor');
    return createSmartEditorEngine({
        searchWorker: () => new SearchWorker(),
        tokenizer: shikiTokenizers(codeHighlighter),
        scopeColors: shikiScopeColors(codeHighlighter),
        handBack: shellShortcuts(apple),
        keymap: RUIMTE_EDITOR_KEYMAP,
        apple
    });
}

/* The engine once it is in, so a file opened after the first draws the editor from its first frame and not the placeholder. */
export function loadedEditorEngine(): EditorEngine | null {
    return loaded;
}
