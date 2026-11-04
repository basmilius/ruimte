import type { Editor } from '@adecore/editor';
import { EditorLanguage as SharedEditorLanguage, KEY_PRIORITY, realTimers, type EditorLanguageOptions, type Timers } from '@adecore/editor-react';
import { InlineEditFeature } from '@/editor-ai/inline-edit';
import { ExplainFeature } from './explain';
import { GhostTextFeature } from './ghost-text';
import type { ProjectLanguage } from './ruimte-project-language';
import { SelectionChatFeature } from './selection-chat';

export class EditorLanguage extends SharedEditorLanguage {
    declare readonly project: ProjectLanguage;
    readonly explain: ExplainFeature;
    readonly ghost: GhostTextFeature;
    readonly selectionChat: SelectionChatFeature;
    readonly inlineEdit: InlineEditFeature;

    constructor(project: ProjectLanguage, editor: Editor, uri: string, languageId: string, timers: Timers = realTimers, options: EditorLanguageOptions = {}) {
        super(project, editor, uri, languageId, timers, options);
        this.explain = new ExplainFeature(this);
        this.ghost = new GhostTextFeature(this, undefined, false);
        // Ruimte gives its ghost suggestion Tab before shared completion and snippet handlers. The AI features wait for a document a server serves.
        this.onDispose(this.onKey((event) => this.served && this.ghost.handleKey(event), KEY_PRIORITY.pick + 1));
        this.selectionChat = new SelectionChatFeature(this);
        this.inlineEdit = new InlineEditFeature(this);
    }
}
