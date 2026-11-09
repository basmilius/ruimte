import type { Editor } from '@adecore/editor';
import { EditorLanguage as SharedEditorLanguage, realTimers, type EditorLanguageOptions, type Timers } from '@adecore/editor-react';
import { editorAssistClientFor } from '@/editor-assist/client';
import { ExplainFeature } from './explain';
import { GhostTextFeature } from './ghost-text';
import type { RuimteProject } from './ruimte-project';
import { SelectionChatFeature } from './selection-chat';

/* What the language needs of Ruimte's inline edit, which `editor-ai/inline-edit.ts` provides. */
export interface InlineEdit {
    readonly path: string;
    start(): void;
    show(): Promise<void>;
    returnToEditor(): void;
}

type InlineEditFactory = (language: SharedEditorLanguage) => InlineEdit;

let makeInlineEdit: InlineEditFactory | null = null;

export function provideInlineEdit(factory: InlineEditFactory): void {
    makeInlineEdit = factory;
}

/* What Ruimte adds to the editors of a project: the AI features and the project's own trackers. */
export interface RuimteFeatures {
    readonly project: RuimteProject;
    readonly explain: ExplainFeature;
    readonly ghost: GhostTextFeature;
    readonly selectionChat: SelectionChatFeature;
    readonly inlineEdit: InlineEdit;
}

export type EditorLanguage = SharedEditorLanguage<RuimteFeatures>;

export function createEditorLanguage(
    project: RuimteProject,
    editor: Editor,
    uri: string,
    languageId: string,
    timers: Timers = realTimers,
    options: EditorLanguageOptions = {}
): EditorLanguage {
    const language = new SharedEditorLanguage(project.language, editor, uri, languageId, timers, {
        ...options,
        features: (language) => {
            if (makeInlineEdit === null) {
                throw new Error('No inline edit is provided yet.');
            }
            return {
                project,
                explain: new ExplainFeature(language, editorAssistClientFor(project.transport)),
                ghost: new GhostTextFeature(language, editorAssistClientFor(project.transport)),
                selectionChat: new SelectionChatFeature(language),
                inlineEdit: makeInlineEdit(language)
            };
        }
    });
    // Ruimte does not offer the formatted view of documentation comments yet, and the feature starts on.
    language.renderedDocs.configure({ renderDocComments: false, enabled: false });

    return language;
}
