import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@adecore/ui';
import { useChats } from '@adecore/agents-react/state';
import { petLabel, usePrefersStill } from '@/pets/figure-support';
import { KID_HEIGHT, KID_PAINT_WIDTH, KID_SPACING, kidMoodsOf, petKidsOf } from '@/pets/kids';
import { PetFigure } from '@/pets/PetFigure';
import { PET_HEIGHT, PET_PAINT_WIDTH, PET_WIDTH, petOf, samePet, WORLD_CELL, type AgentPet } from '@/pets/pet-state';
import { useTeleport, type Teleport } from '@/pets/teleport';
import { usePetLook } from '@/pets/use-pet-look';
import { useEndpointId } from '@/state/keys';
import { useSessions, type StatusOf } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { useSnoozes } from '@/state/snooze';
import { useTasks } from '@/state/tasks';

/* Below this width a composer has no room for a pet beside what it holds, so a narrow cell shows none. */
export const VIEW_PET_MIN_WIDTH = 320;

/* How far in from the right edge of the composer the pet stands, clear of its send button's corner. */
const COMPOSER_INSET = 20;

/* The composer card of ADE CORE's composer, whose top edge the pet stands on. */
const COMPOSER_CARD = '[class~="@container/composer"]';

// Nothing on a view's own pet asks whether another pet stands here, as on a canvas; a task with a pet of its own is not on screen.
const NO_OWN_PETS: ReadonlySet<string> = new Set();

/* The pet of a chat or a terminal open as a view: the same one its node would have, from the same status, beamed in and out. */
function useViewPet(node: StatusOf, leaving: boolean): { pet: AgentPet | null; beam: Teleport<AgentPet>['beam'] } {
    const endpointId = useEndpointId();
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.statusByKey);
    const snoozes = useSnoozes((s) => s.byKey);
    const still = usePrefersStill();
    const { shown, beam } = useTeleport(leaving ? null : petOf(node, sessions, chats, endpointId, snoozes), samePet, still);

    return { pet: shown, beam };
}

function useKids(node: StatusOf): ReturnType<typeof kidMoodsOf> {
    const endpointId = useEndpointId();
    const withKids = useSettings((s) => s.petsSubagents);
    const tasks = useTasks((s) => s.byEndpoint);
    const kidKey = useChats((s) => (withKids ? petKidsOf(node, s.byKey, tasks, endpointId, NO_OWN_PETS) : ''));

    return kidMoodsOf(kidKey);
}

/* Where the composer card's top edge and right edge lie in the box around the composer, and whether the card is wide enough for a pet. */
interface Ledge {
    top: number;
    right: number;
    roomy: boolean;
}

