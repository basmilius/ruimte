import type { Highlighter } from 'shiki';

export type EditorTheme = 'light' | 'dark';

export interface EditorOptions {
    readonly text: string;
    /* The Shiki id `fs.read` answers with. Without one, or with one Shiki does not know, it is plain text. */
    readonly language?: string;
    readonly theme: EditorTheme;
    readonly readOnly?: boolean;
    readonly wrap?: boolean;
    /* One-based, the line the cursor opens on. */
    readonly line?: number;
    /* One-based, where on that line. */
    readonly column?: number;
    /* In pixels, where the view opens; without it the cursor's line is brought into view. */
    readonly scrollTop?: number;
}

export interface Editor {
    getText(): string;
    /* A change from outside, such as a reload after `fs.changed` or another surface's edit. It is never
       reported as a change, and the cursor and the scroll stay put wherever the text around them did. */
    setText(text: string): void;
    onChange(listener: () => void): () => void;
    /* Mod+S from inside the editor; what happens then is the client's. */
    onSave(listener: () => void): () => void;
    /* The focus left the editor and every widget of its own, such as its find bar. */
    onBlur(listener: () => void): () => void;
    revealLine(line: number): void;
    setWrap(wrap: boolean): void;
    setTheme(theme: EditorTheme): void;
    setReadOnly(readOnly: boolean): void;
    focus(): void;
    dispose(): void;
}

export interface EditorEngine {
    /* The element is sized by its parent; the editor follows it. It must sit under `styles.css`, whose tokens color the chrome. */
    mount(element: HTMLElement, options: EditorOptions): Editor;
}

let monacoEngine: Promise<EditorEngine> | null = null;

/*
 * The only door to Monaco, which weighs several megabytes and so loads on the first edit and never
 * with the app. Monaco's themes and languages are global to the page, so there is one engine and a
 * second call gets the first; one that failed to load is tried again. The highlighter is the viewer's,
 * so a grammar loads once for both.
 */
export const loadMonacoEngine = (highlighter: () => Promise<Highlighter>): Promise<EditorEngine> => {
    monacoEngine ??= import('./monaco.ts')
        .then(({ createMonacoEngine }) => createMonacoEngine(highlighter))
        .catch((error: unknown) => {
            monacoEngine = null;
            throw error;
        });
    return monacoEngine;
};
