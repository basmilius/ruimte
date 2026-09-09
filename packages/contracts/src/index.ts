import { z } from 'zod';
import { AgentResumePayloadSchema, SessionStatusEventSchema } from './agent.ts';
import {
    ChatAnswerPayloadSchema,
    ChatApprovePayloadSchema,
    ChatAttachResultSchema,
    ChatConfigurePayloadSchema,
    ChatCreatePayloadSchema,
    ChatEventEnvelopeSchema,
    ChatInfoSchema,
    ChatListResultSchema,
    ChatSendPayloadSchema,
    ChatTargetPayloadSchema
} from './chat.ts';
import { FsBrowsePayloadSchema, FsBrowseResultSchema, FsRevealPayloadSchema } from './fs.ts';
import { WorktreeAddPayloadSchema, WorktreeAddResultSchema, WorktreeListPayloadSchema, WorktreeListResultSchema, WorktreeRemovePayloadSchema } from './git.ts';
import { AuthRevokePayloadSchema, AuthSessionsResultSchema, EndpointInfoSchema } from './auth.ts';
import { ContextSetPayloadSchema } from './context.ts';
import { ProviderListResultSchema } from './model.ts';
import {
    ProjectChangedEventSchema,
    ProjectDeletePayloadSchema,
    ProjectListResultSchema,
    ProjectOpenPayloadSchema,
    ProjectOpenResultSchema,
    ProjectSaveLocalPayloadSchema,
    ProjectSavePayloadSchema,
    ProjectSaveResultSchema,
    ProjectTargetPayloadSchema
} from './project.ts';
import { ServerHelloPayloadSchema, ServerHelloResultSchema } from './server.ts';
import {
    SessionAttachPayloadSchema,
    SessionAttachResultSchema,
    SessionCreatePayloadSchema,
    SessionExitEventSchema,
    SessionInfoSchema,
    SessionListResultSchema,
    SessionOutputEventSchema,
    SessionResizePayloadSchema,
    SessionTargetPayloadSchema,
    SessionWritePayloadSchema
} from './session.ts';

export * from './agent.ts';
export * from './auth.ts';
export * from './chat.ts';
export * from './context.ts';
export * from './envelope.ts';
export * from './fs.ts';
export * from './git.ts';
export * from './ids.ts';
export * from './model.ts';
export * from './project.ts';
export * from './server.ts';
export * from './session.ts';

const EmptySchema = z.object({});

// Every request the wire knows, with the schema of what goes in and what comes back.
// Both apps derive their types from this table, so a shape can only change here.
export const REQUEST_SCHEMAS = {
    'server.hello': { payload: ServerHelloPayloadSchema, result: ServerHelloResultSchema },
    'session.create': { payload: SessionCreatePayloadSchema, result: SessionInfoSchema },
    'session.attach': { payload: SessionAttachPayloadSchema, result: SessionAttachResultSchema },
    'session.detach': { payload: SessionTargetPayloadSchema, result: EmptySchema },
    'session.write': { payload: SessionWritePayloadSchema, result: EmptySchema },
    'session.resize': { payload: SessionResizePayloadSchema, result: EmptySchema },
    'session.kill': { payload: SessionTargetPayloadSchema, result: EmptySchema },
    'session.list': { payload: EmptySchema, result: SessionListResultSchema },
    'agent.resume': { payload: AgentResumePayloadSchema, result: EmptySchema },
    'chat.create': { payload: ChatCreatePayloadSchema, result: ChatInfoSchema },
    'chat.attach': { payload: ChatTargetPayloadSchema, result: ChatAttachResultSchema },
    'chat.detach': { payload: ChatTargetPayloadSchema, result: EmptySchema },
    'chat.send': { payload: ChatSendPayloadSchema, result: EmptySchema },
    'chat.cancel': { payload: ChatTargetPayloadSchema, result: EmptySchema },
    'chat.approve': { payload: ChatApprovePayloadSchema, result: EmptySchema },
    'chat.answer': { payload: ChatAnswerPayloadSchema, result: EmptySchema },
    'chat.configure': { payload: ChatConfigurePayloadSchema, result: ChatInfoSchema },
    'chat.compact': { payload: ChatTargetPayloadSchema, result: EmptySchema },
    'provider.list': { payload: EmptySchema, result: ProviderListResultSchema },
    'project.list': { payload: EmptySchema, result: ProjectListResultSchema },
    'project.open': { payload: ProjectOpenPayloadSchema, result: ProjectOpenResultSchema },
    'project.save': { payload: ProjectSavePayloadSchema, result: ProjectSaveResultSchema },
    'project.save-local': { payload: ProjectSaveLocalPayloadSchema, result: EmptySchema },
    'project.close': { payload: ProjectTargetPayloadSchema, result: EmptySchema },
    'project.delete': { payload: ProjectDeletePayloadSchema, result: EmptySchema },
    'fs.browse': { payload: FsBrowsePayloadSchema, result: FsBrowseResultSchema },
    'fs.reveal': { payload: FsRevealPayloadSchema, result: EmptySchema },
    'git.worktree-add': { payload: WorktreeAddPayloadSchema, result: WorktreeAddResultSchema },
    'git.worktree-list': { payload: WorktreeListPayloadSchema, result: WorktreeListResultSchema },
    'git.worktree-remove': { payload: WorktreeRemovePayloadSchema, result: EmptySchema },
    'context.set': { payload: ContextSetPayloadSchema, result: EmptySchema },
    'endpoint.info': { payload: EmptySchema, result: EndpointInfoSchema },
    'auth.sessions': { payload: EmptySchema, result: AuthSessionsResultSchema },
    'auth.revoke': { payload: AuthRevokePayloadSchema, result: EmptySchema },
    'chat.kill': { payload: ChatTargetPayloadSchema, result: EmptySchema },
    'chat.list': { payload: EmptySchema, result: ChatListResultSchema }
} as const satisfies Record<string, { payload: z.ZodType; result: z.ZodType }>;

export type RequestType = keyof typeof REQUEST_SCHEMAS;

export type RequestMap = {
    [T in RequestType]: {
        payload: z.infer<(typeof REQUEST_SCHEMAS)[T]['payload']>;
        result: z.infer<(typeof REQUEST_SCHEMAS)[T]['result']>;
    };
};

export const EVENT_SCHEMAS = {
    'session.output': SessionOutputEventSchema,
    'session.exit': SessionExitEventSchema,
    'session.status': SessionStatusEventSchema,
    'session.list-changed': EmptySchema,
    'chat.event': ChatEventEnvelopeSchema,
    'project.changed': ProjectChangedEventSchema
} as const satisfies Record<string, z.ZodType>;

export type EventType = keyof typeof EVENT_SCHEMAS;

export type EventMap = {
    [E in EventType]: z.infer<(typeof EVENT_SCHEMAS)[E]>;
};

export const isRequestType = (type: string): type is RequestType => Object.hasOwn(REQUEST_SCHEMAS, type);

export const isEventType = (event: string): event is EventType => Object.hasOwn(EVENT_SCHEMAS, event);
