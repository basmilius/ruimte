import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { CircleAlert, CornerDownRight, GitMerge, Play, Split, StickyNote, Timer } from 'lucide-react';
import type { FlowCard, FlowContent } from '@ruimte/contracts';
import { missingArgsOf, portsOf, textArg } from '@ruimte/flow';
import { CARD_H, CARD_W, NOTE_H } from '@/flow/geometry';
import { cardLabel, cardSentence, cardSource } from '@/flow/labels';
import { Icon } from '@/ui/Icon';

/*
 * The mark of a card. A trigger, a condition and an action are told apart by their shape and their
 * ports rather than by a color, so the built-in cards are the only ones with a glyph of their own.
 */
const BUILT_IN_GLYPHS = { start: Play, delay: Timer, any: Split, all: GitMerge, note: StickyNote } as const;

/*
 * One card on the worksheet. A trigger has no way in and one way out, a condition has two ways out,
 * and an action has one or two: whether it can fail is in its own schema. That is what tells them
 * apart at a glance, and it works for anyone who reads color poorly.
 */
export function FlowCardBox({ id, card, content, selected }: { id: string; card: FlowCard; content: FlowContent; selected: boolean }) {
    const { t } = useTranslation('flow');
    const ports = portsOf(card);
    const missing = missingArgsOf(card);
    const parts = cardSentence(t, content, card);
    const glyph = card.card === undefined ? BUILT_IN_GLYPHS[card.kind as keyof typeof BUILT_IN_GLYPHS] : null;

    if (card.kind === 'note') {
        return (
            <div
                data-flow-card={id}
                className={clsx(
                    'pointer-events-auto absolute overflow-hidden rounded-lg border border-border bg-note-yellow p-3 text-sm whitespace-pre-wrap text-text',
                    selected && 'ring-2 ring-accent'
                )}
                style={{ left: card.x, top: card.y, width: CARD_W, height: NOTE_H }}
            >
                {textArg(card, 'text') || t('builtIn.note.placeholder')}
            </div>
        );
    }

    return (
        <div
            data-flow-card={id}
            className={clsx(
                'pointer-events-auto absolute flex flex-col justify-center gap-0.5 border border-border bg-surface-raised px-3 shadow-float',
                /* Three silhouettes, so a full worksheet reads without its text and without color: a
                   trigger is round where a run starts and square where it leaves, a condition is round
                   on both ends because it asks something, and an action is a square box that does. */
                card.kind === 'trigger' || card.kind === 'start' ? 'rounded-l-2xl rounded-r-lg' : card.kind === 'condition' ? 'rounded-2xl' : 'rounded-lg',
                selected && 'ring-2 ring-accent'
            )}
            style={{ left: card.x, top: card.y, width: CARD_W, height: CARD_H }}
        >
            <div className="flex items-center gap-1.5 text-xs/[inherit] text-text-faint">
                {glyph !== null && <Icon icon={glyph} size={12} />}
                <span className="truncate">{cardSource(t, card)}</span>
                {missing.length > 0 && <Icon icon={CircleAlert} size={12} className="ml-auto text-status-needs-you" />}
            </div>
            <div className="line-clamp-2 text-sm/tight text-text">
                {parts.length === 0
                    ? cardLabel(t, card)
                    : parts.map((part, index) => (
                          <span key={index} className={part.value ? 'font-medium text-text' : 'text-text-muted'}>
                              {part.text}
                          </span>
                      ))}
            </div>
            {card.inverted === true && (
                <div className="flex items-center gap-1 text-xs/[inherit] text-text-faint">
                    <Icon icon={CornerDownRight} size={12} /> {t('inspector.inverted')}
                </div>
            )}
            {/* The ports are drawn in the layer under the cards, with the lines they belong to. */}
            <span className="sr-only">
                {ports.map((port) => t(`ports.${port}`)).join(', ')}
                {missing.length > 0 && ` ${t('inspector.missing', { fields: missing.join(', ') })}`}
            </span>
        </div>
    );
}
