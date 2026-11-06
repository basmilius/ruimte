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
    enqueue: AgentWorkBundle['worker']['enqueue'];
}

/* The part of a feature this module reads: how it builds its fields of the host. */
export interface HostSource {
    readonly name: string;
    readonly host?: (deps: CanvasHostDeps, whole: CanvasHost) => Partial<CanvasHost>;
}

/*
 * The services the agent tools reach the daemon through: the parts the features build, put together.
 * A field two features both fill is a mistake, so it throws.
 */
export function wireCanvasHost(features: readonly HostSource[], input: CanvasHostInput): CanvasHost {
    const deps: CanvasHostDeps = { ...input, store: input.projects.store, enqueue: input.work.worker.enqueue.bind(input.work.worker) };
    const whole = {} as CanvasHost;

    for (const feature of features) {
        const part = feature.host?.(deps, whole) ?? {};
        const taken = Object.keys(part).filter((field) => field in whole);

        if (taken.length > 0) {
            throw new Error(`The agent feature ${feature.name} fills ${taken.join(', ')} of the host, which another feature already fills`);
        }

        Object.assign(whole, part);
    }

    return whole;
}
