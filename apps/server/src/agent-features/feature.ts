import type { ActionHandlers, ActionName } from '@ruimte/actions';
import type { ServerActionContext } from '../actions/context.ts';
import type { CanvasHost } from '../canvas/host.ts';
import type { Toolkit } from '../tools/tool.ts';
import type { CanvasHostDeps } from '../wiring/canvas-host.ts';

/*
 * One thing an agent can do, as one unit: the tools it calls, the actions those tools run, which of
 * those actions preview, and the part of the `CanvasHost` it reaches the daemon through. Each part is
 * optional, since some features have no tool of their own and some need no service. `Fields` is the
 * fields of the host the feature fills, taken from what `host` returns.
 */
export interface AgentFeature<Fields extends keyof CanvasHost = keyof CanvasHost> {
    readonly name: string;
    readonly toolkit?: Toolkit;
    readonly actions?: ActionHandlers<ServerActionContext>;
    /* The actions whose handler honors a dry run. */
    readonly previews?: readonly ActionName[];
    /*
     * Builds the part of the host this feature offers. `whole` is the host being composed: a part that
     * needs the finished host keeps it and reads it when called, never while it builds.
     */
    readonly host?: (deps: CanvasHostDeps, whole: CanvasHost) => Pick<CanvasHost, Fields>;
}

export function defineAgentFeature<Fields extends keyof CanvasHost = never>(feature: AgentFeature<Fields>): AgentFeature<Fields> {
    return feature;
}

/* The toolkits of the features, in the order the catalog serves them. */
export function toolkitsOf(features: readonly AgentFeature<never>[]): Toolkit[] {
    return features.flatMap((feature) => (feature.toolkit === undefined ? [] : [feature.toolkit]));
}

type Union<Part> = (Part extends unknown ? (part: Part) => void : never) extends (part: infer Joined) => void ? Joined : never;

/* The host the features fill together, which `CanvasHost` must be no wider than. */
export type ComposedHost<Features extends readonly AgentFeature<never>[]> = Union<
    Features[number] extends infer Feature ? (Feature extends AgentFeature<infer Fields> ? Pick<CanvasHost, Fields> : never) : never
>;
