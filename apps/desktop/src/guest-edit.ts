/* The part of an Electron `WebFrameMain` this file needs, so a test can stand in for it. */
export interface ScriptFrame {
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
    isDestroyed(): boolean;
    readonly detached: boolean;
}

export type GuestEdit = 'copy' | 'select-all';

const COMMANDS: Record<GuestEdit, string> = {
    copy: 'copy',
    'select-all': 'selectAll'
};

/* The frame a right-click landed in while it is still in its page, else the page's main frame. */
export const editFrameOf = (clicked: ScriptFrame | undefined, main: ScriptFrame): ScriptFrame =>
    clicked && !clicked.isDestroyed() && !clicked.detached ? clicked : main;

/*
 * Copy or select all in a guest page for a row of the client's own menu. `WebContents.copy()` and
 * `selectAll()` go to whichever web contents holds the keyboard, and while the client draws the
 * menu that is the window around the guest, so they would act on the client instead. A command run
 * in the guest's own frame reaches that document whatever has the focus.
 */
export const runGuestEdit = (frame: ScriptFrame, edit: GuestEdit): void => {
    // As a gesture, since a page writes to the clipboard only while a person acts on it.
    void frame.executeJavaScript(`document.execCommand('${COMMANDS[edit]}')`, true).catch(() => undefined);
};
