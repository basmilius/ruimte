import { AgentKindSchema, TaskResultSchema, TaskStatusSchema } from '@adecore/agent-contracts';
import { EmptySchema } from '@adecore/agent-contracts/protocol';
import { z } from 'zod';
import { ARTIFACT_LIMITS, ArtifactIdSchema, ArtifactVersionIdSchema, ArtifactListResultSchema, ArtifactGetResultSchema } from './artifact.ts';
import { GitBundlePutPayloadSchema, GitBundlePutResultSchema, GitBundleResultSchema } from './git.ts';
import { RuntimeModeSchema } from './model.ts';
import { ProjectEdgeSchema, ProjectNodeSchema } from './project.ts';

/*
 * A project on this machine that another machine of the same account works in. This machine keeps the
 * link, and nothing happens for a machine without one: a person on this machine makes it.
 */
export const PeerLinkSchema = z.object({
    machineId: z.string().min(1).max(256),
    // What the other machine called itself when the link was made, for the list in settings.
    label: z.string().min(1).max(120),
    projectId: z.string().min(1).max(256),
    projectName: z.string().max(256),
    // The widest mode an agent from the other machine may start in here.
    ceiling: RuntimeModeSchema,
    createdAt: z.number().int().nonnegative(),
    lastUsedAt: z.number().int().nonnegative().optional(),
    // Until when the address book vouches for that machine working here; past it the machine has to be linked from its side again. Absent when it never did.
    attestedUntil: z.number().int().nonnegative().optional()
});
export type PeerLink = z.infer<typeof PeerLinkSchema>;

export const PeerListResultSchema = z.object({ links: z.array(PeerLinkSchema).max(1000) });

// A project that is not on this machine answers `project-not-found`. Without a `ceiling` a new link is `supervised`.
export const PeerBindPayloadSchema = PeerLinkSchema.pick({ machineId: true, label: true, projectId: true }).extend({
    ceiling: RuntimeModeSchema.optional()
});

export const PeerSetCeilingPayloadSchema = PeerLinkSchema.pick({ machineId: true, projectId: true, ceiling: true });

export const PeerUnbindPayloadSchema = PeerLinkSchema.pick({ machineId: true, projectId: true });

/*
 * A node of another machine as it is drawn here. Only what a node needs to start on this machine: the
 * session of the other machine (`resume`) and its accounts mean nothing here, and its position is
 * the other canvas's.
 */
export const PeerNodeSchema = z.object({
    id: ProjectNodeSchema.shape.id,
    kind: z.enum(['terminal', 'chat', 'device']),
    title: ProjectNodeSchema.shape.title.max(200),
    cwd: ProjectNodeSchema.shape.cwd,
    command: ProjectNodeSchema.shape.command,
    provider: ProjectNodeSchema.shape.provider,
    providerFixed: ProjectNodeSchema.shape.providerFixed,
    runtimeMode: ProjectNodeSchema.shape.runtimeMode,
    accent: ProjectNodeSchema.shape.accent,
    issue: ProjectNodeSchema.shape.issue,
    device: ProjectNodeSchema.shape.device
});
export type PeerNode = z.infer<typeof PeerNodeSchema>;

/*
 * Everything of one machine's nodes in one project, which replaces what this machine drew for it
 * before. Errors: `peer-not-linked`, `cwd-outside` for a folder beyond the project and its worktrees,
 * and `edge-off-machine` for a line with an end that is not among the nodes.
 */
export const PeerPlaceNodesPayloadSchema = PeerLinkSchema.pick({ machineId: true, projectId: true }).extend({
    nodes: z.array(PeerNodeSchema).max(200),
    edges: z.array(ProjectEdgeSchema).max(400)
});

// How many tasks one machine may have open here at a time; the next `peer.taskStart` answers `peer-busy`.
export const PEER_MAX_OPEN_TASKS = 4;

