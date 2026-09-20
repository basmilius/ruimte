import type { FlowArgValue, FlowCard, FlowNoticeEvent } from '@ruimte/contracts';

export interface FlowCardContext {
    projectId: string;
    viewId: string;
    /* The name a person sees for this flow, which is what a notification signs itself with. */
    flowName: string;
    runId: string;
    cardId: string;
    card: FlowCard;
    /*
     * Whether a person started this run to try the flow out. A card that could set another flow off
     * refuses while it is set, and that has to hold in the real mode too, where every card is carried
     * out: otherwise you test one flow and start a chain. Nothing in today's catalog can, so nothing
     * reads it yet; the webhook and the card that fires a flow are the first that will.
     */
    test: boolean;
    /* A field of the card with the tokens of this run written into it. */
    text(name: string): string;
}

/*
 * How a card ended. A condition answers, an action is done or failed, and a failure only takes
 * another path when the card said it could fail; otherwise the branch stops there.
 */
export type FlowCardOutcome =
    | { kind: 'done'; tokens?: Record<string, FlowArgValue>; note?: string }
    | { kind: 'failed'; note: string }
    | { kind: 'answered'; value: boolean; note?: string };

export type FlowCardHandler = (context: FlowCardContext) => Promise<FlowCardOutcome> | FlowCardOutcome;

export interface FlowCardDeps {
    /* Puts a notification on the screens of this machine. */
    notify(event: FlowNoticeEvent): void;
    /* Opens a turn in a chat with this text, or false when there is no such chat any more. */
    message(chatId: string, text: string, label: string): Promise<boolean>;
    now(): number;
}

/* What each card in the catalog actually does. A card with no handler here refuses, in the timeline. */
export const flowCardHandlers = (deps: FlowCardDeps): Record<string, FlowCardHandler> => ({
    'text.contains': (context) => {
        const haystack = context.text('text');
        const value = context.text('value');
        if (context.card.args.mode === 'matches') {
            try {
                return { kind: 'answered', value: new RegExp(value).test(haystack), note: `matched ${value}` };
            } catch {
                // A pattern that will not compile is not false, it is a card that cannot answer.
                return { kind: 'failed', note: `"${value}" is not a pattern this can read` };
            }
        }
        return { kind: 'answered', value: haystack.includes(value), note: `looked for "${value}"` };
    },

    'person.notify': (context) => {
        const text = context.text('text');
        deps.notify({ projectId: context.projectId, viewId: context.viewId, flow: context.flowName, text, at: deps.now() });
        return { kind: 'done', note: text };
    },

    'chat.message': async (context) => {
        const chatId = context.text('chat');
        const text = context.text('text');
        if (chatId === '') {
            return { kind: 'failed', note: 'This card has no chat to send to' };
        }
        const sent = await deps.message(chatId, text, `Message from flow ${context.flowName}`);
        return sent ? { kind: 'done', note: text } : { kind: 'failed', note: `There is no chat ${chatId} in this project any more` };
    }
});
