import type { Rect } from '@/canvas/math';
import { coversOtherNode, hitBoxAt, visitorPlace } from '@/canvas/pets/placement';
import { PET_HEIGHT, PET_WIDTH } from '@/pets/pet-state';
import type { CanvasNode } from '@/state/canvas';

/* How long after the last visit, or after a canvas opened, a pet may drop by: somewhere in this window. */
export const VISIT_GAP_MS = { min: 20 * 60_000, max: 60 * 60_000 } as const;

/* How long a visitor stays before it goes again. */
export const VISIT_MS = 4_000;

export interface VisitClock {
    setTimeout(run: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    random(): number;
}

/* A canvas that can take a visitor. It answers whether it showed one, so a canvas that is busy or out of sight passes. */
export type VisitHost = () => boolean;

export function visitDelay(random: () => number): number {
    return Math.round(VISIT_GAP_MS.min + random() * (VISIT_GAP_MS.max - VISIT_GAP_MS.min));
}

/*
 * One clock for the whole page, so two canvases side by side do not each bring a visitor. It runs only
 * while a canvas is registered, which a canvas does only while Pets is off and the visitor is not.
 * A visit goes to the canvas that registered last, or the one before it if that one passes.
 */
export function createVisitor(clock: VisitClock) {
    const hosts: VisitHost[] = [];
    let timer: unknown = null;

    const schedule = (): void => {
        timer = clock.setTimeout(fire, visitDelay(clock.random));
    };

    function fire(): void {
        timer = null;
        for (let i = hosts.length - 1; i >= 0; i--) {
            if (hosts[i]()) {
                break;
            }
        }
        if (hosts.length > 0) {
            schedule();
        }
    }

    return {
        host(host: VisitHost): () => void {
            hosts.push(host);
            if (timer === null) {
                schedule();
            }
            return () => {
                const at = hosts.indexOf(host);
                if (at >= 0) {
                    hosts.splice(at, 1);
                }
                if (hosts.length === 0 && timer !== null) {
                    clock.clearTimeout(timer);
                    timer = null;
                }
            };
        },
        /* Whether a visit is on the clock, for a test. */
        scheduled(): boolean {
            return timer !== null;
        }
    };
}

export interface VisitSpot {
    nodeId: string;
    x: number;
    y: number;
}

/*
 * A node on screen whose top edge has room for a visitor in view, picked at random; none when no node
 * offers it. A spot where the figure would stand on another node is no room: a visitor never covers work.
 */
export function visitSpot(nodes: Readonly<Record<string, CanvasNode>>, hidden: ReadonlySet<string>, visible: Rect, random: () => number): VisitSpot | null {
    const spots = Object.values(nodes)
        .filter((node) => node.kind !== 'group' && !hidden.has(node.id))
        .map((node) => ({ nodeId: node.id, ...visitorPlace(node) }))
        .filter(
            (spot) => spot.x >= visible.x && spot.y >= visible.y && spot.x + PET_WIDTH <= visible.x + visible.w && spot.y + PET_HEIGHT <= visible.y + visible.h
        )
        .filter((spot) => !coversOtherNode(hitBoxAt(spot), spot.nodeId, nodes, hidden));
    if (spots.length === 0) {
        return null;
    }
    return spots[Math.min(spots.length - 1, Math.floor(random() * spots.length))];
}
