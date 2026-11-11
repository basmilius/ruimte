import {
    canvas,
    nodeColorValue,
    useAgent,
    useCanvasView,
    useInView,
    useLocale,
    useNode,
    useNodes,
    useSubagents,
    type CanvasArea
} from '@ruimte/extension/client';
import { Tooltip } from '@ruimte/extension/ui';
import clsx from 'clsx';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { petLabel, usePrefersStill } from '../figure-support';
import { KID_HEIGHT, KID_SPACING, petKidMoods } from '../kids';
import { usePetSettings } from '../pet-settings';
import { PET_HEIGHT, PET_PAINT_WIDTH, PET_WIDTH, petOf } from '../pet-state';
import { PetFigure } from '../PetFigure';
import { useDeparting, useLinger, useTeleport } from '../teleport';
import { usePetLook } from '../use-pet-look';
import { PET_HIT_HEIGHT, PET_HIT_TOP, petBlocked, petCrowded, petNodeKey, petNodeOf, petPlace, sameStanding, type PetNode } from './placement';
import { createVisitor, VISIT_MS, visitSpot, type VisitSpot } from './visitor';
import './pets.css';

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
function Pet({ id, ownPets, gone, blocked, crowded }: { id: string; ownPets: ReadonlySet<string>; gone: boolean; blocked: boolean; crowded: boolean }) {
    const { t } = useLocale();
    const info = useNode(id);
    const node = info.kind === 'unknown' ? undefined : info;
    const aiming = useCanvasView((view) => view.gesture === 'line');
    const agent = useAgent({ id });
    const subagents = useSubagents({ id });
    const withKids = usePetSettings((s) => s.petsSubagents);
    const kids = withKids ? petKidMoods(subagents, ownPets) : [];
    const still = usePrefersStill();
    const live = gone || node === undefined ? null : petOf(agent);
    // The node goes with the pet, so one whose node was removed beams out where it stood.
    const { shown, beam } = useTeleport(live === null || node === undefined ? null : { node, pet: live }, sameStanding, still);
    const pet = shown?.pet ?? null;
    const look = usePetLook(pet?.agent, id);
    // A pet off screen keeps no beat; it stands where it was once its node comes back in view.
    const inView = useInView({ id });
    const home = shown?.node;
    const accent = home?.color === null || home?.color === undefined ? undefined : nodeColorValue(home.color);

    if (home === undefined || pet === null) {
        return null;
    }

    const { mood } = pet;
    const place = petPlace(petNodeOf(home));
    const label = petLabel(t, home, mood);
    const leaving = beam === 'out';

    return (
        <div
            data-pet-box={id}
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
                    <PetFigure look={look} mood={mood} crowded={crowded} accent={accent} beam={beam} />
                </div>
            )}
            {/* A pet on its way out is only a picture: it leads nowhere any more. */}
            {!leaving && (
                <Tooltip label={label}>
                    <button
                        type="button"
                        data-pet={id}
                        data-pet-mood={mood}
                        data-pet-blocked={blocked || undefined}
                        aria-label={label}
                        className={clsx(
                            'absolute left-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent',
                            blocked || aiming ? 'pointer-events-none' : 'pointer-events-auto'
                        )}
                        style={{ top: PET_HIT_TOP, width: PET_WIDTH, height: PET_HIT_HEIGHT }}
                        // A press on a pet is not the start of a box or a pan on the canvas under it.
                        onPointerDown={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            canvas.reveal({ id });
                        }}
                    />
                </Tooltip>
            )}
        </div>
    );
}

/*
 * A pet for every node that may have one, and for a beam's length one for every node that left (or for
 * all of them once pets are off), so it beams out where it stood. Where a pet stands on another node, or
 * one lies over its head, is a word per pet, so a drag draws a pet again only when that word flips.
 */
function NodePets({ on }: { on: boolean }) {
    const nodes = useNodes();
    const boxes = nodes.map(petNodeOf);
    const key = petNodeKey(nodes);
    const ids = on && key !== '' ? key.split('\n') : [];
    const { all, gone } = useDeparting(ids);
    const own = new Set(ids);

    return all.map((id) => <Pet key={id} id={id} ownPets={own} gone={gone.has(id)} blocked={petBlocked(boxes, id)} crowded={petCrowded(boxes, id)} />);
}

/* Now and then, while Pets is off, a pet stands beside a node for a moment and goes again. It takes no press and asks nothing. */
function PetVisitor() {
    const [visit, setVisit] = useState<VisitSpot | null>(null);
    // From the set the node it visits would have, so a visitor is one of the figures a person picked.
    const look = usePetLook(undefined, visit?.nodeId ?? '');
    const boxes = useNodes().map(petNodeOf);
    const view = useCanvasView((each) => each);
    // What the canvas holds when the clock calls, which comes long after this drew.
    const now = useRef<{ boxes: readonly PetNode[]; visible: CanvasArea; busy: boolean }>({ boxes, visible: view.visible, busy: false });

    useEffect(() => {
        now.current = { boxes, visible: view.visible, busy: view.gesture !== 'none' };
    });

    useEffect(() => {
        let leave: ReturnType<typeof setTimeout> | null = null;
        const stop = visitor.host(() => {
            const { boxes: nodes, visible, busy } = now.current;
            if (document.visibilityState !== 'visible' || busy) {
                return false;
            }
            const spot = visitSpot(nodes, { x: visible.x, y: visible.y, w: visible.width, h: visible.height }, Math.random);
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
    }, []);

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
export function PetLayer() {
    const pets = usePetSettings((s) => s.pets);
    const visitorOn = usePetSettings((s) => s.petsVisitor);
    // Along the bottom of the screen they are `PetRoam`'s, over the canvas rather than in its world.
    const onNodes = usePetSettings((s) => s.petsPlace === 'nodes');
    // Turned off, or sent to the bottom of the screen, the pets on their nodes beam out first.
    const nodePets = useLinger(pets && onNodes);

    return (
        <>
            {nodePets && <NodePets on={pets && onNodes} />}
            {!pets && visitorOn && <PetVisitor />}
        </>
    );
}
