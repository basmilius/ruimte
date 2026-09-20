import { ProjectSidebarResultSchema } from './project-sidebar.ts';
import { z } from 'zod';
import {
    BrowserCommandPayloadSchema,
    BrowserFrameSchema,
    BrowserInfoSchema,
    BrowserInputPayloadSchema,
    BrowserNavigatePayloadSchema,
    BrowserOpenPayloadSchema,
    BrowserResizePayloadSchema,
    BrowserTargetPayloadSchema
} from './browser.ts';
import {
    DeviceActionPayloadSchema,
    DeviceDetailPayloadSchema,
    DeviceDetailSchema,
    DeviceFrameSchema,
    DeviceInfoSchema,
    DeviceInputPayloadSchema,
    DeviceListResultSchema,
    DeviceOpenPayloadSchema,
    DeviceOpenResultSchema,
    DeviceTargetPayloadSchema
} from './device.ts';
import {
    PushSubscribePayloadSchema,
    PushUnsubscribePayloadSchema,
    PushAttentionResultSchema,
    PushReadPayloadSchema,
    PushAttentionEntrySchema
} from './push.ts';
import { RenderSceneResultSchema } from './render.ts';
import { BytesReadPayloadSchema, BytesReadResultSchema } from './bytes.ts';
import {
    AgentResumePayloadSchema,
    ApprovalAnswerPayloadSchema,
    ApprovalAnswerResultSchema,
    ApprovalPreferencePayloadSchema,
    SessionApprovalsEventSchema,
    SessionStatusEventSchema
} from './agent.ts';
import {
    ChatAnswerPayloadSchema,
    ChatApprovePayloadSchema,
    ChatAttachResultSchema,
    ChatAttachPayloadSchema,
    ChatHistoryPayloadSchema,
    ChatHistoryResultSchema,
    ChatConfigurePayloadSchema,
    ChatPreferencesPayloadSchema,
    ChatCancelPayloadSchema,
    ChatClearPayloadSchema,
    ChatCreatePayloadSchema,
    ChatDismissPayloadSchema,
    ChatEventEnvelopeSchema,
    ChatForkInfoPayloadSchema,
    ChatForkInfoResultSchema,
    ChatForkPayloadSchema,
    ChatForkResultSchema,
    ChatSummarizePayloadSchema,
    ChatSummarizeResultSchema,
    ChatInfoSchema,
    ChatListResultSchema,
    ChatQueuePayloadSchema,
    ChatSendPayloadSchema,
    ChatSendResultSchema,
    ChatStatusEventSchema,
    ChatSubagentChangedEventSchema,
    ChatStopSubagentPayloadSchema,
    ChatSubagentPayloadSchema,
    ChatSubagentResultSchema,
    ChatTargetPayloadSchema,
    ChatTurnDiffPayloadSchema,
    ChatTurnDiffResultSchema,
    SkillsListPayloadSchema,
    SkillsListResultSchema
} from './chat.ts';
import {
    FsBrowsePayloadSchema,
    FsBrowseResultSchema,
    FsChangedEventSchema,
    FsGrepPayloadSchema,
    FsGrepResultSchema,
    FsListPayloadSchema,
    FsListResultSchema,
    FsReadPayloadSchema,
    FsReadResultSchema,
    FsRevealPayloadSchema,
    FsSearchPayloadSchema,
    FsSearchResultSchema,
    FsWatchPayloadSchema
} from './fs.ts';
import {
    GitActionPayloadSchema,
    GitActionResultSchema,
    GitCancelPayloadSchema,
    GitCapabilitiesResultSchema,
    GitChangedEventSchema,
    GitCwdPayloadSchema,
    GitDiffPayloadSchema,
    GitDiffResultSchema,
    GitDiscardPayloadSchema,
    GitDiscardResultSchema,
    GitLogPayloadSchema,
    GitLogResultSchema,
    GitProgressEventSchema,
    GitRefsResultSchema,
    GitStagePayloadSchema,
    GitStatusEventSchema,
    GitStatusSchema,
    GitSuggestMessagePayloadSchema,
    GitSuggestMessageResultSchema,
    GitWorktreesEventSchema,
    WorktreeAddPayloadSchema,
    WorktreeAddResultSchema,
    WorktreeListPayloadSchema,
    WorktreeListResultSchema,
    WorktreeMergePayloadSchema,
    WorktreeMergeResultSchema,
    WorktreeRemovePayloadSchema,
    WorktreeRemoveResultSchema
} from './git.ts';
import {
    AuthRegisterKeyPayloadSchema,
    AuthRegisterKeyResultSchema,
    AuthRevokePayloadSchema,
    AuthSessionsResultSchema,
    EndpointChangedEventSchema,
    EndpointInfoSchema,
    EndpointSetIdentityPayloadSchema,
    EndpointSignRegistrationPayloadSchema,
    EndpointSignRegistrationResultSchema,
    PairingTokenResultSchema
} from './auth.ts';
import { DirectSignalPayloadSchema } from './direct.ts';
import {
    DrawingChangedEventSchema,
    DrawingCopyPayloadSchema,
    DrawingOpenResultSchema,
    DrawingSavePayloadSchema,
    DrawingSaveResultSchema,
    DrawingTargetPayloadSchema
} from './drawing.ts';
import {
    DiagramChangedEventSchema,
    DiagramCopyPayloadSchema,
    DiagramOpenResultSchema,
    DiagramSavePayloadSchema,
    DiagramSaveResultSchema,
    DiagramTargetPayloadSchema
} from './diagram.ts';
import { ProviderListResultSchema } from './model.ts';
import {
    PlanApplyPayloadSchema,
    PlanApplyResultSchema,
    PlanChangedEventSchema,
    PlanCreatedEventSchema,
    PlanListPayloadSchema,
    PlanListResultSchema,
    PlanRemovedEventSchema
} from './plan.ts';
import {
    ProjectChangedEventSchema,
    ProjectDeletePayloadSchema,
    ProjectListResultSchema,
    ProjectOpenPayloadSchema,
    ProjectOpenResultSchema,
    ProjectSaveLocalPayloadSchema,
    ProjectSavePayloadSchema,
    ProjectSaveResultSchema,
    ProjectSetIconPayloadSchema,
    ProjectSetIdentityPayloadSchema,
    ProjectSettingsPayloadSchema,
    ProjectSettingsSchema,
    ProjectSettingsUpdatePayloadSchema,
    ProjectShowViewEventSchema,
    ProjectSummaryEventSchema,
    ProjectSummaryResultSchema,
    ProjectTargetPayloadSchema
} from './project.ts';
import {
    ProcessesAlertsSchema,
    ProcessesDismissPayloadSchema,
    ProcessesSampleEventSchema,
    ProcessesSignalPayloadSchema,
    ProcessesSubscribePayloadSchema,
    ProcessesSubscribeResultSchema
} from './processes.ts';
import { ServerHelloPayloadSchema, ServerHelloResultSchema, ServerPingPayloadSchema, ServerPingResultSchema } from './server.ts';
import {
    SessionAttachPayloadSchema,
    SessionAttachResultSchema,
    SessionCreatePayloadSchema,
    SessionExitEventSchema,
    SessionInfoSchema,
    SessionListResultSchema,
    SessionOutputEventSchema,
    SessionResizePayloadSchema,
    SessionResyncEventSchema,
    SessionTargetPayloadSchema,
    SessionWritePayloadSchema
} from './session.ts';
import { AgentChildrenPayloadSchema, AgentChildrenResultSchema, TaskChangedEventSchema, TaskListPayloadSchema, TaskListResultSchema } from './task.ts';
import { UsageChangedEventSchema, UsageLimitsSnapshotSchema, UsageSummaryPayloadSchema, UsageSummaryResultSchema } from './usage.ts';

