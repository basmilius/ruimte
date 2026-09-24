import { Fragment, memo, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { PreviewCard } from '@base-ui-components/react/preview-card';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bookmark, Copy, GitFork, type LucideIcon } from 'lucide-react';
import { layoutTicks, messageAt, slotInView, slotOf, tickWidth, TICK_HEIGHT_PX, type ScrubberTick } from '@/chat/logic/scrubber';
import { BookmarkMenuItems } from '@/chat/ui/TimelineMenu';
import { formatMoment } from '@/format/datetime';
import { MENU_SEPARATOR } from '@/ui/classes';
import { copyText } from '@/ui/clipboard';
import { cameThroughPortal } from '@/ui/floating';
import { Icon } from '@/ui/Icon';

const PREVIEW_CHARS = 280;

const FOUND_WIDTH_PX = 4;

const timeOf = (createdAt: number): string => formatMoment(createdAt);

/* What the card may do to the chat the strip belongs to; absent, the card only offers what needs no chat. */
export interface CardChat {
    chatId: string;
    canFork(turnId: string): boolean;
    fork(turnId: string): void;
}

/* What the card offers for a message. An action a tick cannot take is not drawn at all, not even disabled. */
type CardActionId = 'copy-message' | 'fork';

interface CardAction {
    /* The key of its label in the `chat` namespace; the card reads the words where it draws them. */
    label: string;
    icon: LucideIcon;
    offers(tick: ScrubberTick, chat: CardChat | null): boolean;
    run(tick: ScrubberTick, chat: CardChat | null): void;
}

const CARD_ACTIONS: Record<CardActionId, CardAction> = {
    'copy-message': {
        label: 'timeline.menu.copyMessage',
        icon: Copy,
        // A wake carries the machine's label, not anything a person wrote.
        offers: (tick) => tick.kind === 'person' && tick.text !== '',
        run: (tick) => copyText(tick.text)
    },
    fork: {
        label: 'timeline.menu.forkFromHere',
        icon: GitFork,
        offers: (tick, chat) => chat !== null && tick.turnId !== null && chat.canFork(tick.turnId),
        run: (tick, chat) => {
            if (chat !== null && tick.turnId !== null) {
                chat.fork(tick.turnId);
            }
        }
    }
};

interface ScrubberProps {
    ticks: readonly ScrubberTick[];
    /* The indexes in `ticks` of the first and last message on screen; two numbers, so the memo holds while scrolling within them. */
    firstInView: number | null;
    lastInView: number | null;
    onPick(index: number): void;
    chat?: CardChat | null;
    /* Per tick, whether a find hit falls in its stretch of the thread; empty while nothing is searched. */
    found?: readonly boolean[];
    /* The tick of the hit the find bar is on. */
    foundCurrent?: number | null;
}

const NOTHING_FOUND: readonly boolean[] = [];

/*
 * The strip at the left edge of a chat view: a tick per message of the person, per wake by tasks and
 * per other message with a bookmark, the ones on screen bright and the rest dimmed, a bookmark in the accent, growing only under the pointer. A single hover card follows the pointer along the strip, anchored at the tick
 * it points at, so a thousand ticks are a thousand spans and not a thousand popups. While a find is
 * open, a short mark at the strip's right edge stands beside every tick with a hit under it.
 */
