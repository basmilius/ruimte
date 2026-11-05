import type { VisualStore } from '@adecore/agents/chat';
import type { ChatVisual, VisualAppearance, VisualHeight, VisualLayout } from '@ruimte/contracts';
import { countUsage } from '../stats/usage-stats.ts';
import { previewVisual, type VisualPreview, type VisualRenderer } from './renderer.ts';

interface AgentVisualDeps {
    /* The machine's switch that lets an agent show a new visual. */
    enabled(): boolean;
    visuals: Pick<VisualStore, 'writeSource' | 'writePreview'>;
    chats: {
        publishVisual(
            chatId: string,
            visual: { title: string; html: string; maxHeight?: number; layout?: VisualLayout; heights?: VisualHeight[] }
        ): Promise<ChatVisual>;
        listVisuals(chatId: string): Promise<ChatVisual[]>;
        removeVisual(chatId: string, visualId: string): Promise<ChatVisual[]>;
    };
    /* Absent on a host that renders no page, where a preview is refused and a page shows without heights. */
    renderer?: VisualRenderer;
}

/* `enabled` is the machine's switch that lets an agent show a new visual. */
export interface VisualHost {
    enabled(): boolean;
    writeSource?(chatId: string, name: string, html: string): Promise<string>;
    /* Refuses with the store's own code, `visual-invalid` or `visual-too-large`, and a message that says what to change. */
    publish(chatId: string, input: { title: string; html: string; maxHeight?: number; layout?: VisualLayout; heights?: VisualHeight[] }): Promise<ChatVisual>;
    list(chatId: string): Promise<ChatVisual[]>;
    remove(chatId: string, visualId: string): Promise<ChatVisual[]>;
    /* Refuses with `preview-unavailable`, `preview-timeout` or `preview-failed`; absent on a host that renders no page. */
    preview?(chatId: string, input: { html: string; width: number; appearance: VisualAppearance }): Promise<VisualPreview>;
    /* Undefined when measuring took too long or failed, which never stops a page from being shown. */
    measure?(html: string): Promise<VisualHeight[] | undefined>;
}

/* The pages the caller's own chat shows above its replies, as the `visual` tool reaches them. */
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
