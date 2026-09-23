import type { Highlighter } from 'shiki';
import type { KeyChord } from './keys.ts';

export type { KeyChord } from './keys.ts';

/* A Shiki theme id, the one the viewer draws the same file in. */
export type EditorTheme = string;

export interface EditorOptions {
    readonly text: string;
    /* The Shiki id `fs.read` answers with. Without one, or with one Shiki does not know, it is plain text. */
    readonly language?: string;
    /* The file's path, absolute or only a name. A language service reads the dialect off its extension, a `.tsx` from a `.ts`. */
    readonly path?: string;
    readonly theme: EditorTheme;
    readonly readOnly?: boolean;
    /* What a person is told on typing into a read-only editor. */
    readonly readOnlyReason?: string;
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
    setReadOnly(readOnly: boolean, reason?: string): void;
    focus(): void;
    dispose(): void;
}

export interface EditorEngine {
    /* The element is sized by its parent; the editor follows it. It must sit under `styles.css`, whose tokens color the chrome. */
    mount(element: HTMLElement, options: EditorOptions): Editor;
}

export interface MonacoEngineOptions {
    /* The viewer's highlighter, so a grammar loads once for both. */
    readonly highlighter: () => Promise<Highlighter>;
    /* The app's shortcuts that work from anywhere, a text field included. Monaco lets them through even where it binds the key itself. */
    readonly handBack?: readonly KeyChord[];
    /* Whether the physical Ctrl and Meta of a shortcut are macOS's. */
    readonly apple?: boolean;
}

let monacoEngine: Promise<EditorEngine> | null = null;

/*
 * The only door to Monaco, which weighs several megabytes and so loads with the first file opened and
 * never with the app. Monaco's themes, languages and keybindings are global to the page, so there is
 * one engine and a second call gets the first; one that failed to load is tried again.
 */
export const loadMonacoEngine = (options: MonacoEngineOptions): Promise<EditorEngine> => {
    monacoEngine ??= import('./monaco.ts')
        .then(({ createMonacoEngine }) => createMonacoEngine(options))
        .catch((error: unknown) => {
            monacoEngine = null;
            throw error;
        });
    return monacoEngine;
};
