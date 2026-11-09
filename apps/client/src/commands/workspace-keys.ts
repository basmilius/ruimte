/*
 * Keys of the workspace that are more than a row of the command table: a press that must be held, a
 * release, Escape stepping out of what a feature opened. Each feature that has some contributes a
 * listener of its own; the workspace binds them on `window` once (`shell/canvas-shortcuts.ts`).
 */
export interface WorkspaceKeys {
    /* The capture phase, before any other listener hears the key; true stops it. */
    capture?(event: KeyboardEvent): boolean;
    /* After the capture phase; true when the key is spoken for and no row answers it. */
    keydown?(event: KeyboardEvent): boolean;
    keyup?(event: KeyboardEvent): void;
    paste?(event: ClipboardEvent): void;
    blur?(): void;
    dispose?(): void;
}

type WorkspaceKeysFactory = () => WorkspaceKeys;

const factories: WorkspaceKeysFactory[] = [];

export function registerWorkspaceKeys(...added: readonly WorkspaceKeysFactory[]): void {
    factories.push(...added);
}

/* One listener of each feature, made for the workspace that is mounting. */
export function createWorkspaceKeys(): WorkspaceKeys[] {
    return factories.map((make) => make());
}

export function isPlainEscape(event: KeyboardEvent): boolean {
    return event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing;
}
