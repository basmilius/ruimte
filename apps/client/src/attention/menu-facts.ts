import { nextWaitingTitle } from '@/attention/next-waiting';
import type { MenuFacts, MenuHost } from '@/commands/menu-context';
import { useDocument } from '@/state/document';
import { usePromptStacks } from '@/surface/canvas/prompt-stack';

declare module '@/commands/menu-context' {
    interface MenuFacts {
        promptStack: boolean;
        somethingWaits: boolean;
    }
}

export function attentionFacts(_host: MenuHost): Pick<MenuFacts, 'promptStack' | 'somethingWaits'> {
    const { activeViewId, views } = useDocument.getState();
    const onCanvas = views.some((view) => view.id === activeViewId && view.kind === 'canvas');

    return {
        promptStack: onCanvas && activeViewId !== null && usePromptStacks.getState().byView.has(activeViewId),
        somethingWaits: nextWaitingTitle() !== null
    };
}
