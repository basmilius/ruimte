import { SessionIdSchema } from '@adecore/agent-contracts/ids';
import { RuntimeModeSchema } from '@adecore/agent-contracts/model';
import { EmptySchema } from '@adecore/agent-contracts/protocol';
import { ProviderAccountIdSchema } from '@adecore/agent-contracts/provider-accounts';
import { z } from 'zod';
import { AgentInfoSchema, AgentKindSchema } from './agent.ts';
import { SessionPortsResultSchema } from './session-ports.ts';

// An agent CLI to start in a fresh shell. The daemon owns the command line, so every client
// launches a CLI the same way and a new flag never has to travel over the wire.
export const AgentLaunchSchema = z.object({
    kind: AgentKindSchema,
    // Ruimte's own permission vocabulary; each CLI's launcher maps it to its flags.
    runtimeMode: RuntimeModeSchema.optional(),
    model: z.string().min(1).optional(),
    // The CLI's own session id, to continue that conversation instead of starting one.
    resume: z.string().min(1).optional(),
    // The account of the CLI to start under; absent is the CLI's default account.
    account: ProviderAccountIdSchema.optional()
});
export type AgentLaunch = z.infer<typeof AgentLaunchSchema>;

const cols = z.number().int().positive();
const rows = z.number().int().positive();

export const SessionInfoSchema = z.object({
    sessionId: SessionIdSchema,
    cwd: z.string(),
    pid: z.number().int(),
    cols,
    rows,
    createdAt: z.number(),
    attached: z.number().int().nonnegative(),
    exited: z.boolean(),
    // Only present once the shell has ended; a signal death is reported shell-style as 128 plus the signal number.
    exitCode: z.number().int().optional(),
    // The agent CLI last seen in this shell, if any.
    agent: AgentInfoSchema.nullable().optional(),
    // A command from a project file that no person on this machine approved yet: the shell started
    // without it, and `session.runHeld` types it. A client that does not know the field shows a bare shell.
    heldCommand: z.string().optional(),
    // The account the CLI this shell was opened for runs under, however the daemon settled it; absent is its default account.
    account: ProviderAccountIdSchema.optional(),
    // The name of the shell a line typed here reaches (`powershell`, `bash`, `cmd`), so a client quotes for it.
    shell: z.string().optional()
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const SessionCreatePayloadSchema = z.object({
    sessionId: SessionIdSchema,
    cwd: z.string().optional(),
    cols,
    rows,
    shell: z.string().optional(),
    // Typed into the fresh shell as its first line, so a node can open straight into a program, once
    // a person on this machine approved it for this node; until then it is held (`heldCommand`).
    command: z.string().optional(),
    // An agent CLI to start instead; the daemon builds its command line and types that.
    agent: AgentLaunchSchema.optional(),
    // A plain shell no node stands for, which ends when the client that asked for it leaves. A machine
    // before this field ignores it and keeps the shell until it is killed.
    endsWithClient: z.boolean().optional()
});

// A shell in the home folder that runs a CLI's own login under one of its accounts, for a person
// who asked for it outside any project. The daemon picks the command, so nothing is ever held.
export const SessionLoginPayloadSchema = z.object({
    sessionId: SessionIdSchema,
    kind: AgentKindSchema,
    // Absent is the CLI's default account.
    account: ProviderAccountIdSchema.optional(),
    cols,
    rows
});

export const SessionAttachPayloadSchema = z
    .object({
        sessionId: SessionIdSchema,
        cols: cols.optional(),
        rows: rows.optional(),
        // A phone follows the shared PTY size without shrinking a desktop attached beside it.
        follow: z.boolean().optional()
    })
    .refine((payload) => (payload.cols === undefined) === (payload.rows === undefined) && (payload.follow === true || payload.cols !== undefined), {
        message: 'Supply both cols and rows, or follow the existing terminal size'
    });
export type SessionAttachPayload = z.infer<typeof SessionAttachPayloadSchema>;

export const SessionAttachResultSchema = z.object({
    screen: z.string(),
    cols,
    rows,
    exited: z.boolean()
});
export type SessionAttachResult = z.infer<typeof SessionAttachResultSchema>;

export const SessionTargetPayloadSchema = z.object({
    sessionId: SessionIdSchema
});

export const SessionWritePayloadSchema = z.object({
    sessionId: SessionIdSchema,
    data: z.string()
});

export const SessionResizePayloadSchema = z.object({
    sessionId: SessionIdSchema,
    cols,
    rows
});

export const SessionListResultSchema = z.object({
    sessions: z.array(SessionInfoSchema)
});
export type SessionListResult = z.infer<typeof SessionListResultSchema>;

export const SessionOutputEventSchema = z.object({
    sessionId: SessionIdSchema,
    data: z.string()
});
export type SessionOutputEvent = z.infer<typeof SessionOutputEventSchema>;

export const SessionExitEventSchema = z.object({
    sessionId: SessionIdSchema,
    exitCode: z.number().int()
});

// Sent instead of the output a slow client missed: the daemon owns the screen, so it can hand
// out a fresh one and continue the stream from there.
export const SessionResyncEventSchema = z.object({
    sessionId: SessionIdSchema,
    screen: z.string()
});

// The grid the PTY moved to, for every client attached: one that fits another grid draws this one until it is active again.
export const SessionSizeEventSchema = z.object({
    sessionId: SessionIdSchema,
    cols,
    rows
});

export const SESSION_REQUEST_SCHEMAS = {
    'session.create': { payload: SessionCreatePayloadSchema, result: SessionInfoSchema },
    'session.attach': { payload: SessionAttachPayloadSchema, result: SessionAttachResultSchema },
    'session.detach': { payload: SessionTargetPayloadSchema, result: EmptySchema },
    'session.write': { payload: SessionWritePayloadSchema, result: EmptySchema },
    'session.resize': { payload: SessionResizePayloadSchema, result: EmptySchema },
    'session.kill': { payload: SessionTargetPayloadSchema, result: EmptySchema },
    'session.clear': { payload: SessionTargetPayloadSchema, result: EmptySchema },
    'session.list': { payload: EmptySchema, result: SessionListResultSchema },
    'session.ports': { payload: SessionTargetPayloadSchema, result: SessionPortsResultSchema },
    // A person approving the command the session holds: it is written down and typed. Nothing held is no error.
    'session.runHeld': { payload: SessionTargetPayloadSchema, result: EmptySchema },
    // Ends once the client that asked leaves; `login-unavailable` for a CLI without a login of its own.
    'session.login': { payload: SessionLoginPayloadSchema, result: SessionInfoSchema }
} as const;

export const SESSION_EVENT_SCHEMAS = {
    'session.output': SessionOutputEventSchema,
    'session.resync': SessionResyncEventSchema,
    'session.size': SessionSizeEventSchema,
    'session.exit': SessionExitEventSchema,
    'session.list-changed': EmptySchema
} as const;
