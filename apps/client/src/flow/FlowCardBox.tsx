import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { CircleAlert, CornerDownRight, Timer } from 'lucide-react';
import type { FlowCard, FlowContent } from '@ruimte/contracts';
import { argsOf, portsOf, textArg, type FlowArgProblem } from '@ruimte/flow';
import { FlowArgSlot } from '@/flow/FlowArgSlot';
import type { FlowCardResult } from '@/flow/card-result';
import { cardRect, ICON_SIZE, roundingOf } from '@/flow/geometry';
import { glyphOf } from '@/flow/glyphs';
import type { CardLight } from '@/flow/live-look';
import { argLabel, cardLabel, cardSentence, cardSource } from '@/flow/labels';
import { plateClass } from '@/flow/source-look';
import { formatDuration } from '@/format/duration';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/* The kinds that carry a word and no sentence, which is what makes them a chip. */
const isChip = (card: FlowCard): boolean => card.kind === 'delay' || card.kind === 'any' || card.kind === 'all';

/* The round plate the source icon sits in, on the left of every card and every chip alike. */
function IconPlate({ card, size }: { card: FlowCard; size: number }) {
    return (
        <div
            className={clsx('grid shrink-0 place-items-center rounded-full text-flow-source-ink', plateClass(card))}
            style={{ width: ICON_SIZE, height: ICON_SIZE }}
        >
            <Icon icon={glyphOf(card)} size={size} />
        </div>
    );
}

interface FlowCardBoxProps {
    id: string;
    card: FlowCard;
    content: FlowContent;
    selected: boolean;
    /* What is wrong on this card, by field. Worked out once for the worksheet, not per card. */
    problems?: Record<string, FlowArgProblem>;
    /* Where a run that is going on right now stands on this card. */
    light?: CardLight;
    /* Flashes once, the moment this card settled. */
    pulse?: number;
    /* A test is waiting on this card for the next time its trigger really fires. */
    armed?: boolean;
    /* When this card was last asked to do something it cannot, so it shakes once for each time. */
    refused?: number;
    /* What this card did in the run being read: the one going on, or one picked in the drawer. */
    result?: FlowCardResult;
}

/*
 * One card on the worksheet. A trigger has no way in and one way out, a condition has two ways out,
 * and an action has one or two: whether it can fail is in its own schema. That is what tells them
 * apart at a glance, and it works for anyone who reads color poorly.
 *
 * Its values are filled in here rather than in a form beside it: a card is a sentence, and the parts
 * of it a person decides are controls in that sentence.
 */
