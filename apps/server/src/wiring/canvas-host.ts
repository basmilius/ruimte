import type { CanvasHost } from '../canvas/host.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import type { PushService } from '../push/service.ts';
import type { AgentWorkBundle } from './agent-work.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import type { ArtifactsBundle } from './artifacts.ts';
import type { DatabasesBundle } from './databases.ts';
import type { DevicesBundle } from './devices.ts';
import type { GitBundle } from './git.ts';
import type { LanguageBundle } from './language.ts';
import type { LaunchesBundle } from './launches.ts';
import type { ProjectsBundle } from './projects.ts';
import type { ProvidersBundle } from './providers.ts';
import type { RemoteBundle } from './remote.ts';
import type { RoutinesBundle } from './routines.ts';
import type { TemplatesBundle } from './templates.ts';
import type { UsageBundle } from './usage.ts';

interface CanvasHostInput {
    identity: EndpointIdentity;
    stores: AgentStores;
    providers: ProvidersBundle;
    agents: AgentsBundle;
    projects: ProjectsBundle;
    work: AgentWorkBundle;
    launches: LaunchesBundle;
    git: GitBundle;
    devices: DevicesBundle;
    databases: DatabasesBundle;
    extensions: NonNullable<CanvasHost['extensions']>;
    remote: RemoteBundle;
    usage: UsageBundle;
    artifacts: ArtifactsBundle;
    routines: RoutinesBundle;
    templates: TemplatesBundle;
    later: {
        language(): LanguageBundle;
        push(): PushService;
    };
}

/* What the part builders of the agent features read: the bundles, and the two things most of them need from them. */
export interface CanvasHostDeps extends CanvasHostInput {
    store: ProjectStore;
    enqueue: AgentsBundle['outboxLink']['enqueue'];
}

/* The part of a feature this module reads: how it builds its fields of the host from `Deps`. */
export interface HostSource<Deps> {
    readonly name: string;
    readonly host?: (deps: Deps, whole: CanvasHost) => Partial<CanvasHost>;
}

/*
 * Puts the parts the sources build into one host. A field two sources both fill is a mistake, so it
 * throws. The daemon and the tests of the tools both build their host through it, from their own deps.
 */
export function composeHost<Deps>(sources: readonly HostSource<Deps>[], deps: Deps): CanvasHost {
    const whole = {} as CanvasHost;

    for (const source of sources) {
        const part = source.host?.(deps, whole) ?? {};
        const taken = Object.keys(part).filter((field) => field in whole);

        if (taken.length > 0) {
            throw new Error(`${source.name} fills ${taken.join(', ')} of the host, which another part already fills`);
        }

        Object.assign(whole, part);
    }

    return whole;
}

/* The services the agent tools reach the daemon through: the parts the agent features build. */
export function wireCanvasHost(features: readonly HostSource<CanvasHostDeps>[], input: CanvasHostInput): CanvasHost {
    return composeHost(features, { ...input, store: input.projects.store, enqueue: input.agents.outboxLink.enqueue.bind(input.agents.outboxLink) });
}
