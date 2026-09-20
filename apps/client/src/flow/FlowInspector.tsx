import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { isCanvasView, type FlowArgDefinition, type FlowCard, type FlowContent, type ProjectView } from '@ruimte/contracts';
import { argApplies, argsOf, brokenTokenRefsIn, textArg, tokenRef, visibleTokens } from '@ruimte/flow';
import { argLabel, cardLabel, choiceLabel, tokenLabel } from '@/flow/labels';
import { useDocument } from '@/state/document';
import { useFlow, useFlowStore } from '@/state/flow';
import { FLOAT } from '@/ui/classes';
import { Select } from '@/ui/Select';

/* Every chat in the project, wherever it stands, for a card that has to name one. */
export const chatChoices = (views: readonly ProjectView[]): { id: string; name: string }[] => {
    const chats: { id: string; name: string }[] = [];
    for (const view of views) {
        if (view.kind === 'chat') {
            // A chat view has no node id of its own: the view is the chat.
            chats.push({ id: view.id, name: view.name });
        } else if (isCanvasView(view)) {
            chats.push(...view.nodes.filter((node) => node.kind === 'chat').map((node) => ({ id: node.id, name: node.title || view.name })));
        }
    }
    return chats;
};

/* One field of a card, in the shape its type asks for. */
function Field({ id, card, content, arg }: { id: string; card: FlowCard; content: FlowContent; arg: FlowArgDefinition }) {
    const { t } = useTranslation('flow');
    const store = useFlowStore();
    const views = useDocument((s) => s.views);
    const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
    const value = textArg(card, arg.name);
    const set = (next: string | number | boolean): void => store.getState().setArg(id, arg.name, next);
    const tokens = arg.tokens === true ? visibleTokens(content, id) : [];

    /* A token goes in where the text was last left, so it reads as part of the sentence. */
    const insert = (cardId: string, token: string): void => {
        const field = input.current;
        const at = field?.selectionStart ?? value.length;
        set(`${value.slice(0, at)}${tokenRef(cardId, token)}${value.slice(field?.selectionEnd ?? at)}`);
        field?.focus();
    };

    return (
        <label className="flex flex-col gap-1 text-xs/[inherit] font-medium text-text-muted">
            {argLabel(t, card, arg.name)}
            {arg.type === 'choice' ? (
                <Select
                    value={value === '' ? null : value}
                    onValueChange={set}
                    items={(arg.choices ?? []).map((choice) => ({ value: choice, label: choiceLabel(t, card, choice) }))}
                    label={argLabel(t, card, arg.name)}
                    size="sm"
                />
            ) : arg.type === 'chat' ? (
                <Select
                    value={value === '' ? null : value}
                    onValueChange={set}
                    items={chatChoices(views).map((chat) => ({ value: chat.id, label: chat.name }))}
                    label={argLabel(t, card, arg.name)}
                    placeholder={t('inspector.pickChat')}
                    size="sm"
                />
            ) : arg.type === 'boolean' ? (
                <input type="checkbox" className="h-4 w-4 accent-accent" checked={card.args[arg.name] === true} onChange={(e) => set(e.target.checked)} />
            ) : arg.type === 'number' ? (
                <input type="number" className="field" value={value} onChange={(e) => set(e.target.value === '' ? '' : Number(e.target.value))} />
            ) : arg.type === 'longText' ? (
                <textarea
                    ref={input as React.RefObject<HTMLTextAreaElement>}
                    className="field min-h-20 py-1.5"
                    value={value}
                    onChange={(e) => set(e.target.value)}
                />
            ) : (
                <input
                    ref={input as React.RefObject<HTMLInputElement>}
                    type={arg.type === 'time' ? 'time' : 'text'}
                    className="field"
                    value={value}
                    onChange={(e) => set(e.target.value)}
                />
            )}
            {tokens.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                    {tokens.map((entry) => (
                        <button
                            key={`${entry.cardId}.${entry.token.name}`}
                            type="button"
                            className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs/[inherit] font-normal text-text-muted hover:text-text"
                            onClick={() => insert(entry.cardId, entry.token.name)}
                        >
                            {tokenLabel(t, content.cards[entry.cardId] as FlowCard, entry.token.name)}
                        </button>
                    ))}
                </div>
            )}
        </label>
    );
}

/*
 * What the card a person picked holds. It draws its fields from the catalog, so a card that is added
 * to the schemas gets its fields here without a line of interface behind it, and the tokens it may
 * use are the ones every path to it passes.
 */
export function FlowInspector() {
    const { t } = useTranslation('flow');
    const store = useFlowStore();
    const content = useFlow((s) => s.content);
    const selection = useFlow((s) => s.selection);
    const id = selection.length === 1 ? (selection[0] as string) : null;
    const card = id === null ? undefined : content.cards[id];
    if (id === null || card === undefined) {
        return null;
    }
    const fields = argsOf(card).filter((arg) => argApplies(card, arg));
    const broken = brokenTokenRefsIn(content).filter((ref) => ref.on === id);

    return (
        <aside
            data-flow-chrome
            className={clsx(FLOAT, 'absolute top-3 right-3 bottom-20 flex w-72 flex-col gap-3 overflow-y-auto rounded-xl p-3')}
            aria-label={t('inspector.title')}
        >
            <div className="text-sm font-medium text-text">{cardLabel(t, card)}</div>
            {fields.map((arg) => (
                <Field key={arg.name} id={id} card={card} content={content} arg={arg} />
            ))}
            {card.kind === 'condition' && (
                <label className="flex items-center gap-2 text-xs/[inherit] text-text-muted">
                    <input
                        type="checkbox"
                        className="h-4 w-4 accent-accent"
                        checked={card.inverted === true}
                        onChange={(e) => store.getState().setInverted(id, e.target.checked)}
                    />
                    {t('inspector.inverted')}
                </label>
            )}
            {broken.length > 0 && <p className="text-xs/[inherit] text-status-error">{t('inspector.broken')}</p>}
        </aside>
    );
}