// What a task prompt may hold: the line a terminal agent is started with cannot carry more.
const PEER_PROMPT_MAX_LENGTH = 2000;

/*
 * A task another machine gives an agent here, in the project its link names. The work arrives as a
 * bundle `peer.bundlePut` took in (`bundle` and `branch` go together) and is started in a worktree on
 * `ruimte/<branch>`; without one the agent starts in the project's folder. `mode` and `ceiling` are
 * what that machine asks and allows; the link's ceiling here narrows both. `depth` is the depth the
 * agent has there. Errors: `peer-not-linked`, `peer-busy` (the other machine waits), `peer-worktrees-full`,
 * `depth-limit`, `project-not-found`, `peer-node-taken` and the bundle errors of `git.fetchBundle`.
 */
export const PeerTaskStartPayloadSchema = z.object({
    projectId: PeerLinkSchema.shape.projectId,
    nodeId: ProjectNodeSchema.shape.id,
    // The node on the other machine that gave the task.
    parentId: ProjectNodeSchema.shape.id,
    title: ProjectNodeSchema.shape.title.max(200),
    prompt: z.string().min(1).max(PEER_PROMPT_MAX_LENGTH),
    provider: AgentKindSchema,
    terminal: z.boolean().optional(),
    mode: RuntimeModeSchema.optional(),
    ceiling: RuntimeModeSchema,
    depth: z.number().int().min(0).max(8),
    bundle: z.object({ bundleId: z.string().min(1).max(64), sha256: z.string().length(64) }).optional(),
    branch: z.string().min(1).max(200).optional()
});
export type PeerTaskStartPayload = z.infer<typeof PeerTaskStartPayloadSchema>;

export const PeerTaskStartResultSchema = z.object({
    // Where the agent works here and on which branch, for the node that stands for it on the other machine.
    cwd: z.string().nullable(),
    branch: z.string().nullable()
});
export type PeerTaskStartResult = z.infer<typeof PeerTaskStartResultSchema>;

// Ends the agent and its task; a task that is gone already is ended as well.
export const PeerTaskStopPayloadSchema = z.object({ nodeId: ProjectNodeSchema.shape.id });

/*
 * Where a task stands and, once it settled, its result and the work as a bundle for `peer.bundleRead`.
 * `ack` says the other machine has the result, so it is not offered again. `haves` are commits that
 * machine has, which the bundle leaves out.
 */
export const PeerResultPayloadSchema = z.object({
    nodeId: ProjectNodeSchema.shape.id,
    ack: z.boolean().optional(),
    haves: z.array(z.string().min(1).max(64)).max(200).optional()
});
export type PeerResultPayload = z.infer<typeof PeerResultPayloadSchema>;

export const PeerResultResultSchema = z.object({
    // `unknown` for a task this machine has nothing of, such as one it never got.
    status: z.union([TaskStatusSchema, z.literal('unknown')]),
    result: TaskResultSchema.nullable(),
    bundle: GitBundleResultSchema.extend({ branch: z.string() }).nullable()
});
export type PeerResultResult = z.infer<typeof PeerResultResultSchema>;

export const PeerBundlePutPayloadSchema = GitBundlePutPayloadSchema;
export type PeerBundlePutPayload = z.infer<typeof PeerBundlePutPayloadSchema>;
export const PeerBundlePutResultSchema = GitBundlePutResultSchema;

// A piece of a bundle `peer.result` offered.
export const PeerBundleReadPayloadSchema = z.object({
    bundleId: z.string().min(1).max(64),
    offset: z.number().int().nonnegative(),
    length: z
        .number()
        .int()
        .positive()
        .max(256 * 1024)
});
export type PeerBundleReadPayload = z.infer<typeof PeerBundleReadPayloadSchema>;

export const PeerBundleReadResultSchema = z.object({
    size: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    data: z.string()
});
export type PeerBundleReadResult = z.infer<typeof PeerBundleReadResultSchema>;