function useComposerLedge(anchor: React.RefObject<HTMLElement | null>): Ledge | null {
    const [ledge, setLedge] = useState<Ledge | null>(null);

    useEffect(() => {
        const box = anchor.current?.parentElement ?? null;

        if (box === null || typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(() => measure());
        let watched: Element | null = null;

        // The card is ADE CORE's, so it is found again on every change: the activity line over it comes and goes.
        const measure = (): void => {
            const card = box.querySelector(COMPOSER_CARD);

            if (card !== watched) {
                if (watched !== null) {
                    observer.unobserve(watched);
                }

                if (card !== null) {
                    observer.observe(card);
                }

                watched = card;
            }

            if (card === null) {
                setLedge(null);

                return;
            }

            // The box around the composer runs wider than its card, which keeps a reading width, so the pet is placed by the card.
            const outer = box.getBoundingClientRect();
            const edge = card.getBoundingClientRect();
            const top = Math.round(edge.top - outer.top);
            const right = Math.round(outer.right - edge.right);
            const roomy = edge.width >= VIEW_PET_MIN_WIDTH;
            setLedge((current) => (current?.top === top && current.right === right && current.roomy === roomy ? current : { top, right, roomy }));
        };

        observer.observe(box);
        measure();

        return () => observer.disconnect();
    }, [anchor]);

    return ledge;
}

/* What a press on a chat's pet gives the keyboard to: the question it waits on, or else the field to type in. */
function focusComposer(box: HTMLElement | null, waiting: boolean): void {
    const card = box?.querySelector<HTMLElement>(COMPOSER_CARD) ?? null;

    if (card === null) {
        return;
    }

    // The field is an editor in ADE CORE's composer; its editable content is what takes the keys.
    const input = card.querySelector<HTMLElement>('.composer-input [contenteditable="true"]');
    const answer = card.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
    (waiting ? (answer ?? input) : (input ?? answer))?.focus();
}

/*
 * A chat's pet in a view of its own, on the top edge of its composer near the right corner, with the
 * kids of its sub-agents in a row behind it. The composer holds a question while one is open, so the
 * pet stands beside what waits on you. Only the figure takes a press, which hands the keyboard over.
 */
export function ChatViewPet({ id, title, leaving }: { id: string; title: string | undefined; leaving: boolean }) {
    const { t } = useTranslation('canvas');
    const anchor = useRef<HTMLDivElement>(null);
    const node: StatusOf = { id, kind: 'chat' };
    const { pet, beam } = useViewPet(node, leaving);
    const kids = useKids(node);
    const look = usePetLook(pet?.agent, id);
    const ledge = useComposerLedge(anchor);
    const shown = pet !== null && ledge !== null && ledge.roomy;
    const mood = pet?.mood ?? 'idle';
    const waiting = mood === 'waiting' || mood === 'snoozed';
    const label = petLabel(t, { kind: 'chat', title }, mood, 'focus');

    return (
        <>
            {/* Always there, so the box around the composer is measured before a pet can stand on it. */}
            <div ref={anchor} hidden />
            {shown && (
                <div
                    data-view-pet={id}
                    data-pet-mood={mood}
                    data-pet-leaving={beam === 'out' || undefined}
                    className="pointer-events-none absolute z-20"
                    // The bottom row of the paint is the outline under its feet, which lies on the card's top edge.
                    style={{
                        top: (ledge?.top ?? 0) - PET_HEIGHT + WORLD_CELL,
                        right: (ledge?.right ?? 0) + COMPOSER_INSET,
                        width: PET_PAINT_WIDTH,
                        height: PET_HEIGHT
                    }}
                >
                    {kids.map((kid, index) => (
                        <div
                            key={index}
                            data-pet-kid={beam === 'out' ? undefined : id}
                            data-pet-mood={kid}
                            className="absolute"
                            style={{ left: -(index + 1) * KID_SPACING, top: PET_HEIGHT - KID_HEIGHT }}
                        >
                            <PetFigure look={look} mood={kid} crowded={false} small beam={beam} />
                        </div>
                    ))}
                    <div className="relative">
                        <PetFigure look={look} mood={mood} crowded={false} beam={beam} />
                    </div>
                    {/* On its way out it is only a picture, which leads nowhere any more. */}
                    {beam !== 'out' && (
                        <Tooltip label={label}>
                            <button
                                type="button"
                                data-pet={id}
                                aria-label={label}
                                className="pointer-events-auto absolute left-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                style={{ bottom: WORLD_CELL, width: PET_WIDTH, height: PET_HEIGHT / 2 }}
                                onClick={() => focusComposer(anchor.current?.parentElement ?? null, waiting)}
                            />
                        </Tooltip>
                    )}
                </div>
            )}
        </>
    );
}

/*
 * A terminal's pet in a view of its own. The terminal's text takes every pixel of its body, so the pet
 * stands in the band of the cell's toolbar at half its size, its feet on the line under the bar, and the
 * bubble goes beside its head where there is no room over it. A press hands the keyboard to the terminal.
 */
export function TerminalViewPet({ id, title, onPress, leaving }: { id: string; title: string | undefined; onPress: () => void; leaving: boolean }) {
    const { t } = useTranslation('canvas');
    const { pet, beam } = useViewPet({ id, kind: 'terminal' }, leaving);
    const look = usePetLook(pet?.agent, id);

    if (pet === null) {
        return null;
    }

    const figure = <PetFigure look={look} mood={pet.mood} crowded small beam={beam} />;

    // On its way out it is only a picture, which leads nowhere any more.
    if (beam === 'out') {
        return (
            <span data-pet-leaving="" className="relative shrink-0 self-end" style={{ width: KID_PAINT_WIDTH, height: KID_HEIGHT }} aria-hidden>
                {figure}
            </span>
        );
    }

    const label = petLabel(t, { kind: 'terminal', title }, pet.mood, 'focus');

    return (
        <Tooltip label={label}>
            <button
                type="button"
                data-view-pet={id}
                data-pet-mood={pet.mood}
                aria-label={label}
                className="relative shrink-0 cursor-pointer self-end rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
                style={{ width: KID_PAINT_WIDTH, height: KID_HEIGHT }}
                onClick={onPress}
            >
                {figure}
            </button>
        </Tooltip>
    );
}
