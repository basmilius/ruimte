import { AgentKindSchema } from '@adecore/agent-contracts/agent';
import {
    lossyItems,
    openValues,
    readTolerant,
    type OpenUnions,
    type OpenWords,
    type TolerantWith,
    type ToleratedRead
} from '@adecore/agent-contracts/tolerance';
import type { z } from 'zod';
import { AgentIntegrationSchema, type AgentIntegration } from './agent-integrations.ts';
import { ARTIFACT_KINDS, ArtifactKindSchema } from './artifact.ts';
import { EndpointNameSourceSchema, ReachabilitySchema, type Reachability } from './auth.ts';
import { KeepAwakeModeSchema, type KeepAwakeMode } from './keep-awake.ts';
import { TerminalShellSchema, type TerminalShell } from './machine-settings.ts';
import { MachineUpdateStatusSchema } from './machine-update.ts';
import { ProjectSidebarResultSchema, ProjectSidebarViewSchema, type ProjectSidebarView } from './project-sidebar.ts';
import { NodeTitleSourceSchema, PROJECT_ICON_NAMES, ProjectIconNameSchema, ProjectListResultSchema, ProjectNameSourceSchema } from './project.ts';
import { PushNotifyKindSchema, type PushNotifyKind } from './push.ts';
import { TaskListResultSchema } from './task.ts';
import { TunnelProposalActionSchema, type TunnelProposalAction } from './tunnel.ts';
import { VoiceActivityKindSchema, VoiceActivityStatusSchema, VoicePhaseSchema, type VoiceActivityKind, type VoicePhase } from './voice.ts';

/*
 * Where a newer machine may add something without an older client refusing the whole reply, beside the stamps the chat
 * contracts carry themselves. A machine keeps parsing strictly; only a client reading what a machine sent applies them
 * (`readFromMachine`), and the iPhone app's generator reads the same stamps.
 */

// The CLIs the iPhone app shipped knowing by name; a newer one reads as a plain word there. Frozen until the app reads the machine's providers.
export const KNOWN_AGENT_KINDS = ['claude', 'codex', 'gemini', 'copilot', 'apple'] as const;

openValues(AgentKindSchema, 'AgentKind', { known: KNOWN_AGENT_KINDS });
openValues(ArtifactKindSchema, 'ArtifactKind', { known: ARTIFACT_KINDS });
openValues(ProjectIconNameSchema, 'ProjectIconName', { known: PROJECT_ICON_NAMES });

openValues(MachineUpdateStatusSchema, 'MachineUpdateStatus', { words: 'strings' });
openValues(PushNotifyKindSchema, 'PushNotifyKind', { words: 'strings' });
openValues(VoicePhaseSchema, 'VoicePhase', { words: 'strings' });
openValues(VoiceActivityKindSchema, 'VoiceActivityKind', { words: 'strings' });
openValues(VoiceActivityStatusSchema, 'VoiceActivityStatus', { words: 'strings' });
openValues(TunnelProposalActionSchema, 'TunnelProposalAction', { words: 'strings' });

openValues(ReachabilitySchema, 'Reachability');
openValues(EndpointNameSourceSchema, 'EndpointNameSource');
openValues(KeepAwakeModeSchema, 'KeepAwakeMode');
openValues(TerminalShellSchema, 'TerminalShell');
openValues(AgentIntegrationSchema.shape.state, 'AgentIntegrationState');
openValues(NodeTitleSourceSchema, 'NodeTitleSource');
openValues(ProjectNameSourceSchema, 'ProjectNameSource');
openValues(ProjectSidebarViewSchema.shape.kind, 'ProjectSidebarViewKind');
openValues(ProjectSidebarViewSchema.shape.nodes.element.shape.kind, 'ProjectSidebarNodeKind');

// One newer project or task left out keeps the page; these lists are only read, never written back.
lossyItems(ProjectListResultSchema.shape.projects);
lossyItems(ProjectSidebarResultSchema.shape.projects);
lossyItems(TaskListResultSchema.shape.tasks);

/*
 * The open vocabularies stamped here that are enums, by stamp name, as a strict parse types them. The name sources and
 * the node title source are left out on purpose: a client only compares them with one word of its own and sends them
 * back as they came, so a newer word reads as "not that one" and a stored document keeps its strict type.
 */
export type MachineOpenWords = {
    AgentIntegrationState: AgentIntegration['state'];
    KeepAwakeMode: KeepAwakeMode;
    MachineUpdateStatus: z.infer<typeof MachineUpdateStatusSchema>;
    ProjectSidebarNodeKind: ProjectSidebarView['nodes'][number]['kind'];
    ProjectSidebarViewKind: ProjectSidebarView['kind'];
    PushNotifyKind: PushNotifyKind;
    Reachability: Reachability;
    TerminalShell: TerminalShell;
    TunnelProposalAction: TunnelProposalAction;
    VoiceActivityKind: VoiceActivityKind;
    VoiceActivityStatus: z.infer<typeof VoiceActivityStatusSchema>;
    VoicePhase: VoicePhase;
};

type Words = OpenWords & MachineOpenWords;

/* `T` as a client reads it from a machine: an open union also holds its unknown member, an open vocabulary an `UnknownWord`. */
export type FromMachine<T> = TolerantWith<T, OpenUnions, Words>;

/* Reads what a machine sent as a client should; what a client sends and what a machine receives stay strict. */
export function readFromMachine<S extends z.core.$ZodType>(schema: S, input: unknown): ToleratedRead<FromMachine<z.output<S>>> {
    return readTolerant<S, OpenUnions, Words>(schema, input);
}
