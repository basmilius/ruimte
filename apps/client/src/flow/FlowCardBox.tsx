import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { CircleAlert, CornerDownRight, Play } from 'lucide-react';
import type { FlowCard, FlowContent } from '@ruimte/contracts';
import { missingArgsOf, portsOf, textArg } from '@ruimte/flow';
import { cardRect, ICON_SIZE, roundingOf } from '@/flow/geometry';
import { glyphOf } from '@/flow/glyphs';
import { cardLabel, cardSentence, cardSource } from '@/flow/labels';
import { Icon } from '@/ui/Icon';

/* The kinds that carry a word and no sentence, which is what makes them narrow. */
const isPill = (card: FlowCard): boolean => card.kind === 'delay' || card.kind === 'any' || card.kind === 'all';

/*
 * One card on the worksheet. A trigger has no way in and one way out, a condition has two ways out,
 * and an action has one or two: whether it can fail is in its own schema. That is what tells them
 * apart at a glance, and it works for anyone who reads color poorly.
 */
export function FlowCardBox({ id, card, content, selected }: { id: string; card: FlowCard; content: FlowContent; selected: boolean }) {
    const { t } = useTranslation('flow');
    const ports = portsOf(card);
    const missing = missingArgsOf(card);
    const rect = cardRect(card);
    const rounding = roundingOf(card);
    const style = {
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        borderRadius: `${rounding.left}px ${rounding.right}px ${rounding.right}px ${rounding.left}px`
    };

    if (card.kind === 'note') {
        return (
            <div
                data-flow-card={id}
                className={clsx(
                    'pointer-events-auto absolute overflow-hidden border border-border bg-note-yellow p-3 text-sm whitespace-pre-wrap text-text',
                    selected && 'ring-2 ring-accent'
                )}
                style={style}
            >
                {textArg(card, 'text') || t('builtIn.note.placeholder')}
            </div>
        );
    }

    const shell = clsx('pointer-events-auto absolute border border-border bg-surface-raised shadow-float', selected && 'ring-2 ring-accent');

    if (card.kind === 'start') {
        return (
            <div data-flow-card={id} className={clsx(shell, 'grid place-items-center')} style={style} aria-label={cardLabel(t, card)}>
                <Icon icon={Play} size={20} className="text-text-muted" />
                <span className="sr-only">{cardLabel(t, card)}</span>
            </div>
        );
    }

    if (isPill(card)) {
        return (
            <div data-flow-card={id} className={clsx(shell, 'flex items-center justify-center gap-2 px-4')} style={style}>
                <Icon icon={glyphOf(card)} size={16} className="shrink-0 text-text-muted" />
                <span className="truncate text-sm text-text">{sentenceOf(t, content, card)}</span>
            </div>
        );
    }

    return (
        <div data-flow-card={id} className={clsx(shell, 'flex items-center gap-3 px-3')} style={style}>
            <div className="grid shrink-0 place-items-center rounded-full bg-surface-sunken text-text-muted" style={{ width: ICON_SIZE, height: ICON_SIZE }}>
                <Icon icon={glyphOf(card)} size={18} />
            </div>
            <div className="flex min-w-0 grow flex-col gap-0.5">
                <div className="flex items-center gap-1.5 text-xs/[inherit] text-text-faint">
                    <span className="truncate">{cardSource(t, card)}</span>
                    {card.inverted === true && <Icon icon={CornerDownRight} size={12} />}
                </div>
                <div className="line-clamp-2 text-sm/tight text-text">{sentenceOf(t, content, card)}</div>
            </div>
            {missing.length > 0 && <Icon icon={CircleAlert} size={14} className="shrink-0 text-status-needs-you" />}
            {/* The ports are drawn in the layer under the cards, with the lines they belong to. */}
            <span className="sr-only">
                {ports.map((port) => t(`ports.${port}`)).join(', ')}
                {missing.length > 0 && ` ${t('inspector.missing', { fields: missing.join(', ') })}`}
            </span>
        </div>
    );
}

/* The sentence of a card, with the values a person filled in drawn heavier than the words around them. */
function sentenceOf(t: ReturnType<typeof useTranslation<'flow'>>['t'], content: FlowContent, card: FlowCard) {
    const parts = cardSentence(t, content, card);
    if (parts.length === 0) {
        return cardLabel(t, card);
    }
    return parts.map((part, index) => (
        <span key={index} className={part.value ? 'font-medium text-text' : 'text-text-muted'}>
            {part.text}
        </span>
    ));
}
