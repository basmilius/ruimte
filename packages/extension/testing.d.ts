import type { ComponentType } from 'react';

/** What `client/index.ts` defined so far, in order. Available under `ruimte extension test`. */
export function definitions(): { kind: string; definition: unknown }[];

/** What a slot of an action, menu or widget answers for this context. */
export function slotAnswer(definition: { slots?: object }, slot: string, context: object): unknown;

/** Draws a component to a string, with `server` standing in for `server/`. */
export function renderSurface<Props extends object>(
    component: ComponentType<Props>,
    options?: { server?: Record<string, (...args: never[]) => unknown>; data?: unknown; props?: Props }
): string;
