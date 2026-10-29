import { useEffect, useRef, useState } from 'react';
import { deviceMatches } from '@ruimte/contracts';
import { useNodeInViewport } from '@/canvas/culling';
import { operatedOf, useDeviceOperated } from '@/devices/operated';
import { useDevices } from '@/devices/state';
import { readNodeHost } from '@/nodes/node-host';
import { lineRoutes } from '@/canvas/line-routes';
import { nextVisit, tripPagesOf, type PageVisit } from '@/canvas/pets/page-trip';
import { petPlace } from '@/canvas/pets/placement';
import { lastPageAsk, subscribePageAsks } from '@/pets/page-asks';
import { PET_HEIGHT, PET_WIDTH, WORLD_CELL } from '@/pets/pet-state';
import { useCanvas, useCanvasStore, type CanvasNode, type CanvasState } from '@/state/canvas';
import { endpointKey, endpointOfNode, useEndpointId } from '@/state/keys';

/* How often a pet with pages looks again whether to go, stay or walk home: the quiet spell ends on its own. */
const CHECK_MS = 500;

/* A walk takes about this long per pixel of the way, and never less or more than the bounds, so a long line is crossed in a hop. */
const WALK_MS_PER_PX = 2.2;
const WALK_MIN_MS = 450;
const WALK_MAX_MS = 1_400;

/* How finely a line's route is followed, in world pixels. */
const ROUTE_STEP = 12;

type Point = { x: number; y: number };

// The point under a pet's feet when it stands at a place, in the middle of its figure.
function feetAt(place: Point): Point {
    return { x: place.x + PET_WIDTH / 2, y: place.y + PET_HEIGHT - WORLD_CELL };
}

/*
 * A device node counts as asked something just now while the agent of this pet operates its device
 * (`device.operated` names the agent's node), so its pet stays there for as long as it works in it.
 */
function deviceWorkedAt(deviceNodeId: string, agentId: string, endpointId: string): number | undefined {
    const reference = readNodeHost(deviceNodeId)?.device;
    const device = reference === undefined ? undefined : useDevices.getState().byEndpoint[endpointId]?.devices.find((each) => deviceMatches(each, reference));
    const operated = device === undefined ? null : operatedOf(useDeviceOperated.getState(), endpointId, device);

    return operated?.nodeId === agentId ? Date.now() : undefined;
}

/* The points a route's path runs through, or none where the page cannot measure a path. */
function routePoints(d: string): Point[] {
    if (typeof document === 'undefined') {
        return [];
    }

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);

    if (typeof path.getTotalLength !== 'function') {
        return [];
    }

    const length = path.getTotalLength();
    const points: Point[] = [];

    for (let at = 0; at <= length; at += ROUTE_STEP) {
        const point = path.getPointAtLength(at);
        points.push({ x: point.x, y: point.y });
    }

    return points;
}

/* The way from one node's top edge to the other's: down onto the line, along its route, and up onto the other node. */
function wayBetween(s: CanvasState, agentId: string, fromId: string, toId: string): Point[] {
    const from = s.nodes[fromId];
    const to = s.nodes[toId];

    if (from === undefined || to === undefined) {
        return [];
    }

    const pageId = fromId === agentId ? toId : fromId;
    const { lines, routes } = lineRoutes(s.edges, s.nodes, s.texts, s.hidden);
    const line = lines.find((each) => (each.edge.from === agentId && each.edge.to === pageId) || (each.edge.to === agentId && each.edge.from === pageId));
    const route = line === undefined ? undefined : routes.get(line.edge.id);
    let along = route === undefined ? [] : routePoints(route.d);

    if (line !== undefined && line.edge.from !== fromId) {
        along = along.toReversed();
    }

    return [feetAt(petPlace(from)), ...along, feetAt(petPlace(to))];
}

function lengthOf(way: readonly Point[]): number {
    let length = 0;

    for (let i = 1; i < way.length; i++) {
        length += Math.hypot(way[i].x - way[i - 1].x, way[i].y - way[i - 1].y);
    }

    return length;
}

