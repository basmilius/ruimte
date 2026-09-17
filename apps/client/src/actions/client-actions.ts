import { ActionRefusal, ActionRegistry, type ActionCall, type ActionOutput } from '@ruimte/actions';
import { isOpenableView, isUnknownView, type NodeTitleSource, type ProjectView } from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { useDocument, type DocumentState } from '@/state/document';

const kindOf = (view: ProjectView): ActionOutput<'view.focus'>['kind'] => (isUnknownView(view) ? 'unknown' : view.kind);

export const createClientActionRegistry = (document: StoreApi<DocumentState>): ActionRegistry<void> =>
    new ActionRegistry<void>({
        'view.focus': ({ viewId }) => {
            const state = document.getState();
            const view = state.views.find((candidate) => candidate.id === viewId);
            if (!view) {
                throw new ActionRefusal('unknown-view', `No view with id “${viewId}” exists in this project.`);
            }
            if (!isOpenableView(view)) {
                throw new ActionRefusal('view-not-openable', `“${view.name}” is a separator and cannot be focused.`);
            }
            const previousViewId = state.activeViewId;
            const shown = state.showView(viewId);
            return {
                output: { viewId, view: view.name ?? viewId, kind: kindOf(view), changed: document.getState().activeViewId !== previousViewId },
                ...(shown ? { undo: () => document.getState().undoShowView(shown) } : {})
            };
        },
        'view.rename': ({ viewId, name }) => {
            const state = document.getState();
            const view = state.views.find((candidate) => candidate.id === viewId);
            if (!view) {
                throw new ActionRefusal('unknown-view', `No view with id “${viewId}” exists in this project.`);
            }
            if (isUnknownView(view)) {
                throw new ActionRefusal('unsupported-view', `The view “${view.name}” has a kind this version of Ruimte cannot rename.`);
            }
            const previousName = view.name ?? '';
            const previousSource: NodeTitleSource | null = 'titleSource' in view ? (view.titleSource ?? null) : null;
            state.renameView(viewId, name);
            const changed = document.getState().edits !== state.edits;
            return {
                output: { viewId, kind: kindOf(view), previousName, name, changed },
                ...(changed
                    ? {
                          undo: () => {
                              const current = document.getState().views.find((candidate) => candidate.id === viewId);
                              const currentSource = current && 'titleSource' in current ? (current.titleSource ?? null) : null;
                              if (!current || current.name !== name || currentSource !== 'user') {
                                  throw new ActionRefusal('stale-undo', `“${name}” is no longer the current name of this view.`);
                              }
                              document.getState().renameView(viewId, previousName, previousSource);
                          }
                      }
                    : {})
            };
        }
    });

export const clientActions = createClientActionRegistry(useDocument);

export const PERSON_ACTION_CALL: ActionCall<void> = { actor: { kind: 'person', id: 'local-person' }, context: undefined };
export const VOICE_ACTION_CALL: ActionCall<void> = { actor: { kind: 'voice', id: 'voice-session' }, context: undefined };

export const focusViewAction = (viewId: string): void => {
    void clientActions.execute('view.focus', { viewId }, PERSON_ACTION_CALL);
};

export const renameViewAction = (viewId: string, name: string): void => {
    void clientActions.execute('view.rename', { viewId, name }, PERSON_ACTION_CALL);
};