export * from './agent.ts';
export * from './auth.ts';
export * from './browser.ts';
export * from './bytes.ts';
export * from './chat.ts';
export * from './context.ts';
export * from './direct.ts';
export * from './direct-liveness.ts';
export * from './device.ts';
export * from './context-sources.ts';
export * from './diagram.ts';
export * from './drawing.ts';
export * from './envelope.ts';
export * from './font.ts';
export * from './fs.ts';
export * from './git.ts';
export * from './ids.ts';
export * from './live-stream.ts';
export * from './machine-http.ts';
export * from './model.ts';
export * from './node-defaults.ts';
export * from './plan.ts';
export * from './processes.ts';
export * from './project.ts';
export * from './project-sidebar.ts';
export * from './project-migrate.ts';
export * from './project-split.ts';
export * from './protocol.ts';
export * from './project-views.ts';
export * from './server.ts';
export * from './session.ts';
export * from './render.ts';
export * from './push.ts';
export * from './stored-path.ts';
export * from './task.ts';
export * from './usage.ts';
export * from './voice-languages.ts';
export * from './voice-tools.ts';

const EmptySchema = z.object({});

// Every request the wire knows, with the schema of what goes in and what comes back.
// Both apps derive their types from this table, so a shape can only change here.
export const REQUEST_SCHEMAS = {
    'server.hello': { payload: ServerHelloPayloadSchema, result: ServerHelloResultSchema },
    'server.ping': { payload: ServerPingPayloadSchema, result: ServerPingResultSchema },
    'session.create': { payload: SessionCreatePayloadSchema, result: SessionInfoSchema },
    'push.attention': { payload: EmptySchema, result: PushAttentionResultSchema },
    'push.read': { payload: PushReadPayloadSchema, result: EmptySchema },
    'push.subscribe': { payload: PushSubscribePayloadSchema, result: EmptySchema },
    'push.unsubscribe': { payload: PushUnsubscribePayloadSchema, result: EmptySchema },
    'session.attach': { payload: SessionAttachPayloadSchema, result: SessionAttachResultSchema },
    'session.detach': { payload: SessionTargetPayloadSchema, result: EmptySchema },
    'session.write': { payload: SessionWritePayloadSchema, result: EmptySchema },
    'session.resize': { payload: SessionResizePayloadSchema, result: EmptySchema },
    'session.kill': { payload: SessionTargetPayloadSchema, result: EmptySchema },
    'session.clear': { payload: SessionTargetPayloadSchema, result: EmptySchema },
    'session.list': { payload: EmptySchema, result: SessionListResultSchema },
    'browser.open': { payload: BrowserOpenPayloadSchema, result: BrowserInfoSchema },
    'browser.detach': { payload: BrowserTargetPayloadSchema, result: EmptySchema },
    'browser.kill': { payload: BrowserTargetPayloadSchema, result: EmptySchema },
    'browser.navigate': { payload: BrowserNavigatePayloadSchema, result: BrowserInfoSchema },
    'browser.command': { payload: BrowserCommandPayloadSchema, result: BrowserInfoSchema },
    'browser.resize': { payload: BrowserResizePayloadSchema, result: EmptySchema },
    'browser.input': { payload: BrowserInputPayloadSchema, result: EmptySchema },
    'device.list': { payload: EmptySchema, result: DeviceListResultSchema },
    'device.boot': { payload: DeviceTargetPayloadSchema, result: DeviceInfoSchema },
    'device.shutdown': { payload: DeviceTargetPayloadSchema, result: DeviceInfoSchema },
    'device.open': { payload: DeviceOpenPayloadSchema, result: DeviceOpenResultSchema },
    'device.detach': { payload: DeviceTargetPayloadSchema, result: EmptySchema },
    'device.input': { payload: DeviceInputPayloadSchema, result: EmptySchema },
    'device.detail': { payload: DeviceDetailPayloadSchema, result: DeviceDetailSchema },
    'device.action': { payload: DeviceActionPayloadSchema, result: DeviceDetailSchema },
    'agent.resume': { payload: AgentResumePayloadSchema, result: EmptySchema },
    'agent.answerApproval': { payload: ApprovalAnswerPayloadSchema, result: ApprovalAnswerResultSchema },
    'agent.setApprovals': { payload: ApprovalPreferencePayloadSchema, result: EmptySchema },
    'chat.create': { payload: ChatCreatePayloadSchema, result: ChatInfoSchema },
    'chat.history': { payload: ChatHistoryPayloadSchema, result: ChatHistoryResultSchema },
    'chat.attach': { payload: ChatAttachPayloadSchema, result: ChatAttachResultSchema },
    'chat.detach': { payload: ChatTargetPayloadSchema, result: EmptySchema },
    'chat.send': { payload: ChatSendPayloadSchema, result: ChatSendResultSchema },
    'chat.unqueue': { payload: ChatQueuePayloadSchema, result: EmptySchema },
    'chat.sendNow': { payload: ChatQueuePayloadSchema, result: EmptySchema },
    'chat.cancel': { payload: ChatCancelPayloadSchema, result: EmptySchema },
    'chat.approve': { payload: ChatApprovePayloadSchema, result: EmptySchema },
    'chat.answer': { payload: ChatAnswerPayloadSchema, result: EmptySchema },
    'chat.dismiss': { payload: ChatDismissPayloadSchema, result: EmptySchema },
    'chat.configure': { payload: ChatConfigurePayloadSchema, result: ChatInfoSchema },
    'chat.setPreferences': { payload: ChatPreferencesPayloadSchema, result: EmptySchema },
    'chat.compact': { payload: ChatTargetPayloadSchema, result: EmptySchema },
    'chat.clear': { payload: ChatClearPayloadSchema, result: EmptySchema },
    'chat.turnDiff': { payload: ChatTurnDiffPayloadSchema, result: ChatTurnDiffResultSchema },
    'chat.fork': { payload: ChatForkPayloadSchema, result: ChatForkResultSchema },
    'chat.forkInfo': { payload: ChatForkInfoPayloadSchema, result: ChatForkInfoResultSchema },
    'chat.summarize': { payload: ChatSummarizePayloadSchema, result: ChatSummarizeResultSchema },
    'chat.subagent': { payload: ChatSubagentPayloadSchema, result: ChatSubagentResultSchema },
    'chat.stopSubagent': { payload: ChatStopSubagentPayloadSchema, result: EmptySchema },
    'skills.list': { payload: SkillsListPayloadSchema, result: SkillsListResultSchema },
    'provider.list': { payload: EmptySchema, result: ProviderListResultSchema },
    'project.sidebar': { payload: EmptySchema, result: ProjectSidebarResultSchema },
    'project.list': { payload: EmptySchema, result: ProjectListResultSchema },
    'project.open': { payload: ProjectOpenPayloadSchema, result: ProjectOpenResultSchema },
    'project.save': { payload: ProjectSavePayloadSchema, result: ProjectSaveResultSchema },
    'project.save-local': { payload: ProjectSaveLocalPayloadSchema, result: EmptySchema },
    'project.close': { payload: ProjectTargetPayloadSchema, result: EmptySchema },
    'project.release': { payload: ProjectTargetPayloadSchema, result: EmptySchema },
    'project.setIcon': { payload: ProjectSetIconPayloadSchema, result: ProjectSummaryResultSchema },
    'project.setIdentity': { payload: ProjectSetIdentityPayloadSchema, result: ProjectSummaryResultSchema },
    'project.settings': { payload: ProjectSettingsPayloadSchema, result: ProjectSettingsSchema },
    'project.settings-update': { payload: ProjectSettingsUpdatePayloadSchema, result: ProjectSettingsSchema },
    'project.delete': { payload: ProjectDeletePayloadSchema, result: EmptySchema },
    'drawing.paths': { payload: DrawingTargetPayloadSchema, result: RenderSceneResultSchema },
    'drawing.open': { payload: DrawingTargetPayloadSchema, result: DrawingOpenResultSchema },
    'drawing.save': { payload: DrawingSavePayloadSchema, result: DrawingSaveResultSchema },
    'drawing.close': { payload: DrawingTargetPayloadSchema, result: EmptySchema },
    'drawing.copy': { payload: DrawingCopyPayloadSchema, result: EmptySchema },
    'diagram.layout': { payload: DiagramTargetPayloadSchema, result: RenderSceneResultSchema },
    'diagram.open': { payload: DiagramTargetPayloadSchema, result: DiagramOpenResultSchema },
    'diagram.save': { payload: DiagramSavePayloadSchema, result: DiagramSaveResultSchema },
    'diagram.close': { payload: DiagramTargetPayloadSchema, result: EmptySchema },
    'diagram.copy': { payload: DiagramCopyPayloadSchema, result: EmptySchema },
    'fs.browse': { payload: FsBrowsePayloadSchema, result: FsBrowseResultSchema },
    'fs.reveal': { payload: FsRevealPayloadSchema, result: EmptySchema },
    'fs.search': { payload: FsSearchPayloadSchema, result: FsSearchResultSchema },
    'fs.grep': { payload: FsGrepPayloadSchema, result: FsGrepResultSchema },
    'fs.list': { payload: FsListPayloadSchema, result: FsListResultSchema },
    'fs.read': { payload: FsReadPayloadSchema, result: FsReadResultSchema },
    'fs.watch': { payload: FsWatchPayloadSchema, result: EmptySchema },
    'fs.unwatch': { payload: FsWatchPayloadSchema, result: EmptySchema },
    'bytes.read': { payload: BytesReadPayloadSchema, result: BytesReadResultSchema },
    'git.worktree-add': { payload: WorktreeAddPayloadSchema, result: WorktreeAddResultSchema },
    'git.worktree-list': { payload: WorktreeListPayloadSchema, result: WorktreeListResultSchema },
    'git.worktree-remove': { payload: WorktreeRemovePayloadSchema, result: WorktreeRemoveResultSchema },
    'git.worktree-merge': { payload: WorktreeMergePayloadSchema, result: WorktreeMergeResultSchema },
    'git.worktree-abort': { payload: GitCwdPayloadSchema, result: EmptySchema },
    'git.status': { payload: GitCwdPayloadSchema, result: GitStatusSchema },
    'git.watch': { payload: GitCwdPayloadSchema, result: EmptySchema },
    'git.unwatch': { payload: GitCwdPayloadSchema, result: EmptySchema },
    'git.diff': { payload: GitDiffPayloadSchema, result: GitDiffResultSchema },
    'git.stage': { payload: GitStagePayloadSchema, result: EmptySchema },
    'git.discard': { payload: GitDiscardPayloadSchema, result: GitDiscardResultSchema },
    'git.refs': { payload: GitCwdPayloadSchema, result: GitRefsResultSchema },
    'git.log': { payload: GitLogPayloadSchema, result: GitLogResultSchema },
    'git.action': { payload: GitActionPayloadSchema, result: GitActionResultSchema },
    'git.cancel': { payload: GitCancelPayloadSchema, result: EmptySchema },
    'git.capabilities': { payload: GitCwdPayloadSchema, result: GitCapabilitiesResultSchema },
    'git.suggestMessage': { payload: GitSuggestMessagePayloadSchema, result: GitSuggestMessageResultSchema },
    'usage.summary': { payload: UsageSummaryPayloadSchema, result: UsageSummaryResultSchema },
    'usage.subscribe': { payload: EmptySchema, result: EmptySchema },
    'usage.unsubscribe': { payload: EmptySchema, result: EmptySchema },
    'usage.limits': { payload: EmptySchema, result: UsageLimitsSnapshotSchema },
    'usage.refreshLimits': { payload: EmptySchema, result: UsageLimitsSnapshotSchema },
    'processes.subscribe': { payload: ProcessesSubscribePayloadSchema, result: ProcessesSubscribeResultSchema },
    'processes.unsubscribe': { payload: EmptySchema, result: EmptySchema },
    'processes.signal': { payload: ProcessesSignalPayloadSchema, result: EmptySchema },
    'processes.listAlerts': { payload: EmptySchema, result: ProcessesAlertsSchema },
    'processes.dismiss': { payload: ProcessesDismissPayloadSchema, result: EmptySchema },
    'endpoint.info': { payload: EmptySchema, result: EndpointInfoSchema },
    'endpoint.setIdentity': { payload: EndpointSetIdentityPayloadSchema, result: EndpointInfoSchema },
    'endpoint.signRegistration': { payload: EndpointSignRegistrationPayloadSchema, result: EndpointSignRegistrationResultSchema },
    'auth.sessions': { payload: EmptySchema, result: AuthSessionsResultSchema },
    'auth.revoke': { payload: AuthRevokePayloadSchema, result: EmptySchema },
    'auth.pairingToken': { payload: EmptySchema, result: PairingTokenResultSchema },
    'auth.registerKey': { payload: AuthRegisterKeyPayloadSchema, result: AuthRegisterKeyResultSchema },
    'direct.signal': { payload: DirectSignalPayloadSchema, result: EmptySchema },
    'chat.kill': { payload: ChatTargetPayloadSchema, result: EmptySchema },
    'chat.list': { payload: EmptySchema, result: ChatListResultSchema },
    'task.list': { payload: TaskListPayloadSchema, result: TaskListResultSchema },
    'agent.children': { payload: AgentChildrenPayloadSchema, result: AgentChildrenResultSchema },
    'plan.list': { payload: PlanListPayloadSchema, result: PlanListResultSchema },
    'plan.apply': { payload: PlanApplyPayloadSchema, result: PlanApplyResultSchema }
} as const satisfies Record<string, { payload: z.ZodType; result: z.ZodType }>;

