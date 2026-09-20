import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Check, Copy, CornerDownRight, FlaskConical, Play, Replace, SquareDashed, Timer, Trash } from 'lucide-react';
import type { FlowArgValue, FlowCard, FlowContent, FlowTestScope } from '@ruimte/contracts';
import { cardHasProblem, isTriggerCard, neededTokens, type FlowArgProblem, type FlowVisibleToken } from '@ruimte/flow';
import { FlowCardPicker } from '@/flow/FlowCardPicker';
import { FlowTokenDialog } from '@/flow/FlowTokenDialog';
import type { FlowStateHandle } from '@/flow/use-flow-state';
import { useFlow, useFlowStore } from '@/state/flow';
import { MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

interface FlowCardMenuProps {
    id: string;
    card: FlowCard;
    content: FlowContent;
    flow: FlowStateHandle;
    /* What is wrong on this card, which is what a test refuses to start on. */
    problems: Readonly<Record<string, Record<string, FlowArgProblem>>>;
    /* Says the card was asked to do something it cannot, so it shakes rather than doing nothing. */
    onRefuse(id: string): void;
}

interface Pending {
    scope: FlowTestScope;
    tokens: FlowVisibleToken[];
}

/*
 * What a card can do, on the card. A flow you cannot test is a flow you only trust after it went
 * right by accident three times, and with an agent at the end of it that takes a week, during which
 * it stays off. So the three ways to try one out live where the card is: as if this trigger fired,
 * everything from here down, or this one card alone.
 *
 * Dry is what they send unless a person says otherwise. A test notification is harmless and a test
 * agent costs money and writes in a repository, and which is which belongs to the card in the
 * catalog rather than to a list here.
 */
export function FlowCardMenu({ id, card, content, flow, problems, onRefuse }: FlowCardMenuProps) {
    const { t } = useTranslation('flow');
    const store = useFlowStore();
    const dry = useFlow((s) => s.dryTest);
    const [pending, setPending] = useState<Pending | null>(null);
    const [replacing, setReplacing] = useState(false);

    // A note does nothing and carries no line, so there is nothing to try out on it.
    const testable = card.kind !== 'note';
    const armedHere = flow.armed !== null && flow.armed.from === id;

    const begin = (scope: FlowTestScope): void => {
        /* A card with a field that is empty or unreadable would refuse halfway through the run and
           leave a person looking at a timeline instead of at the card that is wrong. */
        if (cardHasProblem(problems, id)) {
            onRefuse(id);
            return;
        }
        const tokens = neededTokens(content, id, scope);
        if (tokens.length === 0) {
            // Nothing above this card is reached for, so there is nothing to ask about.
            run(scope, undefined);
            return;
        }
        setPending({ scope, tokens });
    };

    const run = (scope: FlowTestScope, tokens: Record<string, FlowArgValue> | undefined): void => {
        setPending(null);
        void flow.test({ from: id, scope, dry, ...(tokens === undefined ? {} : { tokens }) });
    };

    return (
        <>
            <ContextMenu.Portal>
                <ContextMenu.Positioner className="z-(--z-popup)">
                    <ContextMenu.Popup className="menu-popup">
                        {testable && isTriggerCard(card) && (
                            <ContextMenu.Item className="menu-item" onClick={() => begin('graph')}>
                                <Icon icon={Play} size={14} /> {t('test.play')}
                            </ContextMenu.Item>
                        )}
                        {testable && !isTriggerCard(card) && (
                            <ContextMenu.Item className="menu-item" onClick={() => begin('graph')}>
                                <Icon icon={FlaskConical} size={14} /> {t('test.fromHere')}
                            </ContextMenu.Item>
                        )}
                        {testable && (
                            <ContextMenu.Item className="menu-item" onClick={() => begin('card')}>
                                <Icon icon={SquareDashed} size={14} /> {t('test.onlyThis')}
                            </ContextMenu.Item>
                        )}
                        {testable && (
                            <ContextMenu.Item className="menu-item" closeOnClick={false} onClick={() => store.getState().setDryTest(!dry)}>
                                <span className="grid h-4 w-4 shrink-0 place-items-center">{dry && <Icon icon={Check} size={14} />}</span>
                                {t('test.dry')}
                            </ContextMenu.Item>
                        )}
                        {armedHere && (
                            <ContextMenu.Item className="menu-item" onClick={() => void flow.arm(null)}>
                                <Icon icon={Timer} size={14} /> {t('test.stopWaiting')}
                            </ContextMenu.Item>
                        )}
                        <ContextMenu.Separator className={MENU_SEPARATOR} />
                        <ContextMenu.Item className="menu-item" onClick={() => setReplacing(true)}>
                            <Icon icon={Replace} size={14} /> {t('menu.replace')}
                        </ContextMenu.Item>
                        <ContextMenu.Item className="menu-item" onClick={() => store.getState().duplicateCard(id)}>
                            <Icon icon={Copy} size={14} /> {t('menu.duplicate')}
                        </ContextMenu.Item>
                        {card.kind === 'condition' && (
                            <ContextMenu.Item className="menu-item" onClick={() => store.getState().setInverted(id, card.inverted !== true)}>
                                <span className="grid h-4 w-4 shrink-0 place-items-center">
                                    <Icon icon={card.inverted === true ? Check : CornerDownRight} size={14} />
                                </span>
                                {t('inspector.inverted')}
                            </ContextMenu.Item>
                        )}
                        <ContextMenu.Separator className={MENU_SEPARATOR} />
                        <ContextMenu.Item className="menu-item" onClick={() => store.getState().removeCards([id])}>
                            <Icon icon={Trash} size={14} /> {t('common:action.remove')}
                        </ContextMenu.Item>
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
            {pending !== null && (
                <FlowTokenDialog
                    content={content}
                    tokens={pending.tokens}
                    runs={flow.runs}
                    onRun={(values) => run(pending.scope, values)}
                    onWait={() => {
                        setPending(null);
                        void flow.arm({ from: id, scope: pending.scope, dry });
                    }}
                    onClose={() => setPending(null)}
                />
            )}
            {replacing && (
                <FlowCardPicker
                    /* Only its own kind: an action on a trigger's place is not a choice, and the lines
                       around this card were drawn for what it is. */
                    kinds={[card.kind]}
                    current={card.card === undefined ? { kind: card.kind } : { kind: card.kind, card: card.card }}
                    onPick={(choice) => {
                        setReplacing(false);
                        store.getState().replaceCard(id, choice.kind, choice.card);
                    }}
                    onClose={() => setReplacing(false)}
                />
            )}
        </>
    );
}