export const Scrubber = memo(function Scrubber({
    ticks,
    firstInView,
    lastInView,
    onPick,
    chat = null,
    found = NOTHING_FOUND,
    foundCurrent = null
}: ScrubberProps) {
    const { t } = useTranslation('chat');
    // State rather than a ref. The card's anchor is built during render and has to change when the strip does.
    const [strip, setStrip] = useState<HTMLDivElement | null>(null);
    const [height, setHeight] = useState(0);
    // The message the card is about; it stays while the card closes, so the card never empties as it fades.
    const [hovered, setHovered] = useState<number | null>(null);
    // Apart from `hovered`, which outlives the pointer for the card's sake. The ticks shrink back the moment it leaves.
    const [pointing, setPointing] = useState(false);
    const [cardOpen, setCardOpen] = useState(false);
    // The message a right-click was on, kept apart from `hovered`, which moves on with the pointer while the menu is up.
    const [menuIndex, setMenuIndex] = useState<number | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        if (strip === null || typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(() => setHeight(strip.offsetHeight));
        observer.observe(strip);
        return () => observer.disconnect();
    }, [strip]);

    const kinds = useMemo(() => ticks.map((tick) => tick.kind), [ticks]);
    const marked = useMemo(() => ticks.map((tick) => tick.bookmark !== null), [ticks]);
    const layout = useMemo(() => layoutTicks(kinds, height, marked, found), [kinds, height, marked, found]);
    const currentSlot = foundCurrent === null ? null : slotOf(layout, foundCurrent);
    const inView = firstInView === null || lastInView === null ? null : { first: firstInView, last: lastInView };
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

    const actionsFor = (tick: ScrubberTick | null): CardAction[] =>
        tick === null ? [] : Object.values(CARD_ACTIONS).filter((action) => action.offers(tick, chat));
    const actions = actionsFor(hoveredTick);
    /* The message a bookmark goes on: the one it is on already, or the person's own. A wake is the machine's and holds none. */
    const markableOf = (tick: ScrubberTick | null): string | null =>
        tick === null || chat === null ? null : (tick.bookmark?.itemId ?? (tick.kind === 'person' ? tick.id : null));
    const menuTick = menuIndex === null ? null : (ticks[menuIndex] ?? null);
    const menuMarkable = markableOf(menuTick);

    const onContextMenu: NonNullable<ContextMenu.Trigger.Props['onContextMenu']> = (e) => {
        // The hover card is a child here as well, and a click in it is about no tick.
        const index = strip === null || cameThroughPortal(e) ? null : messageAt(layout, e.clientY - strip.getBoundingClientRect().top);
        const tick = index === null ? null : (ticks[index] ?? null);
        if (tick === null || (actionsFor(tick).length === 0 && markableOf(tick) === null)) {
            e.preventBaseUIHandler();
            return;
        }
        setMenuIndex(index);
    };

    return (
        <ContextMenu.Root onOpenChange={setMenuOpen}>
            <ContextMenu.Trigger className="h-full w-full" onContextMenu={onContextMenu}>
                <PreviewCard.Root open={cardOpen && !menuOpen} onOpenChange={setCardOpen}>
                    <PreviewCard.Trigger
                        delay={150}
                        closeDelay={150}
                        render={
                            <div
                                ref={setStrip}
                                role="navigation"
                                aria-label={t('scrubber.strip')}
                                className="relative h-full w-full cursor-pointer select-none"
                                onPointerMove={(e) => {
                                    setPointing(true);
                                    const index = pointAt(e);
                                    if (index !== hovered) {
                                        setHovered(index);
                                    }
                                }}
                                onPointerLeave={() => setPointing(false)}
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
                            const distance = pointing && hoveredSlot !== null ? Math.abs(index - hoveredSlot) : null;
                            // A bookmark is a place to find again from anywhere, so it never dims with the rest.
                            const bright = slot.marked || slotInView(slot, inView) || distance === 0;
                            return (
                                <Fragment key={slot.first}>
                                    <span
                                        aria-hidden
                                        className={clsx(
                                            'absolute left-1 rounded-full transition-[width,opacity] duration-100 ease-out motion-reduce:transition-none',
                                            slot.marked ? 'bg-accent' : slot.kind === 'wake' ? 'bg-text-muted' : 'bg-text',
                                            bright ? 'opacity-100' : 'opacity-30'
                                        )}
                                        style={{ top: slot.y, height: TICK_HEIGHT_PX, width: tickWidth(slot.kind, distance) }}
                                    />
                                    {slot.found && (
                                        <span
                                            aria-hidden
                                            className={clsx(
                                                'absolute right-0 rounded-full bg-find-current',
                                                index === currentSlot ? 'opacity-100' : 'opacity-50'
                                            )}
                                            style={{ top: slot.y, height: TICK_HEIGHT_PX, width: FOUND_WIDTH_PX }}
                                        />
                                    )}
                                </Fragment>
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
                                                {hoveredTick.bookmark === null ? (
                                                    <span>{hoveredTick.kind === 'person' ? t('rows.user.heading') : t('scrubber.tasks')}</span>
                                                ) : (
                                                    <span className="flex min-w-0 items-center gap-1 self-center text-text-muted">
                                                        <Icon icon={Bookmark} size={12} className="shrink-0 fill-current text-accent" />
                                                        <span className="truncate">{hoveredTick.bookmark.name ?? t('bookmarks.unnamed')}</span>
                                                    </span>
                                                )}
                                                <time className="tabular-nums">{timeOf(hoveredTick.createdAt)}</time>
                                            </div>
                                            <p className="mt-1 line-clamp-4 text-sm break-words whitespace-pre-line text-text">
                                                {hoveredTick.text.slice(0, PREVIEW_CHARS) || t('pickers.stash.noText')}
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
                                                        onClick={() => action.run(hoveredTick, chat)}
                                                    >
                                                        <Icon icon={action.icon} size={14} /> {t(action.label)}
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
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
                <ContextMenu.Positioner className="z-(--z-popup)">
                    <ContextMenu.Popup className="menu-popup">
                        {menuTick !== null &&
                            actionsFor(menuTick).map((action) => (
                                <ContextMenu.Item key={action.label} className="menu-item" onClick={() => action.run(menuTick, chat)}>
                                    <Icon icon={action.icon} size={14} /> {t(action.label)}
                                </ContextMenu.Item>
                            ))}
                        {menuTick !== null && actionsFor(menuTick).length > 0 && menuMarkable !== null && <ContextMenu.Separator className={MENU_SEPARATOR} />}
                        {chat !== null && menuIndex !== null && menuMarkable !== null && (
                            <BookmarkMenuItems chatId={chat.chatId} itemId={menuMarkable} onName={() => onPick(menuIndex)} />
                        )}
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
});
