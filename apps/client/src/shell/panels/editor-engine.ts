import { type EditorEngine, loadMonacoEngine } from '@ruimte/editor';

/* Monaco loads on the first edit. It colors with the highlighter the viewer's `codeToHtml` sits on (`highlight.ts`), so a grammar loads once for both. */
export const loadEditorEngine = (): Promise<EditorEngine> =>
    loadMonacoEngine(() => import('shiki').then(({ getSingletonHighlighter }) => getSingletonHighlighter()));
