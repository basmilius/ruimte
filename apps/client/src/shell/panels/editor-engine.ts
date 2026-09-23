import { type EditorEngine, loadMonacoEngine } from '@ruimte/editor';
import { isApplePlatform } from '@/desktop/bridge';
import { CODE_THEMES } from '@/shell/panels/code-themes';
import { shellShortcuts } from '@/terminal/keymap';

let loaded: EditorEngine | null = null;

/*
 * Monaco loads with the first file opened. It colors with the highlighter the viewer's `codeToHtml`
 * sits on (`highlight.ts`), so a grammar loads once for both, and it hands back the shortcuts any text
 * field does, so the palette opens from a file the way it does from the composer.
 */
export const loadEditorEngine = (): Promise<EditorEngine> => {
    const apple = isApplePlatform();
    return loadMonacoEngine({
        // Ours go in up front, since the editor loads a theme it has not seen by a bundled id.
        highlighter: () =>
            import('shiki').then(async ({ getSingletonHighlighter }) => {
                const highlighter = await getSingletonHighlighter();
                await highlighter.loadTheme(...CODE_THEMES);
                return highlighter;
            }),
        handBack: shellShortcuts(apple),
        apple
    }).then((engine) => {
        loaded = engine;
        return engine;
    });
};

/* The engine once it is in, so a file opened after the first draws the editor from its first frame and not the placeholder. */
export const loadedEditorEngine = (): EditorEngine | null => loaded;
