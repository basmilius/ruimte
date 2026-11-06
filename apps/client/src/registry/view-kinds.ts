import type { ProjectView } from '@ruimte/contracts';
import { createElement, type ComponentType, type ReactNode } from 'react';
import { createRegistry } from './create-registry';

/*
 * One kind of view that fills a cell by itself, registered by the feature that owns it. The host of the
 * cell asks the registry, so a new kind of view touches its own folder and the wiring, not the host.
 */
export interface ViewKindDefinition {
    readonly id: string;
    /* The body of the view, or null when the view is not of this kind. */
    render(view: ProjectView, focused: boolean): ReactNode;
}

export const viewKindRegistry = createRegistry<ViewKindDefinition>('view kind');

export function viewKind<Own extends ProjectView>(definition: {
    id: string;
    owns(view: ProjectView): view is Own;
    body: ComponentType<{ view: Own; focused: boolean }>;
}): ViewKindDefinition {
    return {
        id: definition.id,
        render: (view, focused) => (definition.owns(view) ? createElement(definition.body, { view, focused }) : null)
    };
}

/* The test for a view of one kind, to say what a definition owns. */
export function viewOfKind<Kind extends ProjectView['kind']>(kind: Kind): (view: ProjectView) => view is Extract<ProjectView, { kind: Kind }> {
    return (view): view is Extract<ProjectView, { kind: Kind }> => view.kind === kind;
}