// Lets go of the hold this machine has on a project here; the last holder out ends nothing by it.
export const PeerClosePayloadSchema = z.object({ projectId: PeerLinkSchema.shape.projectId });

// A task of that machine settled here; it asks `peer.result` for the rest.
export const PeerTaskSettledEventSchema = z.object({ nodeId: ProjectNodeSchema.shape.id });

/*
 * Output of the project the link names, read only, for a copy a person on that machine asked for.
 * An artifact of any other project here answers `not-found`, the way one that is not here does.
 */
export const PeerArtifactListPayloadSchema = z.object({ projectId: PeerLinkSchema.shape.projectId });

export const PeerArtifactGetPayloadSchema = z.object({ projectId: PeerLinkSchema.shape.projectId, artifactId: ArtifactIdSchema });

// The most `peer.artifactRead` answers at a time, as `peer.bundleRead` does.
export const PEER_ARTIFACT_PIECE_BYTES = 256 * 1024;

export const PeerArtifactReadPayloadSchema = z.object({
    projectId: PeerLinkSchema.shape.projectId,
    artifactId: ArtifactIdSchema,
    versionId: ArtifactVersionIdSchema,
    // The file's place in the version's manifest.
    file: z
        .number()
        .int()
        .nonnegative()
        .max(ARTIFACT_LIMITS.filesPerVersion - 1),
    offset: z.number().int().nonnegative(),
    length: z.number().int().positive().max(PEER_ARTIFACT_PIECE_BYTES)
});

export const PeerArtifactReadResultSchema = z.object({
    // The whole file, so a piece of a file that changed size tells.
    size: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    // Base64.
    data: z.string().max(Math.ceil(PEER_ARTIFACT_PIECE_BYTES / 3) * 4)
});
export type PeerArtifactReadResult = z.infer<typeof PeerArtifactReadResultSchema>;

export const PEER_REQUEST_SCHEMAS = {
    // Any client may link, change and unlink: only a person reaches these, an agent has no socket.
    'peer.list': { payload: EmptySchema, result: PeerListResultSchema },
    'peer.bind': { payload: PeerBindPayloadSchema, result: PeerLinkSchema },
    'peer.setCeiling': { payload: PeerSetCeilingPayloadSchema, result: EmptySchema },
    'peer.unbind': { payload: PeerUnbindPayloadSchema, result: EmptySchema },
    // The asking client holds the project from then on, as one that opened it.
    'peer.placeNodes': { payload: PeerPlaceNodesPayloadSchema, result: EmptySchema },
    // What a machine that works here asks (the peer list): each starts with the link a person made, and none is a person's.
    'peer.taskStart': { payload: PeerTaskStartPayloadSchema, result: PeerTaskStartResultSchema },
    'peer.taskStop': { payload: PeerTaskStopPayloadSchema, result: EmptySchema },
    'peer.result': { payload: PeerResultPayloadSchema, result: PeerResultResultSchema },
    'peer.bundlePut': { payload: PeerBundlePutPayloadSchema, result: PeerBundlePutResultSchema },
    'peer.bundleRead': { payload: PeerBundleReadPayloadSchema, result: PeerBundleReadResultSchema },
    'peer.close': { payload: PeerClosePayloadSchema, result: EmptySchema },
    'peer.artifactList': { payload: PeerArtifactListPayloadSchema, result: ArtifactListResultSchema },
    'peer.artifactGet': { payload: PeerArtifactGetPayloadSchema, result: ArtifactGetResultSchema },
    'peer.artifactRead': { payload: PeerArtifactReadPayloadSchema, result: PeerArtifactReadResultSchema }
} as const;

export const PEER_EVENT_SCHEMAS = {
    // The links of other machines to projects here changed, so the list in settings reloads.
    'peer.changed': EmptySchema,
    // Sent to the machine that gave the task, over its own link only.
    'peer.taskSettled': PeerTaskSettledEventSchema
} as const;
