import type { VisualStore } from '@adecore/agents/chat';
import type { VisualHost } from '../canvas/verb.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import { countUsage } from '../stats/usage-stats.ts';
import { previewVisual, type VisualRenderer } from './renderer.ts';

export interface AgentVisualDeps {
    /* The machine's switch that lets an agent show a new visual. */
    enabled(): boolean;
    visuals: Pick<VisualStore, 'writeSource' | 'writePreview'>;
    chats: Pick<ChatManager, 'publishVisual' | 'listVisuals' | 'removeVisual'>;
    /* Absent on a host that renders no page, where a preview is refused and a page shows without heights. */
    renderer?: VisualRenderer;
}

/* The pages the caller's own chat shows above its replies, as the `visual` verb reaches them. */
export function agentVisuals(deps: AgentVisualDeps): VisualHost {
    const { visuals, chats, renderer } = deps;
    return {
        enabled: () => deps.enabled(),
        writeSource: (chatId, name, html) => visuals.writeSource(chatId, name, html),
        publish: async (chatId, visual) => {
            const shown = await chats.publishVisual(chatId, visual);
            countUsage('visuals.shown');
            return shown;
        },
        list: (chatId) => chats.listVisuals(chatId),
        remove: (chatId, visualId) => chats.removeVisual(chatId, visualId),
        ...(renderer === undefined
            ? {}
            : {
                  preview: (chatId, input) => previewVisual(renderer, (png) => visuals.writePreview(chatId, png), input),
                  measure: (html) => renderer.measure(html)
              })
    };
}
