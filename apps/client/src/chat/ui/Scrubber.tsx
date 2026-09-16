import { memo, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { PreviewCard } from '@base-ui-components/react/preview-card';
import clsx from 'clsx';
import { Copy, type LucideIcon } from 'lucide-react';
import { layoutTicks, messageAt, slotOf, tickWidth, TICK_HEIGHT_PX, type ScrubberTick } from '@/chat/logic/scrubber';
import { MENU_SEPARATOR } from '@/ui/classes';
import { copyText } from '@/ui/clipboard';
import { Icon } from '@/ui/Icon';

const PREVIEW_CHARS = 280;

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const DAY_CLOCK = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const timeOf = (createdAt: number): string => {
    const date = new Date(createdAt);
    return date.toDateString() === new Date().toDateString() ? CLOCK.format(date) : DAY_CLOCK.format(date);
};

/*
 * What the card offers for a message. "Fork from here" joins this union and `CARD_ACTIONS` once a
 * chat can fork; until then it is not drawn at all, not even disabled.
 */
type CardActionId = 'copy-message';

interface CardAction {
    label: string;
    icon: LucideIcon;
    /* Whether a tick of this kind offers the action. */
    offers(tick: ScrubberTick): boolean;
    run(tick: ScrubberTick): void;
}

const CARD_ACTIONS: Record<CardActionId, CardAction> = {
    'copy-message': {
        label: 'Copy message',
        icon: Copy,
        // A wake carries the machine's label, not anything a person wrote.
        offers: (tick) => tick.kind === 'person' && tick.text !== '',
        run: (tick) => copyText(tick.text)
    }
};

interface ScrubberProps {
    ticks: readonly ScrubberTick[];
    /* The index in `ticks` of the message being read. */
    activeIndex: number | null;
    onPick(index: number): void;
}

/*
 * The strip beside a thread: a tick per message of the person and per wake by tasks, the one being
 * read lit and longer. A single hover card follows the pointer along the strip, anchored at the tick
 * it points at, so a thousand ticks are a thousand spans and not a thousand popups.
 */
export const Scrubber = memo(function Scrubber({ ticks, activeIndex, onPick }: ScrubberProps) {
    // State rather than a ref: the card's anchor is built during render and has to change when the strip does.
    const [strip, setStrip] = useState<HTMLDivElement | null>(null);
    const [height, setHeight] = useState(0);
    // The message the card is about; it stays while the card closes, so the card never empties as it fades.
    const [hovered, setHovered] = useState<number | null>(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (strip === null || typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(() => setHeight(strip.offsetHeight));
        observer.observe(strip);
        return () => observer.disconnect();
    }, [strip]);

    const kinds = useMemo(() => ticks.map((tick) => tick.kind), [ticks]);
    const layout = useMemo(() => layoutTicks(kinds, height), [kinds, height]);
    const activeSlot = activeIndex === null ? null : slotOf(layout, activeIndex);
    const hoveredTick = hovered === null ? null : (ticks[hovered] ?? null);
    const hoveredSlot = hovered === null ? null : slotOf(layout, hovered);
    const anchorY = hoveredSlot === null ? null : layout.slots[hoveredSlot]!.y;

    const anchor = useMemo(() => {
        const element = strip;
        if (anchorY === null || element === null) {
            return undefined;
        }
        return {
            contextElement: element,
            getBoundingClientRect: () => {
                const rect = element.getBoundingClientRect();
                return DOMRect.fromRect({ x: rect.left, y: rect.top + anchorY + TICK_HEIGHT_PX / 2, width: rect.width, height: 0 });
            }
        };
    }, [anchorY, strip]);

    const pointAt = (e: ReactMouseEvent<HTMLDivElement>): number | null => messageAt(layout, e.clientY - e.currentTarget.getBoundingClientRect().top);

    const actions = hoveredTick === null ? [] : Object.values(CARD_ACTIONS).filter((action) => action.offers(hoveredTick));

    return (
        <PreviewCard.Root onOpenChange={setOpen}>
            <PreviewCard.Trigger
                delay={150}
                closeDelay={150}
                render={
                    <div
                        ref={setStrip}
                        role="navigation"
                        aria-label="Messages in this thread"
                        className="relative h-full w-full cursor-pointer select-none"
                        onPointerMove={(e) => {
                            const index = pointAt(e);
                            if (index !== hovered) {
                                setHovered(index);
                            }
                        }}
                        onClick={(e) => {
                            const index = pointAt(e);
                            if (index !== null) {
                                onPick(index);
                            }
                        }}
                    />
                }
            >
                {layout.slots.map((slot, index) => {
                    const distance = activeSlot === null ? null : Math.abs(index - activeSlot);
                    return (
                        <span
                            key={slot.first}
                            aria-hidden
                            className={clsx(
                                'absolute left-1 rounded-full transition-[width,background-color] duration-150',
                                distance === 0
                                    ? 'bg-text'
                                    : open && index === hoveredSlot
                                      ? 'bg-text-muted'
                                      : slot.kind === 'wake'
                                        ? 'bg-text-faint/50'
                                        : 'bg-text-faint'
                            )}
                            style={{ top: slot.y, height: TICK_HEIGHT_PX, width: tickWidth(slot.kind, distance) }}
                        />
                    );
                })}
            </PreviewCard.Trigger>
            <PreviewCard.Portal>
                <PreviewCard.Positioner anchor={anchor} side="right" align="center" sideOffset={4} className="z-(--z-popup)">
                    <PreviewCard.Popup className="menu-popup w-72">
                        {hoveredTick !== null && (
                            <>
                                <div className="px-2.5 pt-1.5 pb-2">
                                    <div className="flex items-baseline justify-between gap-3 text-xs text-text-faint">
                                        <span>{hoveredTick.kind === 'person' ? 'You' : 'Tasks'}</span>
                                        <time className="tabular-nums">{timeOf(hoveredTick.createdAt)}</time>
                                    </div>
                                    <p className="mt-1 line-clamp-4 text-sm break-words whitespace-pre-line text-text">
                                        {hoveredTick.text.slice(0, PREVIEW_CHARS) || 'No text'}
                                    </p>
                                </div>
                                {actions.length > 0 && (
                                    <>
                                        <div className={MENU_SEPARATOR} />
                                        {actions.map((action) => (
                                            <button
                                                key={action.label}
                                                type="button"
                                                className="menu-item w-full hover:bg-surface-hover"
                                                onClick={() => action.run(hoveredTick)}
                                            >
                                                <Icon icon={action.icon} size={14} /> {action.label}
                                            </button>
                                        ))}
                                    </>
                                )}
                            </>
                        )}
                    </PreviewCard.Popup>
                </PreviewCard.Positioner>
            </PreviewCard.Portal>
        </PreviewCard.Root>
    );
});
