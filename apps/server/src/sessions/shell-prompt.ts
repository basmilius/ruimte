export interface ShellEditorState {
    cwd: string;
    empty: boolean;
}

export interface EmptyShellPrompt {
    revision: number;
    cwd: string;
}

export type ShellWorkingDirectory = { state: 'known'; cwd: string; revision: number } | { state: 'unknown' };

export type ShellPrepareOutcome = 'inserted' | 'refused' | 'unconfirmed';

export interface ShellEditorConnection {
    inspect(): Promise<ShellEditorState | null>;
    prepare(cwd: string, command: string, signal: AbortSignal): Promise<ShellPrepareOutcome>;
    close(): void;
}

/* Only a session's private editor channel can supply state. PTY output has no authority here. */
export class ShellPrompt {
    private revision = 0;
    private preparing: AbortController | null = null;
    private disposed = false;
    private editor: ShellEditorConnection | null = null;
    private empty: EmptyShellPrompt | null = null;
    private disposeChannel: (() => void) | null = null;

    connect(editor: ShellEditorConnection): () => void {
        if (this.disposed) {
            editor.close();
            return () => {};
        }
        this.editor?.close();
        this.input();
        this.editor = editor;
        return () => {
            if (this.editor === editor) {
                this.editor = null;
                this.input();
            }
        };
    }

    onDispose(dispose: () => void): void {
        this.disposeChannel = dispose;
    }

    input(): void {
        this.preparing?.abort();
        this.revision++;
        this.empty = null;
    }

    snapshot(): EmptyShellPrompt | null {
        return this.empty;
    }

    async inspect(): Promise<(ShellEditorState & { revision: number }) | null> {
        const editor = this.editor;
        const revision = this.revision;
        const state = await editor?.inspect();
        if (editor !== this.editor || revision !== this.revision) {
            return null;
        }
        this.empty = null;
        if (!state || !state.cwd.startsWith('/') || /[\p{Cc}\p{Cf}]/u.test(state.cwd)) {
            return null;
        }
        this.empty = state.empty ? { cwd: state.cwd, revision } : null;
        return { ...state, revision };
    }

    /* A live observation, never the launch cwd or a cached OSC value; busy/unsupported shells are unknown. */
    async workingDirectory(): Promise<ShellWorkingDirectory> {
        const state = await this.inspect();
        return state ? { state: 'known', cwd: state.cwd, revision: state.revision } : { state: 'unknown' };
    }

    async prepare(prompt: EmptyShellPrompt, command: string, validate: () => void): Promise<ShellPrepareOutcome> {
        const editor = this.editor;
        if (!editor || prompt.revision !== this.revision) {
            return 'refused';
        }
        // The last server checks and channel write share one turn. ZLE repeats buffer/cwd checks at insertion.
        validate();
        this.input();
        const preparing = new AbortController();
        this.preparing = preparing;
        try {
            return await editor.prepare(prompt.cwd, command, preparing.signal);
        } finally {
            if (this.preparing === preparing) {
                this.preparing = null;
            }
        }
    }

    dispose(): void {
        this.disposed = true;
        this.editor?.close();
        this.editor = null;
        this.input();
        this.disposeChannel?.();
        this.disposeChannel = null;
    }
}
