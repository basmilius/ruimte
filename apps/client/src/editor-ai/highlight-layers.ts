import type { Editor, EditorLineHighlight } from '@ruimte/smart-editor';

type Provider = () => readonly EditorLineHighlight[];

/*
 * The editor has one set of tinted lines, and a conflict and a review each have lines to tint. Every
 * owner hands over a function that says where its lines are now, so setting one owner's never carries
 * another's from before an edit.
 */
export class HighlightLayers {
    private readonly editor: Editor;
    private readonly owners = new Map<string, Provider>();

    constructor(editor: Editor) {
        this.editor = editor;
    }

    set(owner: string, provider: Provider | null): void {
        if (provider === null) {
            this.owners.delete(owner);
        } else {
            this.owners.set(owner, provider);
        }
        this.editor.setLineHighlights([...this.owners.values()].flatMap((read) => read()));
    }
}

const layers = new WeakMap<Editor, HighlightLayers>();

export function highlightLayers(editor: Editor): HighlightLayers {
    let found = layers.get(editor);
    if (found === undefined) {
        found = new HighlightLayers(editor);
        layers.set(editor, found);
    }
    return found;
}