export function FlowCardBox({ id, card, content, selected, problems, light, pulse, armed, refused, result }: FlowCardBoxProps) {
    const { t } = useTranslation('flow');
    const ports = portsOf(card);
    const wrong = Object.keys(problems ?? {});
    const rect = cardRect(card);
    const rounding = roundingOf(card);
    const style = {
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        borderRadius: `${rounding.left}px ${rounding.right}px ${rounding.right}px ${rounding.left}px`
    };

    /* A branch that died fades back rather than turning red: reaching a port nobody drew from is not
       a failure, it is where that branch ends. */
    const lit = clsx(light === 'dead' && 'opacity-40', light === 'ran' && 'border-accent');
    const flash = pulse === undefined ? null : <span key={pulse} className="flow-card-flash" />;
    /* A new element every refusal, since an animation that is already on does not start over. */
    const shakeKey = refused === undefined ? 'still' : `shake-${refused}`;

    if (card.kind === 'note') {
        return (
            <div
                data-flow-card={id}
                className={clsx(
                    'pointer-events-auto absolute overflow-hidden border border-border-soft bg-note-yellow p-3 text-sm whitespace-pre-wrap text-text',
                    selected && 'ring-2 ring-accent'
                )}
                style={style}
            >
                {textArg(card, 'text') || t('builtIn.note.placeholder')}
            </div>
        );
    }

    /* The shadow lifts a card off the worksheet on its own. A full border around it as well draws a
       box where there is only a lift, so the line is the softest one there is: it finishes the
       shadow rather than edging the card. */
    const shell = clsx('pointer-events-auto absolute border border-border-soft bg-surface-raised shadow-float', selected && 'ring-2 ring-accent', lit);

    if (card.kind === 'start') {
        return (
            <div data-flow-card={id} className={clsx(shell, 'grid place-items-center')} style={style} aria-label={cardLabel(t, card)}>
                <IconPlate card={card} size={18} />
                <span className="sr-only">{cardLabel(t, card)}</span>
                {flash}
            </div>
        );
    }

    if (isChip(card)) {
        return (
            <div
                key={shakeKey}
                data-flow-card={id}
                className={clsx(shell, 'flex items-center gap-2 p-2', card.kind === 'delay' && 'pr-3', refused !== undefined && 'flow-card-shake')}
                style={style}
            >
                <IconPlate card={card} size={18} />
                <span className="flex min-w-0 grow items-center gap-x-1 truncate text-sm text-text">
                    <Sentence id={id} card={card} content={content} problems={problems} />
                </span>
                {flash}
            </div>
        );
    }

    return (
        <div
            key={shakeKey}
            data-flow-card={id}
            className={clsx(shell, 'flex items-center gap-2 p-2', wrong.length > 0 && 'border-status-error', refused !== undefined && 'flow-card-shake')}
            style={style}
        >
            <IconPlate card={card} size={18} />
            <div className="flex min-w-0 grow flex-col gap-0.5">
                <div className="flex items-center gap-1.5 text-xs/[inherit] text-text-faint">
                    <span className="truncate">{cardSource(t, card)}</span>
                    {card.inverted === true && <Icon icon={CornerDownRight} size={12} />}
                    <Result card={card} result={result} />
                </div>
                <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1 text-sm/tight text-text">
                    <Sentence id={id} card={card} content={content} problems={problems} />
                </div>
            </div>
            {armed === true && <Icon icon={Timer} size={14} className="shrink-0 text-accent" aria-label={t('test.waiting')} />}
            {wrong.length > 0 && <Icon icon={CircleAlert} size={14} className="shrink-0 text-status-error" />}
            {/* The ports are drawn in the layer under the cards, with the lines they belong to. */}
            <span className="sr-only">
                {ports.map((port) => t(`ports.${port}`)).join(', ')}
                {wrong.length > 0 && ` ${t('inspector.missing', { fields: wrong.map((name) => argLabel(t, card, name)).join(', ') })}`}
            </span>
            {flash}
        </div>
    );
}

/* The sentence of a card: the words as words, and every value a person decides as its own control. */
function Sentence({ id, card, content, problems }: { id: string; card: FlowCard; content: FlowContent; problems?: Record<string, FlowArgProblem> }) {
    const { t } = useTranslation('flow');
    const parts = cardSentence(t, content, card);
    if (parts.length === 0) {
        return <span className="text-text-muted">{cardLabel(t, card)}</span>;
    }
    return parts.map((part, index) => {
        const arg = part.arg === undefined ? undefined : argsOf(card).find((candidate) => candidate.name === part.arg);
        if (arg === undefined) {
            return (
                <span key={index} className="whitespace-pre-wrap text-text-muted">
                    {part.text}
                </span>
            );
        }
        return <FlowArgSlot key={index} id={id} card={card} content={content} arg={arg} text={part.text} problem={problems?.[arg.name]} />;
    });
}

/*
 * What this card did the last time a run reached it, on the line it already carries: how long it
 * took, the way out it chose and whether it was written down rather than carried out. The sentence
 * it wrote is a tooltip, because in a dry run that sentence is the whole command or the whole
 * message and a card is not the place to read one of those.
 */
function Result({ card, result }: { card: FlowCard; result?: FlowCardResult }) {
    const { t } = useTranslation('flow');
    if (result === undefined) {
        return null;
    }
    const line = (
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {result.dry && <span className="rounded-full bg-surface-sunken px-1.5">{t('runs.dry')}</span>}
            {result.ms !== undefined && <span className="tabular-nums">{formatDuration(result.ms)}</span>}
            <span className={clsx(result.port === 'error' && 'text-status-error')}>
                {result.port === undefined ? t('runs.wentNowhere') : t(`ports.${result.port}`)}
            </span>
        </span>
    );
    if (result.note === undefined) {
        return line;
    }
    return <Tooltip label={`${cardLabel(t, card)}: ${result.note}`}>{line}</Tooltip>;
}
