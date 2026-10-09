import {
    TerminalPreparePreviewPayloadSchema,
    TerminalPreparePreviewResultSchema,
    TerminalPreparePayloadSchema,
    TerminalPrepareResultSchema
} from './terminal-prepare.ts';
export * from './terminal-prepare.ts';
import { AGENT_EVENT_SCHEMAS, AGENT_REQUEST_SCHEMAS, EmptySchema } from '@adecore/agent-contracts/protocol';
import { ChatImageTargetPayloadSchema, ChatImageTargetResultSchema, ChatImageSavePayloadSchema, ChatImageSaveResultSchema } from './chat-image.ts';
import { ProjectSidebarResultSchema } from './project-sidebar.ts';
import { z } from 'zod';
import { SessionPortsResultSchema, SessionPortVerifyPayloadSchema, SessionPortVerifyResultSchema } from './session-ports.ts';
import {
    BrowserCommandPayloadSchema,
    BrowserDevServersPayloadSchema,
    BrowserDevServersResultSchema,
    BrowserDriveEventSchema,
    BrowserDriveResultPayloadSchema,
    BrowserFrameSchema,
    BrowserHoldPayloadSchema,
    BrowserInfoSchema,
    BrowserInputPayloadSchema,
    BrowserNavigatePayloadSchema,
    BrowserOpenPayloadSchema,
    BrowserResizePayloadSchema,
    BrowserTargetPayloadSchema
} from './browser.ts';
import {
    DeviceActionPayloadSchema,
    DeviceControlPayloadSchema,
    DeviceDetailPayloadSchema,
    DeviceDetailSchema,
    DeviceFrameSchema,
    DeviceInfoSchema,
    DeviceInputPayloadSchema,
    DeviceListResultSchema,
    DeviceOpenPayloadSchema,
    DeviceOpenResultSchema,
    DeviceOperatedSchema,
    DeviceOperationsResultSchema,
    DeviceTargetPayloadSchema
} from './device.ts';
import {
    PushSubscribePayloadSchema,
    PushUnsubscribePayloadSchema,
    PushPreferencesResultSchema,
    PushAttentionResultSchema,
    PushReadPayloadSchema,
    PushAttentionEntrySchema
} from './push.ts';
import { RenderSceneResultSchema } from './render.ts';
import { SnoozeClearPayloadSchema, SnoozeListSchema, SnoozeSetPayloadSchema } from './snooze.ts';
import {
    EndpointInstallUpdatePayloadSchema,
    EndpointInstallUpdateResultSchema,
    EndpointUpdateChangedEventSchema,
    MachineUpdateReportSchema
} from './machine-update.ts';
import { BytesReadPayloadSchema, BytesReadResultSchema } from './bytes.ts';
import {
    DatabaseSnapshotRefreshPayloadSchema,
    LanguageSqlBindPayloadSchema,
    LanguageSqlChangedEventSchema,
    LanguageSqlPayloadSchema,
    LanguageSqlStateSchema
} from './sql-binding.ts';
import {
    AgentResumePayloadSchema,
    ApprovalAnswerPayloadSchema,
    ApprovalAnswerResultSchema,
    ApprovalPreferencePayloadSchema,
    SessionApprovalsEventSchema,
    SessionStatusEventSchema
} from './agent.ts';
import {
    FsBrowsePayloadSchema,
    FsBrowseResultSchema,
    FsChangedEventSchema,
    FsCreatePayloadSchema,
    FsCreateResultSchema,
    FsDeletePayloadSchema,
    FsGrepPayloadSchema,
    FsGrepResultSchema,
    FsListPayloadSchema,
    FsListResultSchema,
    FsReadPayloadSchema,
    FsReadResultSchema,
    FsRenamePayloadSchema,
    FsRenameResultSchema,
    FsRevealPayloadSchema,
    FsSearchPayloadSchema,
    FsSearchResultSchema,
    FsWatchPayloadSchema,
    FsWritePayloadSchema,
    FsWriteResultSchema
} from './fs.ts';
import {
    GitActionPayloadSchema,
    GitActionResultSchema,
    GitBlamePayloadSchema,
    GitBlameResultSchema,
    GitCancelPayloadSchema,
    GitCapabilitiesResultSchema,
    GitChangedEventSchema,
    GitConflictPayloadSchema,
    GitConflictResultSchema,
    GitConflictsResultSchema,
    GitCwdPayloadSchema,
    GitDiffPayloadSchema,
    GitDiffResultSchema,
    GitDiscardPayloadSchema,
    GitDiscardResultSchema,
    GitLogPayloadSchema,
    GitLogResultSchema,
    GitOperationPayloadSchema,
    GitProgressEventSchema,
    GitRefsResultSchema,
    GitReposPayloadSchema,
    GitReposResultSchema,
    GitResolveAiPayloadSchema,
    GitResolveAiResultSchema,
    GitResolvePayloadSchema,
    GitResolveResultSchema,
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
    EndpointClosedLidRulePayloadSchema,
    EndpointInfoSchema,
    EndpointLeaveAccountResultSchema,
    EndpointSetIdentityPayloadSchema,
    EndpointSignRegistrationPayloadSchema,
    EndpointSignRegistrationResultSchema,
    PairingTokenResultSchema
} from './auth.ts';
import { DirectSignalPayloadSchema } from './direct.ts';
import {
    DatabaseAgentAccessChangedEventSchema,
    DatabaseAgentAccessMapSchema,
    DatabaseAgentAccessSetPayloadSchema,
    DatabaseConnectionsChangedEventSchema,
    DatabaseConnectionsPayloadSchema,
    DatabaseConnectionsSavePayloadSchema,
    DatabaseConnectionsSchema,
    DatabasePasswordsPayloadSchema,
    DatabaseRequestPayloadSchema,
    DatabaseRequestResultSchema
} from './database.ts';
import {
    DrawingChangedEventSchema,
    DrawingCopyPayloadSchema,
    DrawingOpenResultSchema,
    DrawingSavePayloadSchema,
    DrawingSaveResultSchema,
    DrawingTargetPayloadSchema
} from './drawing-host.ts';
import {
    DiagramChangedEventSchema,
    DiagramCopyPayloadSchema,
    DiagramOpenResultSchema,
    DiagramSavePayloadSchema,
    DiagramSaveResultSchema,
    DiagramTargetPayloadSchema
} from './diagram-host.ts';
import {
    LanguageCommandPayloadSchema,
    LanguageCommandResultSchema,
    LanguageCustomChangedEventSchema,
    LanguageCustomCheckPayloadSchema,
    LanguageCustomCheckResultSchema,
    LanguageCustomListResultSchema,
    LanguageCustomRemovePayloadSchema,
    LanguageCustomSavePayloadSchema,
    LanguageCustomSaveResultSchema,
    LanguageDiagnosticsEventSchema,
    LanguageDocumentChangePayloadSchema,
    LanguageDocumentChangeResultSchema,
    LanguageDocumentOpenPayloadSchema,
    LanguageDocumentOpenResultSchema,
    LanguageDocumentTargetPayloadSchema,
    LanguageEditAnswerPayloadSchema,
    LanguageEditEventSchema,
    LanguageInstallPayloadSchema,
    LanguageLogResultSchema,
    LanguagePreferPayloadSchema,
    LanguageProvidersEventSchema,
    LanguageRequestPayloadSchema,
    LanguageRequestResultSchema,
    LanguageRollbackPayloadSchema,
    LanguageServerStatusResultSchema,
    LanguageServerTargetPayloadSchema,
    LanguageStatusEventSchema,
    LanguageStatusPayloadSchema,
    LanguageStatusResultSchema
} from './language.ts';
import {
    OnDeviceCancelPayloadSchema,
    OnDeviceGeneratePayloadSchema,
    OnDeviceGenerateResultSchema,
    OnDeviceStatusResultSchema,
    OnDeviceTextEventSchema
} from './ondevice.ts';
import {
    LaunchListResultSchema,
    LaunchStartPayloadSchema,
    LaunchStartResultSchema,
    LaunchStatusSchema,
    LaunchStopPayloadSchema,
    LaunchesChangedEventSchema,
    LaunchesDetectResultSchema,
    LaunchesDocumentSchema,
    LaunchesSavePayloadSchema,
    LaunchesSaveResultSchema,
    LaunchesTargetPayloadSchema
} from './launches.ts';
import {
    PlanApplyPayloadSchema,
    PlanApplyResultSchema,
    PlanChangedEventSchema,
    PlanCreatedEventSchema,
    PlanListPayloadSchema,
    PlanListResultSchema,
    PlanRemovedEventSchema
} from './plan-host.ts';
import {
    ProvenanceChangedEventSchema,
    ProvenanceReadPayloadSchema,
    ProvenanceReadResultSchema,
    ProvenanceReviewPayloadSchema,
    ProvenanceReviewResultSchema
} from './provenance.ts';
import {
    ProjectChangedEventSchema,
    ProjectCloseResultSchema,
    ProjectClosingResultSchema,
    ProjectDeletePayloadSchema,
    ProjectInlineChatTargetPayloadSchema,
    ProjectListResultSchema,
    ProjectNewChatPayloadSchema,
    ProjectNewChatResultSchema,
    ProjectNewInlineChatPayloadSchema,
    ProjectNewInlineChatResultSchema,
    ProjectOpenPayloadSchema,
    ProjectOpenResultSchema,
    ProjectSaveLocalPayloadSchema,
    ProjectSavePayloadSchema,
    ProjectSaveResultSchema,
    ProjectSetIconPayloadSchema,
    ProjectSetIdentityPayloadSchema,
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
    SessionLoginPayloadSchema,
    SessionOutputEventSchema,
    SessionResizePayloadSchema,
    SessionResyncEventSchema,
    SessionSizeEventSchema,
    SessionTargetPayloadSchema,
    SessionWritePayloadSchema
} from './session.ts';
import { AgentChildrenPayloadSchema, AgentChildrenResultSchema, TaskChangedEventSchema, TaskListPayloadSchema, TaskListResultSchema } from './task.ts';
import {
    ComputerAnswerPayloadSchema,
    ComputerAnswerResultSchema,
    ComputerAppGrantsSchema,
    ComputerApprovalsSchema,
    ComputerControlPayloadSchema,
    ComputerRequestGrantPayloadSchema,
    ComputerRevokePayloadSchema,
    ComputerRevokeResultSchema,
    ComputerSetLanguagePayloadSchema,
    ComputerUseSetEnabledPayloadSchema,
    ComputerUseStatusSchema
} from './computer.ts';