function pointAt(way: readonly Point[], distance: number): Point {
    let rest = distance;

    for (let i = 1; i < way.length; i++) {
        const step = Math.hypot(way[i].x - way[i - 1].x, way[i].y - way[i - 1].y);

        if (rest <= step && step > 0) {
            const share = rest / step;

            return { x: way[i - 1].x + (way[i].x - way[i - 1].x) * share, y: way[i - 1].y + (way[i].y - way[i - 1].y) * share };
        }

        rest -= step;
    }

    return way[way.length - 1];
}

export interface PageTrip {
    /* The node the pet stands on: a page its agent works in, or its own. */
    standsOn: CanvasNode | undefined;
    /* Takes the pet's box, which it moves along the way while it walks, from where the box is drawn. */
    carry: (element: HTMLDivElement | null) => void;
    /* Whether it is on its way, which `PetFigure` asks on every beat for the walking pose. */
    walking: () => boolean;
}

/*
 * A pet's trips over the line to a page its agent works in (`page-trip.ts`). It walks the line's own
 * route, and on a page it stands as on its node. A page out of view keeps it home, and with reduced
 * motion it only takes its place.
 */
export function usePageTrip(agentId: string, waiting: boolean, still: boolean): PageTrip {
    const canvasStore = useCanvasStore();
    const endpointId = useEndpointId();
    const pages = useCanvas((s) => tripPagesOf(agentId, lineRoutes(s.edges, s.nodes, s.texts, s.hidden).lines, s.nodes, s.hidden).join('\n'));
    const [stored, setVisit] = useState<PageVisit | null>(null);
    // A page whose line went is no place to stand, whatever was stored for it.
    const visit = stored !== null && pages.split('\n').includes(stored.pageId) ? stored : null;
    const pageInView = useNodeInViewport(visit?.pageId ?? agentId);
    const standsOnId = visit !== null && pageInView ? visit.pageId : agentId;
    const standsOn = useCanvas((s) => s.nodes[standsOnId]);
    const [box, setBox] = useState<HTMLDivElement | null>(null);
    const moving = useRef(false);
    const [walking] = useState(() => () => moving.current);
    const shownOn = useRef(standsOnId);

    useEffect(() => {
        if (pages === '') {
            return;
        }

        const ids = pages.split('\n');

        const check = (): void => {
            const s = canvasStore.getState();
            const asks = new Map<string, number>();

            for (const pageId of ids) {
                const page = s.nodes[pageId];
                const at =
                    page === undefined
                        ? undefined
                        : page.kind === 'device'
                          ? deviceWorkedAt(pageId, agentId, endpointOfNode(page, endpointId))
                          : lastPageAsk(endpointKey(endpointOfNode(page, endpointId), pageId));

                if (at !== undefined) {
                    asks.set(pageId, at);
                }
            }

            setVisit((current) => nextVisit(current, asks, Date.now(), waiting));
        };

        check();
        const off = subscribePageAsks(check);
        const offDevices = useDeviceOperated.subscribe(check);
        const timer = setInterval(check, CHECK_MS);

        return () => {
            off();
            offDevices();
            clearInterval(timer);
        };
    }, [pages, waiting, canvasStore, endpointId, agentId]);

    useEffect(() => {
        const from = shownOn.current;
        shownOn.current = standsOnId;

        if (from === standsOnId || box === null || still) {
            return;
        }

        const way = wayBetween(canvasStore.getState(), agentId, from, standsOnId);

        if (way.length < 2) {
            return;
        }

        const length = lengthOf(way);
        const duration = Math.min(WALK_MAX_MS, Math.max(WALK_MIN_MS, length * WALK_MS_PER_PX));
        const end = way[way.length - 1];
        let frame = 0;
        let started: number | null = null;

        // The box is drawn where the pet arrives; on the way it is moved back along the route by a transform.
        const step = (time: number): void => {
            started ??= time;
            const share = Math.min(1, (time - started) / duration);
            const point = pointAt(way, length * share);
            box.style.transform = share >= 1 ? '' : `translate(${point.x - end.x}px, ${point.y - end.y}px)`;
            moving.current = share < 1;

            if (share < 1) {
                frame = requestAnimationFrame(step);
            }
        };

        moving.current = true;
        frame = requestAnimationFrame(step);

        return () => {
            cancelAnimationFrame(frame);
            moving.current = false;
            box.style.transform = '';
        };
    }, [standsOnId, agentId, canvasStore, still, box]);

    return { standsOn, carry: setBox, walking };
}
