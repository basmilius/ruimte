import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical, Play, SquareDashed } from 'lucide-react';
import type { FlowArgValue, FlowCard, FlowContent, FlowTestScope } from '@ruimte/contracts';
import { isTriggerCard, neededTokens, type FlowVisibleToken } from '@ruimte/flow';
import { FlowTokenDialog } from '@/flow/FlowTokenDialog';
import type { FlowStateHandle } from '@/flow/use-flow-state';
import { Button } from '@/ui/Button';
import { SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

interface Pending {
    scope: FlowTestScope;
    tokens: FlowVisibleToken[];
}

/*
 * The three ways to try a card out. A flow you cannot test is a flow you only trust after it went
 * right by accident three times, and with an agent at the end of it that takes a week, during which
 * it stays off. So: play on a card a run can begin at, everything from this card down, or this one
 * card on its own.
 *
 * Dry is what they send unless a person says otherwise. A test notification is harmless and a test
 * agent costs money and writes in a repository, and which is which belongs to the card in the
 * catalog rather than to a list here.
 */
export function FlowTestBar({ id, card, content, flow }: { id: string; card: FlowCard; content: FlowContent; flow: FlowStateHandle }) {
    const { t } = useTranslation('flow');
    const [dry, setDry] = useState(true);
    const [pending, setPending] = useState<Pending | null>(null);

    // A note does nothing and carries no line, so there is nothing to try out on it.
    if (card.kind === 'note') {
        return null;
    }

    const armedHere = flow.armed !== null && flow.armed.from === id;

    const begin = (scope: FlowTestScope): void => {
        const tokens = neededTokens(content, id, scope);
        if (tokens.length === 0) {
            // Nothing above this card is reached for, so there is nothing to ask about.
            void flow.test({ from: id, scope, dry });
            return;
        }
        setPending({ scope, tokens });
    };

    const run = (scope: FlowTestScope, tokens: Record<string, FlowArgValue>): void => {
        setPending(null);
        void flow.test({ from: id, scope, dry, tokens });
    };

    return (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
            <span className={SECTION_LABEL}>{t('test.title')}</span>
            <div className="flex flex-wrap gap-2">
                {isTriggerCard(card) && (
                    <Button onClick={() => begin('graph')}>
                        <Icon icon={Play} size={12} /> {t('test.play')}
                    </Button>
                )}
                {!isTriggerCard(card) && (
                    <Button onClick={() => begin('graph')}>
                        <Icon icon={FlaskConical} size={12} /> {t('test.fromHere')}
                    </Button>
                )}
                <Button onClick={() => begin('card')}>
                    <Icon icon={SquareDashed} size={12} /> {t('test.onlyThis')}
                </Button>
            </div>
            <label className="flex items-center gap-2 text-xs/[inherit] text-text-muted">
                <input type="checkbox" className="h-4 w-4 accent-accent" checked={dry} onChange={(e) => setDry(e.target.checked)} />
                {t('test.dry')}
            </label>
            <p className="text-xs/[inherit] text-text-faint">{dry ? t('test.dryHint') : t('test.realHint')}</p>
            {armedHere && (
                <div className="flex items-center justify-between gap-2 rounded-md bg-surface-sunken px-2 py-1.5">
                    <span className="min-w-0 text-xs/[inherit] text-text-muted">{t('test.waiting')}</span>
                    <Button size="sm" onClick={() => void flow.arm(null)}>
                        {t('test.stopWaiting')}
                    </Button>
                </div>
            )}
            {flow.error !== null && (
                <p className="text-xs/[inherit] text-status-error" role="alert">
                    {flow.error}
                </p>
            )}
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
        </div>
    );
}