export type RequestType = keyof typeof REQUEST_SCHEMAS;

export type RequestMap = {
    [T in RequestType]: {
        payload: z.infer<(typeof REQUEST_SCHEMAS)[T]['payload']>;
        result: z.infer<(typeof REQUEST_SCHEMAS)[T]['result']>;
    };
};

export const EVENT_SCHEMAS = {
    'push.attention': PushAttentionEntrySchema,
    'session.output': SessionOutputEventSchema,
    'session.resync': SessionResyncEventSchema,
    'session.exit': SessionExitEventSchema,
    'session.status': SessionStatusEventSchema,
    'session.approvals': SessionApprovalsEventSchema,
    'session.list-changed': EmptySchema,
    'browser.frame': BrowserFrameSchema,
    'browser.status': BrowserInfoSchema,
    'device.frame': DeviceFrameSchema,
    'chat.event': ChatEventEnvelopeSchema,
    'chat.status': ChatStatusEventSchema,
    'chat.subagentChanged': ChatSubagentChangedEventSchema,
    'endpoint.changed': EndpointChangedEventSchema,
    'direct.signaled': DirectSignalPayloadSchema,
    'project.changed': ProjectChangedEventSchema,
    'project.showView': ProjectShowViewEventSchema,
    'project.summary': ProjectSummaryEventSchema,
    'drawing.changed': DrawingChangedEventSchema,
    'diagram.changed': DiagramChangedEventSchema,
    'fs.changed': FsChangedEventSchema,
    'git.status': GitStatusEventSchema,
    'git.changed': GitChangedEventSchema,
    'git.progress': GitProgressEventSchema,
    'git.worktrees': GitWorktreesEventSchema,
    'usage.changed': UsageChangedEventSchema,
    'usage.limitsChanged': UsageLimitsSnapshotSchema,
    'processes.sample': ProcessesSampleEventSchema,
    'processes.alerts': ProcessesAlertsSchema,
    'task.changed': TaskChangedEventSchema,
    'plan.changed': PlanChangedEventSchema,
    'plan.removed': PlanRemovedEventSchema,
    'plan.created': PlanCreatedEventSchema
} as const satisfies Record<string, z.ZodType>;

export type EventType = keyof typeof EVENT_SCHEMAS;

export type EventMap = {
    [E in EventType]: z.infer<(typeof EVENT_SCHEMAS)[E]>;
};

export const isRequestType = (type: string): type is RequestType => Object.hasOwn(REQUEST_SCHEMAS, type);

export const isEventType = (event: string): event is EventType => Object.hasOwn(EVENT_SCHEMAS, event);
