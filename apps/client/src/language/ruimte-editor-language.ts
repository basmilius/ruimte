import { EditorLanguage as SharedEditorLanguage } from '@adecore/editor-react';
import type { Editor } from '@adecore/editor';
import { InlineEditFeature } from '@/editor-ai/inline-edit';
import { ExplainFeature } from './explain';
import { GhostTextFeature } from './ghost-text';
import { SelectionChatFeature } from './selection-chat';
import type { ProjectLanguage } from './ruimte-project-language';
import { realTimers, type Timers } from './timers';

export class EditorLanguage extends SharedEditorLanguage {
    declare readonly project: ProjectLanguage;
    readonly explain: ExplainFeature;
    readonly ghost: GhostTextFeature;
    readonly selectionChat: SelectionChatFeature;
    readonly inlineEdit: InlineEditFeature;

    constructor(project: ProjectLanguage, editor: Editor, uri: string, languageId: string, timers: Timers = realTimers) {
        let ghost: GhostTextFeature | undefined;
        // Ruimte gives its ghost suggestion Tab before shared completion and snippet handlers.
        const offGhostKeys = editor.onKeyDown((event) => ghost?.handleKey(event) ?? false);
        super(project, editor, uri, languageId, timers);
        this.explain = new ExplainFeature(this);
        this.ghost = ghost = new GhostTextFeature(this, undefined, false);
        this.onDispose(offGhostKeys);
        this.selectionChat = new SelectionChatFeature(this);
        this.inlineEdit = new InlineEditFeature(this);
    }
}
