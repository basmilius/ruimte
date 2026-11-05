import type { Editor } from '@adecore/editor';
import { EditorLanguage as SharedEditorLanguage, KEY_PRIORITY, realTimers, type EditorLanguageOptions, type Timers } from '@adecore/editor-react';
import { ExplainFeature } from './explain';
import { GhostTextFeature } from './ghost-text';
import type { ProjectLanguage } from './ruimte-project-language';
import { SelectionChatFeature } from './selection-chat';

/* What the language needs of Ruimte's inline edit, which `editor-ai/inline-edit.ts` provides. */
export interface InlineEdit {
    readonly path: string;
    start(): void;
    show(): Promise<void>;
    returnToEditor(): void;
}

type InlineEditFactory = (language: EditorLanguage) => InlineEdit;

let makeInlineEdit: InlineEditFactory | null = null;

export function provideInlineEdit(factory: InlineEditFactory): void {
    makeInlineEdit = factory;
}

export class EditorLanguage extends SharedEditorLanguage {
    declare readonly project: ProjectLanguage;
    readonly explain: ExplainFeature;
    readonly ghost: GhostTextFeature;
    readonly selectionChat: SelectionChatFeature;
    readonly inlineEdit: InlineEdit;

    constructor(project: ProjectLanguage, editor: Editor, uri: string, languageId: string, timers: Timers = realTimers, options: EditorLanguageOptions = {}) {
        super(project, editor, uri, languageId, timers, options);
        this.explain = new ExplainFeature(this);
        this.ghost = new GhostTextFeature(this, undefined, false);
        // Ruimte gives its ghost suggestion Tab before shared completion and snippet handlers. The AI features wait for a document a server serves.
        this.onDispose(this.onKey((event) => this.served && this.ghost.handleKey(event), KEY_PRIORITY.pick + 1));
        this.selectionChat = new SelectionChatFeature(this);
        if (makeInlineEdit === null) {
            throw new Error('No inline edit is provided yet.');
        }
        this.inlineEdit = makeInlineEdit(this);
    }
}
