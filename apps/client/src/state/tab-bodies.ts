import { createElement, type ComponentType, type ReactNode } from 'react';
import { createRegistry } from '@/registry/create-registry';
import type { Tab } from '@/state/files';

/*
 * What draws a loose tab that is not a file: a feature owns a kind of tab and its body, and the viewer
 * of loose tabs asks the registry, so it imports none of them.
 */
export interface TabBodyDefinition {
    readonly id: string;
    /* The words of the boundary around the body, read when it fails. */
    readonly failed: () => string;
    /* The body of the tab, or null when the tab is not of this kind. */
    render(tab: Tab): ReactNode;
}

export const tabBodyRegistry = createRegistry<TabBodyDefinition>('tab body');

export function tabBody<Own extends Tab>(definition: {
    id: string;
    owns(tab: Tab): tab is Own;
    failed(): string;
    body: ComponentType<{ tab: Own }>;
}): TabBodyDefinition {
    return {
        id: definition.id,
        failed: definition.failed,
        render: (tab) => (definition.owns(tab) ? createElement(definition.body, { tab }) : null)
    };
}
