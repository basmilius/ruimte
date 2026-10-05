import i18next from 'i18next';
import type { AgentKind } from '@ruimte/contracts';
import type { Shortcut } from '@basmilius/desktop-ui';
import { offerDraft } from '@ruimte/agents-react/chat/drafts';
import { chatsLinkedTo } from '@/context/sources';
import { createNodeAction, linkNodesAction } from '@/actions/client-actions';
import { focusChat } from '@/plan/plan-actions';
import { showFileOnCanvas } from '@/project/views';
import { canvasOfNode, NODE_SIZE } from '@/state/canvas';
import { useToasts } from '@/state/toasts';
import { useChatChooser } from '@/chat/chat-chooser';

/* Where the text came from, which decides what a new chat gets a line from. */
export type SelectionSource = { readonly nodeId: string } | { readonly path: string };

/*
 * Text on its way to a chat's prompt. The block is what the draft receives, the label is what the
 * chooser says it adds. A file in a tab has no node, so it names its path and gets one when a new chat is asked for.
 */
export interface SelectionOffer {
    readonly block: string;
    readonly label: string;
    readonly source: SelectionSource;
    /* The key that opens the chooser, shown in its header. */
    readonly shortcut?: Shortcut;
    /* Called when the chooser closes without a pick, so the keyboard goes back to where the text was. */
    readonly returnFocus?: () => void;
}

/* A fence one backtick longer than any run in the text, so the text can never close its own block. */
export function fenceOf(text: string): string {
    const longest = (text.match(/`+/g) ?? []).reduce((most, run) => Math.max(most, run.length), 0);
    return '`'.repeat(Math.max(3, longest + 1));
}

/* `score.ts:24-31`, or `score.ts:24` for one line; lines count from 1. */
export function lineRangeLabel(path: string, startLine: number, endLine: number): string {
    return startLine === endLine ? `${path}:${startLine}` : `${path}:${startLine}-${endLine}`;
}

/* A heading and the text under it as a fenced block, which stands on its own when the chat reads it. */
export function selectionBlock(heading: string, text: string, language: string | null): string {
    const body = text.replace(/\n+$/, '');
    const fence = fenceOf(body);
    return `${heading}\n${fence}${language ?? ''}\n${body}\n${fence}`;
}

/*
 * Puts a block in a chat's prompt, below what was typed, and brings that chat into view. It is never
 * sent: the person reads it and presses Enter. The blank line after the block is where they type.
 */
export function sendToChat(chatId: string, block: string): void {
    offerDraft(chatId, `${block}\n\n`);
    focusChat(chatId);
}

/* The chats a line connects to this node, on the canvas it stands on. */
export function linkedChatsOfNode(nodeId: string): string[] {
    const canvas = canvasOfNode(nodeId)?.getState();
    return canvas === undefined ? [] : chatsLinkedTo(canvas.nodes, canvas.texts, canvas.edges, nodeId);
}

/*
 * A new chat beside the node, with a line from it, and the block in its prompt. A file that is only a
 * tab becomes a node first, since a line needs something to start from. Null when no canvas could take it.
 */
export async function startLinkedChat(offer: SelectionOffer, provider: AgentKind | null): Promise<string | null> {
    const nodeId = 'nodeId' in offer.source ? offer.source.nodeId : await showFileOnCanvas(offer.source.path);
    const canvas = nodeId === null ? undefined : canvasOfNode(nodeId)?.getState();
    const box = nodeId === null ? undefined : canvas?.nodes[nodeId];
    if (nodeId === null || canvas === undefined || canvas.viewId === null || box === undefined) {
        return null;
    }
    const at = { x: box.x + box.w + 40 + NODE_SIZE.chat.w / 2, y: box.y + box.h / 2 };
    const chatId = await createNodeAction('chat', { viewId: canvas.viewId, at, ...(provider === null ? {} : { provider }) });
    if (chatId === null) {
        return null;
    }
    await linkNodesAction(canvas.viewId, nodeId, chatId);
    sendToChat(chatId, offer.block);
    return chatId;
}

/* `startLinkedChat` with the failure said out loud, for the menus that have no place of their own to say it. */
export async function startLinkedChatOrTell(offer: SelectionOffer, provider: AgentKind | null): Promise<void> {
    if ((await startLinkedChat(offer, provider)) === null) {
        useToasts.getState().show({ kind: 'error', title: i18next.t('chat:selection.noChat') });
    }
}

/*
 * What a command to add text to a chat does. One chat linked to the source is where it goes, with no
 * question asked; any other count opens the chooser at the point the caller names.
 */
export function offerSelection(offer: SelectionOffer, at: { x: number; y: number }): void {
    const linked = 'nodeId' in offer.source ? linkedChatsOfNode(offer.source.nodeId) : [];
    if (linked.length === 1) {
        sendToChat(linked[0]!, offer.block);
        return;
    }
    useChatChooser.getState().open(offer, at);
}