export * from './agent.ts';
export * from './auth.ts';
export * from './browser.ts';
export * from './bytes.ts';
export * from './chat.ts';
export * from './chat-image.ts';
export * from './computer.ts';
export * from './context.ts';
export * from './direct.ts';
export * from './direct-liveness.ts';
export * from './device.ts';
export * from './context-sources.ts';
export * from './database.ts';
export * from './diagram-host.ts';
export * from './drawing-host.ts';
export * from './envelope.ts';
export * from './font.ts';
export * from './fs.ts';
export * from './git.ts';
export * from './ids.ts';
export * from './language.ts';
export * from './ondevice.ts';
export * from './launches.ts';
export * from './live-stream.ts';
export * from './lan-door.ts';
export * from './machine-http.ts';
export * from './machine-update.ts';
export * from './model.ts';
export * from './node-defaults.ts';
export * from './plan-host.ts';
export * from './processes.ts';
export * from './provenance.ts';
export * from './project.ts';
export * from './project-flags.ts';
export * from './project-sidebar.ts';
export * from './project-migrate.ts';
export * from './project-split.ts';
export * from './protocol.ts';
export * from './provider-accounts.ts';
export * from './project-views.ts';
export * from './server.ts';
export * from './session.ts';
export * from './session-ports.ts';
export * from './render.ts';
export * from './push.ts';
export * from './snooze.ts';
export * from './language-patterns.ts';
export * from './stored-path.ts';
export * from './sql-binding.ts';
export * from './task.ts';
export * from './text.ts';
export * from './usage.ts';
export * from './visual.ts';
export * from './voice-languages.ts';

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
    'push.preferences': { payload: EmptySchema, result: PushPreferencesResultSchema },
    'snooze.list': { payload: EmptySchema, result: SnoozeListSchema },
    // Setting a moment already past ends the snooze, as clearing it does.
    'snooze.set': { payload: SnoozeSetPayloadSchema, result: EmptySchema },
    'snooze.clear': { payload: SnoozeClearPayloadSchema, result: EmptySchema },
    'session.attach': { payload: SessionAttachPayloadSchema, result: SessionAttachResultSchema },
    'session.detach': { payload: SessionTargetPayloadSchema, result: EmptySchema },
    'session.preparePreview': { payload: TerminalPreparePreviewPayloadSchema, result: TerminalPreparePreviewResultSchema },
    'session.prepare': { payload: TerminalPreparePayloadSchema, result: TerminalPrepareResultSchema },
    'session.write': { payload: SessionWritePayloadSchema, result: EmptySchema },
    'session.resize': { payload: SessionResizePayloadSchema, result: EmptySchema },
    'session.kill': { payload: SessionTargetPayloadSchema, result: EmptySchema },
    'session.clear': { payload: SessionTargetPayloadSchema, result: EmptySchema },
    'session.list': { payload: EmptySchema, result: SessionListResultSchema },
    'session.ports': { payload: SessionTargetPayloadSchema, result: SessionPortsResultSchema },
    'session.verifyPort': { payload: SessionPortVerifyPayloadSchema, result: SessionPortVerifyResultSchema },
    // A person approving the command the session holds: it is written down and typed. Nothing held is no error.
    'session.runHeld': { payload: SessionTargetPayloadSchema, result: EmptySchema },
    // Ends once the client that asked leaves; `login-unavailable` for a CLI without a login of its own.
    'session.login': { payload: SessionLoginPayloadSchema, result: SessionInfoSchema },
    'browser.open': { payload: BrowserOpenPayloadSchema, result: BrowserInfoSchema },
    'browser.detach': { payload: BrowserTargetPayloadSchema, result: EmptySchema },
    'browser.kill': { payload: BrowserTargetPayloadSchema, result: EmptySchema },
    'browser.navigate': { payload: BrowserNavigatePayloadSchema, result: BrowserInfoSchema },
    'browser.command': { payload: BrowserCommandPayloadSchema, result: BrowserInfoSchema },
    'browser.resize': { payload: BrowserResizePayloadSchema, result: EmptySchema },
    'browser.input': { payload: BrowserInputPayloadSchema, result: EmptySchema },
    'browser.devServers': { payload: BrowserDevServersPayloadSchema, result: BrowserDevServersResultSchema },
    'browser.hold': { payload: BrowserHoldPayloadSchema, result: EmptySchema },
    'browser.release': { payload: BrowserTargetPayloadSchema, result: EmptySchema },
    'browser.driveResult': { payload: BrowserDriveResultPayloadSchema, result: EmptySchema },
    'device.list': { payload: EmptySchema, result: DeviceListResultSchema },
    'device.boot': { payload: DeviceTargetPayloadSchema, result: DeviceInfoSchema },
    'device.shutdown': { payload: DeviceTargetPayloadSchema, result: DeviceInfoSchema },
    'device.open': { payload: DeviceOpenPayloadSchema, result: DeviceOpenResultSchema },
    'device.detach': { payload: DeviceTargetPayloadSchema, result: EmptySchema },
    'device.input': { payload: DeviceInputPayloadSchema, result: EmptySchema },
    'device.detail': { payload: DeviceDetailPayloadSchema, result: DeviceDetailSchema },
    'device.action': { payload: DeviceActionPayloadSchema, result: DeviceDetailSchema },
    'device.operations': { payload: EmptySchema, result: DeviceOperationsResultSchema },
    'device.control': { payload: DeviceControlPayloadSchema, result: DeviceOperatedSchema },
    'agent.resume': { payload: AgentResumePayloadSchema, result: EmptySchema },
    'agent.answerApproval': { payload: ApprovalAnswerPayloadSchema, result: ApprovalAnswerResultSchema },
    'agent.setApprovals': { payload: ApprovalPreferencePayloadSchema, result: EmptySchema },
    'chat.create': AGENT_REQUEST_SCHEMAS['chat.create'],
    'chat.history': AGENT_REQUEST_SCHEMAS['chat.history'],
    'chat.attach': AGENT_REQUEST_SCHEMAS['chat.attach'],
    'chat.detach': AGENT_REQUEST_SCHEMAS['chat.detach'],
    'chat.send': AGENT_REQUEST_SCHEMAS['chat.send'],
    'chat.uiChoice': AGENT_REQUEST_SCHEMAS['chat.uiChoice'],
    'chat.unqueue': AGENT_REQUEST_SCHEMAS['chat.unqueue'],
    'chat.sendNow': AGENT_REQUEST_SCHEMAS['chat.sendNow'],
    'chat.cancel': AGENT_REQUEST_SCHEMAS['chat.cancel'],
    'chat.approve': AGENT_REQUEST_SCHEMAS['chat.approve'],
    'chat.answer': AGENT_REQUEST_SCHEMAS['chat.answer'],
    'chat.dismiss': AGENT_REQUEST_SCHEMAS['chat.dismiss'],
    'chat.configure': AGENT_REQUEST_SCHEMAS['chat.configure'],
    'chat.setPreferences': AGENT_REQUEST_SCHEMAS['chat.setPreferences'],
    'chat.compact': AGENT_REQUEST_SCHEMAS['chat.compact'],
    'chat.clear': AGENT_REQUEST_SCHEMAS['chat.clear'],
    'chat.turnDiff': AGENT_REQUEST_SCHEMAS['chat.turnDiff'],
    'chat.fork': AGENT_REQUEST_SCHEMAS['chat.fork'],
    'chat.continueOn': AGENT_REQUEST_SCHEMAS['chat.continueOn'],
    'chat.forkInfo': AGENT_REQUEST_SCHEMAS['chat.forkInfo'],
    'chat.summarize': AGENT_REQUEST_SCHEMAS['chat.summarize'],
    'chat.subagent': AGENT_REQUEST_SCHEMAS['chat.subagent'],
    'chat.stopSubagent': AGENT_REQUEST_SCHEMAS['chat.stopSubagent'],
    'chat.stopTask': AGENT_REQUEST_SCHEMAS['chat.stopTask'],
    'chat.addBookmark': AGENT_REQUEST_SCHEMAS['chat.addBookmark'],
    'chat.renameBookmark': AGENT_REQUEST_SCHEMAS['chat.renameBookmark'],
    'chat.removeBookmark': AGENT_REQUEST_SCHEMAS['chat.removeBookmark'],
    'chat.removeVisual': AGENT_REQUEST_SCHEMAS['chat.removeVisual'],
    'chat.imageTarget': { payload: ChatImageTargetPayloadSchema, result: ChatImageTargetResultSchema },
    'chat.saveImage': { payload: ChatImageSavePayloadSchema, result: ChatImageSaveResultSchema },
    'skills.list': AGENT_REQUEST_SCHEMAS['skills.list'],
    'provider.list': AGENT_REQUEST_SCHEMAS['provider.list'],
    'accounts.list': AGENT_REQUEST_SCHEMAS['accounts.list'],
    'accounts.save': AGENT_REQUEST_SCHEMAS['accounts.save'],
    'accounts.refresh': AGENT_REQUEST_SCHEMAS['accounts.refresh'],
    'accounts.create': AGENT_REQUEST_SCHEMAS['accounts.create'],
    'accounts.watchLogin': AGENT_REQUEST_SCHEMAS['accounts.watchLogin'],
    'project.sidebar': { payload: EmptySchema, result: ProjectSidebarResultSchema },
    'project.list': { payload: EmptySchema, result: ProjectListResultSchema },
    'project.open': { payload: ProjectOpenPayloadSchema, result: ProjectOpenResultSchema },
    'project.save': { payload: ProjectSavePayloadSchema, result: ProjectSaveResultSchema },
    'project.save-local': { payload: ProjectSaveLocalPayloadSchema, result: EmptySchema },
    'project.close': { payload: ProjectTargetPayloadSchema, result: ProjectCloseResultSchema },
    'project.closing': { payload: ProjectTargetPayloadSchema, result: ProjectClosingResultSchema },
    'project.release': { payload: ProjectTargetPayloadSchema, result: EmptySchema },
    'project.setIcon': { payload: ProjectSetIconPayloadSchema, result: ProjectSummaryResultSchema },
    'project.setIdentity': { payload: ProjectSetIdentityPayloadSchema, result: ProjectSummaryResultSchema },
    'project.delete': { payload: ProjectDeletePayloadSchema, result: EmptySchema },
    'project.newChat': { payload: ProjectNewChatPayloadSchema, result: ProjectNewChatResultSchema },
    'project.newInlineChat': { payload: ProjectNewInlineChatPayloadSchema, result: ProjectNewInlineChatResultSchema },
    'project.showInlineChat': { payload: ProjectInlineChatTargetPayloadSchema, result: EmptySchema },
    'project.removeInlineChat': { payload: ProjectInlineChatTargetPayloadSchema, result: EmptySchema },
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
    'language.status': { payload: LanguageStatusPayloadSchema, result: LanguageStatusResultSchema },
    // Only a person's request installs: the daemon never installs a server on its own, and no verb does.
    'language.install': { payload: LanguageInstallPayloadSchema, result: LanguageServerStatusResultSchema },
    // The machine's choice between two servers of one language; any client may switch it, since both were installed by a person.
    'language.prefer': { payload: LanguagePreferPayloadSchema, result: LanguageServerStatusResultSchema },
    // A person's step back from an update; like an install, never the daemon's own or a verb's.
    'language.rollback': { payload: LanguageRollbackPayloadSchema, result: LanguageServerStatusResultSchema },
    'language.restart': { payload: LanguageServerTargetPayloadSchema, result: LanguageServerStatusResultSchema },
    'language.log': { payload: LanguageServerTargetPayloadSchema, result: LanguageLogResultSchema },
    'language.custom.list': { payload: EmptySchema, result: LanguageCustomListResultSchema },
    // Only the local secret saves or removes a server of a person's own: starting what it names is what the save approves.
    'language.custom.save': { payload: LanguageCustomSavePayloadSchema, result: LanguageCustomSaveResultSchema },
    'language.custom.remove': { payload: LanguageCustomRemovePayloadSchema, result: EmptySchema },
    'language.custom.check': { payload: LanguageCustomCheckPayloadSchema, result: LanguageCustomCheckResultSchema },
    'language.document.open': { payload: LanguageDocumentOpenPayloadSchema, result: LanguageDocumentOpenResultSchema },
    'language.document.change': { payload: LanguageDocumentChangePayloadSchema, result: LanguageDocumentChangeResultSchema },
    'language.document.close': { payload: LanguageDocumentTargetPayloadSchema, result: EmptySchema },
    'language.request': { payload: LanguageRequestPayloadSchema, result: LanguageRequestResultSchema },
    'language.command': { payload: LanguageCommandPayloadSchema, result: LanguageCommandResultSchema },
    'language.edit.answer': { payload: LanguageEditAnswerPayloadSchema, result: EmptySchema },
    'language.sql': { payload: LanguageSqlPayloadSchema, result: LanguageSqlStateSchema },
    // A person's choice of the connection a file, or the project, reads its SQL against; kept in their private project file.
    'language.sql.bind': { payload: LanguageSqlBindPayloadSchema, result: LanguageSqlStateSchema },
    'ondevice.status': { payload: EmptySchema, result: OnDeviceStatusResultSchema },
    // The text streams to the asking client as `ondevice.text` while it runs; the result is the whole of it.
    'ondevice.generate': { payload: OnDeviceGeneratePayloadSchema, result: OnDeviceGenerateResultSchema },
    'ondevice.cancel': { payload: OnDeviceCancelPayloadSchema, result: EmptySchema },
    'launches.read': { payload: LaunchesTargetPayloadSchema, result: LaunchesDocumentSchema },
    // A person's save; it approves on this machine every launch it adds or changes.
    'launches.save': { payload: LaunchesSavePayloadSchema, result: LaunchesSaveResultSchema },
    'launches.detect': { payload: LaunchesTargetPayloadSchema, result: LaunchesDetectResultSchema },
    'launch.start': { payload: LaunchStartPayloadSchema, result: LaunchStartResultSchema },
    'launch.restart': { payload: LaunchStartPayloadSchema, result: LaunchStartResultSchema },
    'launch.stop': { payload: LaunchStopPayloadSchema, result: EmptySchema },
    'launch.list': { payload: EmptySchema, result: LaunchListResultSchema },
    'database.connections': { payload: DatabaseConnectionsPayloadSchema, result: DatabaseConnectionsSchema },
    // A person's save of the whole list; a password in it never reaches a file.
    'database.connections.save': { payload: DatabaseConnectionsSavePayloadSchema, result: DatabaseConnectionsSchema },
    // One message of `@adecore/database`'s protocol, answered with its response. Export and import only for the local secret.
    'database.request': { payload: DatabaseRequestPayloadSchema, result: DatabaseRequestResultSchema },
    'database.agentAccess': { payload: DatabaseConnectionsPayloadSchema, result: DatabaseAgentAccessMapSchema },
    // A person's choice for one connection; `write` only through the local secret.
    'database.agentAccess.set': { payload: DatabaseAgentAccessSetPayloadSchema, result: DatabaseAgentAccessMapSchema },
    // The passwords a client holds for the project's connections, kept in memory for its agents.
    'database.passwords': { payload: DatabasePasswordsPayloadSchema, result: EmptySchema },
    // Takes schema snapshots again with the passwords the clients handed over; answers once they are taken.
    'database.snapshot.refresh': { payload: DatabaseSnapshotRefreshPayloadSchema, result: EmptySchema },
    'fs.browse': { payload: FsBrowsePayloadSchema, result: FsBrowseResultSchema },
    'fs.reveal': { payload: FsRevealPayloadSchema, result: EmptySchema },
    'fs.search': { payload: FsSearchPayloadSchema, result: FsSearchResultSchema },
    'fs.grep': { payload: FsGrepPayloadSchema, result: FsGrepResultSchema },
    'fs.list': { payload: FsListPayloadSchema, result: FsListResultSchema },
    'fs.read': { payload: FsReadPayloadSchema, result: FsReadResultSchema },
    'fs.create': { payload: FsCreatePayloadSchema, result: FsCreateResultSchema },
    'fs.delete': { payload: FsDeletePayloadSchema, result: EmptySchema },
    'fs.rename': { payload: FsRenamePayloadSchema, result: FsRenameResultSchema },
    'fs.write': { payload: FsWritePayloadSchema, result: FsWriteResultSchema },
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
    'git.blame': { payload: GitBlamePayloadSchema, result: GitBlameResultSchema },
    'git.stage': { payload: GitStagePayloadSchema, result: EmptySchema },
    'git.discard': { payload: GitDiscardPayloadSchema, result: GitDiscardResultSchema },
    'git.refs': { payload: GitCwdPayloadSchema, result: GitRefsResultSchema },
    'git.repos': { payload: GitReposPayloadSchema, result: GitReposResultSchema },
    'git.log': { payload: GitLogPayloadSchema, result: GitLogResultSchema },
    'git.action': { payload: GitActionPayloadSchema, result: GitActionResultSchema },
    'git.cancel': { payload: GitCancelPayloadSchema, result: EmptySchema },
    'git.conflicts': { payload: GitCwdPayloadSchema, result: GitConflictsResultSchema },
    'git.conflict': { payload: GitConflictPayloadSchema, result: GitConflictResultSchema },
    'git.resolve': { payload: GitResolvePayloadSchema, result: GitResolveResultSchema },
    'git.resolveAi': { payload: GitResolveAiPayloadSchema, result: GitResolveAiResultSchema },
    'git.operation': { payload: GitOperationPayloadSchema, result: GitActionResultSchema },
    'git.capabilities': { payload: GitCwdPayloadSchema, result: GitCapabilitiesResultSchema },
    'git.suggestMessage': { payload: GitSuggestMessagePayloadSchema, result: GitSuggestMessageResultSchema },
    'usage.summary': AGENT_REQUEST_SCHEMAS['usage.summary'],
    'usage.subscribe': AGENT_REQUEST_SCHEMAS['usage.subscribe'],
    'usage.unsubscribe': AGENT_REQUEST_SCHEMAS['usage.unsubscribe'],
    'usage.limits': AGENT_REQUEST_SCHEMAS['usage.limits'],
    'usage.refreshLimits': AGENT_REQUEST_SCHEMAS['usage.refreshLimits'],
    'processes.subscribe': { payload: ProcessesSubscribePayloadSchema, result: ProcessesSubscribeResultSchema },
    'processes.unsubscribe': { payload: EmptySchema, result: EmptySchema },
    'processes.signal': { payload: ProcessesSignalPayloadSchema, result: EmptySchema },
    'processes.listAlerts': { payload: EmptySchema, result: ProcessesAlertsSchema },
    'processes.dismiss': { payload: ProcessesDismissPayloadSchema, result: EmptySchema },
    'computer.status': { payload: EmptySchema, result: ComputerUseStatusSchema },
    'computer.setEnabled': { payload: ComputerUseSetEnabledPayloadSchema, result: ComputerUseStatusSchema },
    'computer.approvals': { payload: EmptySchema, result: ComputerApprovalsSchema },
    'computer.answer': { payload: ComputerAnswerPayloadSchema, result: ComputerAnswerResultSchema },
    // Quits the helper and starts it again, which is when macOS applies a Screen Recording grant.
    'computer.restart': { payload: EmptySchema, result: ComputerUseStatusSchema },
    'computer.control': { payload: ComputerControlPayloadSchema, result: ComputerUseStatusSchema },
    'computer.requestGrant': { payload: ComputerRequestGrantPayloadSchema, result: ComputerUseStatusSchema },
    'computer.setLanguage': { payload: ComputerSetLanguagePayloadSchema, result: EmptySchema },
    'computer.grants': { payload: EmptySchema, result: ComputerAppGrantsSchema },
    'computer.revoke': { payload: ComputerRevokePayloadSchema, result: ComputerRevokeResultSchema },
    'endpoint.info': { payload: EmptySchema, result: EndpointInfoSchema },
    'endpoint.setIdentity': { payload: EndpointSetIdentityPayloadSchema, result: EndpointInfoSchema },
    'endpoint.closedLidRule': { payload: EndpointClosedLidRulePayloadSchema, result: EndpointInfoSchema },
    'endpoint.signRegistration': { payload: EndpointSignRegistrationPayloadSchema, result: EndpointSignRegistrationResultSchema },
    'endpoint.leaveAccount': { payload: EmptySchema, result: EndpointLeaveAccountResultSchema },
    // The desktop app on this machine saying where its updater stands. Local secret only: it speaks for the machine.
    'endpoint.reportUpdate': { payload: MachineUpdateReportSchema, result: EmptySchema },
    // Any client may ask, `update-no-app` without the desktop app and `update-none` with nothing to install.
    'endpoint.installUpdate': { payload: EndpointInstallUpdatePayloadSchema, result: EndpointInstallUpdateResultSchema },
    'auth.sessions': { payload: EmptySchema, result: AuthSessionsResultSchema },
    'auth.revoke': { payload: AuthRevokePayloadSchema, result: EmptySchema },
    'auth.pairingToken': { payload: EmptySchema, result: PairingTokenResultSchema },
    'auth.registerKey': { payload: AuthRegisterKeyPayloadSchema, result: AuthRegisterKeyResultSchema },
    'direct.signal': { payload: DirectSignalPayloadSchema, result: EmptySchema },
    'chat.kill': AGENT_REQUEST_SCHEMAS['chat.kill'],
    'chat.list': AGENT_REQUEST_SCHEMAS['chat.list'],
    'task.list': { payload: TaskListPayloadSchema, result: TaskListResultSchema },
    'agent.children': { payload: AgentChildrenPayloadSchema, result: AgentChildrenResultSchema },
    'plan.list': { payload: PlanListPayloadSchema, result: PlanListResultSchema },
    'plan.apply': { payload: PlanApplyPayloadSchema, result: PlanApplyResultSchema },
    'provenance.read': { payload: ProvenanceReadPayloadSchema, result: ProvenanceReadResultSchema },
    'provenance.review': { payload: ProvenanceReviewPayloadSchema, result: ProvenanceReviewResultSchema }
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
    // Every snooze the machine holds, to every client, whenever one is set, cleared or ends.
    'snooze.changed': SnoozeListSchema,
    'push.notification': z.object({
        projectId: z.string().min(1),
        viewId: z.string().min(1),
        nodeId: z.string().min(1),
        title: z.string().max(160),
        body: z.string().max(500)
    }),
    'session.output': SessionOutputEventSchema,
    'session.resync': SessionResyncEventSchema,
    'session.size': SessionSizeEventSchema,
    'session.exit': SessionExitEventSchema,
    'session.status': SessionStatusEventSchema,
    'session.approvals': SessionApprovalsEventSchema,
    'session.list-changed': EmptySchema,
    'browser.frame': BrowserFrameSchema,
    'browser.status': BrowserInfoSchema,
    'browser.drive': BrowserDriveEventSchema,
    'device.frame': DeviceFrameSchema,
    'device.operated': DeviceOperatedSchema,
    'chat.event': AGENT_EVENT_SCHEMAS['chat.event'],
    'chat.status': AGENT_EVENT_SCHEMAS['chat.status'],
    'chat.subagentChanged': AGENT_EVENT_SCHEMAS['chat.subagentChanged'],
    'chat.bookmarks': AGENT_EVENT_SCHEMAS['chat.bookmarks'],
    'chat.visuals': AGENT_EVENT_SCHEMAS['chat.visuals'],
    'endpoint.changed': EndpointChangedEventSchema,
    'endpoint.updateChanged': EndpointUpdateChangedEventSchema,
    // To the desktop app on this machine only: a person asked another client to install the update.
    'endpoint.updateInstall': EmptySchema,
    'direct.signaled': DirectSignalPayloadSchema,
    'project.changed': ProjectChangedEventSchema,
    'project.showView': ProjectShowViewEventSchema,
    'project.summary': ProjectSummaryEventSchema,
    'drawing.changed': DrawingChangedEventSchema,
    'diagram.changed': DiagramChangedEventSchema,
    'language.diagnostics': LanguageDiagnosticsEventSchema,
    'language.status': LanguageStatusEventSchema,
    'language.custom.changed': LanguageCustomChangedEventSchema,
    'language.providers': LanguageProvidersEventSchema,
    'language.edit': LanguageEditEventSchema,
    'language.sql.changed': LanguageSqlChangedEventSchema,
    'ondevice.text': OnDeviceTextEventSchema,
    'launch.status': LaunchStatusSchema,
    'launches.changed': LaunchesChangedEventSchema,
    // To every client that holds the project, except the one whose save it answers.
    'database.connections.changed': DatabaseConnectionsChangedEventSchema,
    // To every client that holds the project, except the one that set it.
    'database.agentAccess.changed': DatabaseAgentAccessChangedEventSchema,
    'fs.changed': FsChangedEventSchema,
    'git.status': GitStatusEventSchema,
    'git.changed': GitChangedEventSchema,
    'git.progress': GitProgressEventSchema,
    'git.worktrees': GitWorktreesEventSchema,
    'usage.changed': AGENT_EVENT_SCHEMAS['usage.changed'],
    'usage.limitsChanged': AGENT_EVENT_SCHEMAS['usage.limitsChanged'],
    'accounts.changed': AGENT_EVENT_SCHEMAS['accounts.changed'],
    'processes.sample': ProcessesSampleEventSchema,
    'processes.alerts': ProcessesAlertsSchema,
    'computer.status': ComputerUseStatusSchema,
    'computer.approvals': ComputerApprovalsSchema,
    'computer.grants': ComputerAppGrantsSchema,
    'task.changed': TaskChangedEventSchema,
    'plan.changed': PlanChangedEventSchema,
    'plan.removed': PlanRemovedEventSchema,
    'plan.created': PlanCreatedEventSchema,
    'provenance.changed': ProvenanceChangedEventSchema
} as const satisfies Record<string, z.ZodType>;

export type EventType = keyof typeof EVENT_SCHEMAS;

export type EventMap = {
    [E in EventType]: z.infer<(typeof EVENT_SCHEMAS)[E]>;
};

export function isRequestType(type: string): type is RequestType {
    return Object.hasOwn(REQUEST_SCHEMAS, type);
}

export function isEventType(event: string): event is EventType {
    return Object.hasOwn(EVENT_SCHEMAS, event);
}
export * from './apple-foundation.ts';

export { FileLocationSchema, type FileLocation } from './file-location.ts';

export { TerminalCwdSnapshotSchema, TERMINAL_CWD_OSC, trackTerminalCwd, terminalCwdScreenSize, type CwdTerminal, type TerminalCwd } from './terminal-cwd.ts';
