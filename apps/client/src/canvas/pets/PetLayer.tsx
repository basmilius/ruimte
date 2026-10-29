import { useEffect, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@adecore/ui';
import { useChats } from '@adecore/agents-react/state';
import { nodeColorOf } from '@ruimte/contracts';
import { accentColor } from '@/canvas/accents';
import { useNodeInViewport } from '@/canvas/culling';
import { visibleRect } from '@/canvas/math';
import { PET_HIT_HEIGHT, PET_HIT_TOP, petBlocked, petCrowded, petNodeKey, petPlace, sameStanding } from '@/canvas/pets/placement';
import { usePageTrip } from '@/canvas/pets/use-page-trip';
import { createVisitor, VISIT_MS, visitSpot, type VisitSpot } from '@/canvas/pets/visitor';
import { petLabel, usePrefersStill } from '@/pets/figure-support';
import { KID_HEIGHT, KID_SPACING, kidMoodsOf, petKidsOf } from '@/pets/kids';
import { PetFigure } from '@/pets/PetFigure';
import { PET_HEIGHT, PET_PAINT_WIDTH, PET_WIDTH, petOf } from '@/pets/pet-state';
import { useDeparting, useLinger, useTeleport } from '@/pets/teleport';
import { usePetLook } from '@/pets/use-pet-look';
import { maximizedNodeOf, useCanvas, useCanvasStore } from '@/state/canvas';
import { useEndpointId } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { useSnoozes } from '@/state/snooze';
import { useTasks } from '@/state/tasks';

const visitor = createVisitor({
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    random: Math.random
});

/*
 * A pet on its node, when an agent is in it. Only its figure takes a press, and not even that where the
 * figure stands on another node (`blocked`) or while a line is being aimed, so a press on that node, or
 * on the canvas for the line, still lands there. The bubble is paint and never takes one; where a node
 * lies over the pet's head (`crowded`) it goes beside the pet, so it never covers that node. The kids of
 * its sub-agents stand in a row behind it, paint only.
 */
function Pet({ id, ownPets, gone }: { id: string; ownPets: ReadonlySet<string>; gone: boolean }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const endpointId = useEndpointId();
    const node = useCanvas((s) => s.nodes[id]);
    const blocked = useCanvas((s) => petBlocked(s, id));
    const crowded = useCanvas((s) => petCrowded(s, id));
    const aiming = useCanvas((s) => s.linkDraft?.aiming === true);
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.statusByKey);
    const snoozes = useSnoozes((s) => s.byKey);
    const withKids = useSettings((s) => s.petsSubagents);
    const tasks = useTasks((s) => s.byEndpoint);
    const kidKey = useChats((s) => (withKids && node !== undefined ? petKidsOf(node, s.byKey, tasks, endpointId, ownPets) : ''));
    const kids = kidMoodsOf(kidKey);
    const still = usePrefersStill();
    const live = gone || node === undefined ? null : petOf(node, sessions, chats, endpointId, snoozes);
    // The node goes with the pet, so one whose node was removed beams out where it stood.
    const { shown, beam } = useTeleport(live === null || node === undefined ? null : { node, pet: live }, sameStanding, still);
    const pet = shown?.pet ?? null;
    const look = usePetLook(pet?.agent, id);
    const { standsOn, carry, walking } = usePageTrip(id, pet?.mood === 'waiting' || pet?.mood === 'snoozed', still);
    const standsOnId = standsOn?.id ?? id;
    // On a page its agent works in, the pet steps aside for a node there as it does on its own.
    const blockedOnPage = useCanvas((s) => standsOnId !== id && s.nodes[standsOnId] !== undefined && petBlocked(s, standsOnId));
    // A pet off screen keeps no beat; it stands where it was once the node it stands on comes back in view.
    const inView = useNodeInViewport(standsOnId);
    const home = shown?.node;
    const accent = home === undefined ? undefined : accentColor(nodeColorOf(home));

    if (home === undefined || pet === null) {
        return null;
    }

    const { mood } = pet;
    const place = petPlace(standsOn ?? home);
    const label = petLabel(t, home, mood);
    const away = standsOnId !== id;
    const leaving = beam === 'out';
    const pressBlocked = away ? blockedOnPage : blocked;

    return (
        <div
            ref={carry}
            data-pet-box={id}
            data-pet-on={away ? standsOnId : undefined}
            data-pet-leaving={leaving || undefined}
            className="absolute"
            style={{ left: place.x, top: place.y, width: PET_PAINT_WIDTH, height: PET_HEIGHT }}
        >
            {inView &&
                kids.map((kid, index) => (
                    <div
                        key={index}
                        data-pet-kid={leaving ? undefined : id}
                        data-pet-mood={kid}
                        className="absolute"
                        style={{ left: -(index + 1) * KID_SPACING, top: PET_HEIGHT - KID_HEIGHT }}
                    >
                        <PetFigure look={look} mood={kid} crowded={false} accent={accent} small beam={beam} />
                    </div>
                ))}
            {inView && (
                // Positioned as its kids are, so it stands in front of them.
                <div className="relative">
                    <PetFigure look={look} mood={mood} crowded={!away && crowded} accent={accent} walking={walking} beam={beam} />
                </div>
            )}
            {/* A pet on its way out is only a picture: it leads nowhere any more. */}
            {!leaving && (
                <Tooltip label={label}>
                    <button
                        type="button"
                        data-pet={id}
                        data-pet-mood={mood}
                        data-pet-blocked={pressBlocked || undefined}
                        aria-label={label}
                        className={clsx(
                            'absolute left-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent',
                            pressBlocked || aiming ? 'pointer-events-none' : 'pointer-events-auto'
                        )}
                        style={{ top: PET_HIT_TOP, width: PET_WIDTH, height: PET_HIT_HEIGHT }}
                        // A press on a pet is not the start of a box or a pan on the canvas under it.
                        onPointerDown={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            canvasStore.getState().goToNode(id);
                        }}
                    />
                </Tooltip>
            )}
        </div>
    );
}

