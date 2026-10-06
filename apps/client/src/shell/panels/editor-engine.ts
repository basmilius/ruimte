import type { EditorEngine } from '@adecore/editor';
import { isApplePlatform } from '@/desktop/bridge';
import { CODE_THEMES } from '@/shell/panels/code-themes';
import { shellShortcuts } from '@/terminal/keymap';
import { RUIMTE_EDITOR_KEYMAP } from '@/shell/editor-keymap';

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
    // Ours go in up front, since the editor loads a theme it has not seen by a bundled id.
    const highlighter = () =>
        import('shiki').then(async ({ getSingletonHighlighter }) => {
            const loaded = await getSingletonHighlighter();
            await loaded.loadTheme(...CODE_THEMES);
            return loaded;
        });
    return createSmartEditorEngine({
        tokenizer: shikiTokenizers(highlighter),
        scopeColors: shikiScopeColors(highlighter),
        handBack: shellShortcuts(apple),
        keymap: RUIMTE_EDITOR_KEYMAP,
        apple
    });
}

/* The engine once it is in, so a file opened after the first draws the editor from its first frame and not the placeholder. */
export function loadedEditorEngine(): EditorEngine | null {
    return loaded;
}
