import type { ComponentType } from 'react';
import type { SlotAnswer, SlotName } from './client';

/** What `client/index.ts` defined so far, in order, with the object each `define*` was given. Available under `ruimte extension test`. */
export function definitions(): { kind: string; definition: object }[];

/** What a slot of an action, menu or widget answers for this context. */
export function slotAnswer(definition: { slots?: object }, slot: SlotName, context: object): SlotAnswer;

/** Draws a component to a string, with `server` standing in for `server/`: its methods answer as `useServer` would, a throw as `failed`. */
export function renderSurface<Props extends object>(
    component: ComponentType<Props>,
    options?: { server?: Record<string, (...args: never[]) => unknown>; data?: object; props?: Props }
): string;