/*
 * A pet for every node that may have one, and for a beam's length one for every node that left (or for
 * all of them once pets are off), so it beams out where it stood.
 */
function NodePets({ on }: { on: boolean }) {
    const key = useCanvas(petNodeKey);
    const ids = on && key !== '' ? key.split('\n') : [];
    const { all, gone } = useDeparting(ids);
    const own = new Set(ids);

    return all.map((id) => <Pet key={id} id={id} ownPets={own} gone={gone.has(id)} />);
}

/* Now and then, while Pets is off, a pet stands beside a node for a moment and goes again. It takes no press and asks nothing. */
function PetVisitor() {
    const canvasStore = useCanvasStore();
    const [visit, setVisit] = useState<VisitSpot | null>(null);
    // From the set the node it visits would have, so a visitor is one of the figures a person picked.
    const look = usePetLook(undefined, visit?.nodeId ?? '');

    useEffect(() => {
        let leave: ReturnType<typeof setTimeout> | null = null;
        const stop = visitor.host(() => {
            const state = canvasStore.getState();
            if (document.visibilityState !== 'visible' || state.gesturing || maximizedNodeOf(state) !== null) {
                return false;
            }
            const spot = visitSpot(state.nodes, state.hidden, visibleRect(state.camera, state.viewport), Math.random);
            if (spot === null) {
                return false;
            }
            setVisit(spot);
            leave = setTimeout(() => setVisit(null), VISIT_MS);
            return true;
        });
        return () => {
            stop();
            if (leave !== null) {
                clearTimeout(leave);
            }
        };
    }, [canvasStore]);

    if (visit === null) {
        return null;
    }
    return (
        <div
            data-pet-visitor={visit.nodeId}
            className="pet-visitor"
            // The fade runs over the visit, so the figure is gone when the visit ends.
            style={{ left: visit.x, top: visit.y, '--pet-visit-duration': `${VISIT_MS}ms` } as CSSProperties}
            aria-hidden
        >
            <PetFigure look={look} mood="visiting" crowded={false} />
        </div>
    );
}

/* The pets of a canvas, in its world so they pan and zoom with their nodes, over every node. */
export function PetLayer({ z }: { z: number }) {
    const pets = useSettings((s) => s.pets);
    const visitorOn = useSettings((s) => s.petsVisitor);
    // Along the bottom of the screen they are `PetRoam`'s, over the canvas rather than in its world.
    const onNodes = useSettings((s) => s.petsPlace === 'nodes');
    // Turned off, or sent to the bottom of the screen, the pets on their nodes beam out first.
    const nodePets = useLinger(pets && onNodes);

    return (
        <div className="pointer-events-none absolute left-0 top-0" style={{ zIndex: z }}>
            {nodePets && <NodePets on={pets && onNodes} />}
            {!pets && visitorOn && <PetVisitor />}
        </div>
    );
}
