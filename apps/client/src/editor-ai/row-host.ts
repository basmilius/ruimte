import type { Editor } from '@ruimte/smart-editor';

export interface HostedRow {
    id: string;
    /* Zero-based. */
    line: number;
    placement: 'above' | 'below';
    height: number;
}

/*
 * The rows of one owner in an editor, and the elements the editor draws them in, so React can portal
 * into them. The editor makes an element again whenever its row scrolls back into view, which is why a
 * row's content never keeps state of its own.
 */
export class RowHost {
    private readonly editor: Editor;
    private readonly owner: string;
    private readonly containers = new Map<string, HTMLElement>();
    private readonly listeners = new Set<() => void>();
    private version = 0;
    private signature = '';

    constructor(editor: Editor, owner: string) {
        this.editor = editor;
        this.owner = owner;
    }

    getVersion = (): number => this.version;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    container(id: string): HTMLElement | undefined {
        return this.containers.get(id);
    }

    /* Sets the owner's rows; the same rows again are left alone, so an editor does not measure them twice. */
    set(rows: readonly HostedRow[]): void {
        const signature = rows.map((row) => `${row.id}@${row.line}${row.placement}`).join('|');
        if (signature === this.signature) {
            return;
        }
        this.signature = signature;
        const kept = new Set(rows.map((row) => row.id));
        for (const id of [...this.containers.keys()]) {
            if (!kept.has(id)) {
                this.containers.delete(id);
            }
        }
        this.editor.setWidgets(
            rows.map((row) => ({
                id: row.id,
                line: row.line,
                placement: row.placement,
                height: row.height,
                render: (container: HTMLElement) => this.mounted(row.id, container)
            })),
            this.owner
        );
        this.bump();
    }

    clear(): void {
        this.set([]);
    }

    private mounted(id: string, container: HTMLElement): void {
        this.containers.set(id, container);
        this.bump();
    }

    private bump(): void {
        this.version++;
        for (const listener of [...this.listeners]) {
            listener();
        }
    }
}
