import {
    TerminalPreparePreviewPayloadSchema,
    TerminalPreparePreviewResultSchema,
    TerminalPreparePayloadSchema,
    TerminalPrepareResultSchema
} from './terminal-prepare.ts';
import { AgentIntegrationSetPayloadSchema, AgentIntegrationSetResultSchema, AgentIntegrationsResultSchema } from './agent-integrations.ts';
import {
    ArtifactChangedEventSchema,
    ArtifactCleanupPayloadSchema,
    ArtifactCleanupResultSchema,
    ArtifactCopyToProjectPayloadSchema,
    ArtifactCopyToProjectResultSchema,
    ArtifactGetPayloadSchema,
    ArtifactGetResultSchema,
    ArtifactImportFromPayloadSchema,
    ArtifactImportFromResultSchema,
    ArtifactListPayloadSchema,
    ArtifactListResultSchema,
    ArtifactRemovePayloadSchema,
    ArtifactRemoveResultSchema,
    ArtifactSaveFolderPayloadSchema,
    ArtifactSavePayloadSchema,
    ArtifactSaveResultSchema,
    ArtifactStorageResultSchema
} from './artifact.ts';
import {
    RoutineApprovePayloadSchema,
    RoutineChangedEventSchema,
    RoutineGetResultSchema,
    RoutineListPayloadSchema,
    RoutineListResultSchema,
    RoutineRemovePayloadSchema,
    RoutineRunNowResultSchema,
    RoutineSavePayloadSchema,
    RoutineSaveResultSchema,
    RoutineSkillsPayloadSchema,
    RoutineSkillsResultSchema,
    RoutineTargetPayloadSchema
} from './routine.ts';
import {
    TemplateChangedEventSchema,
    TemplateConfigurePayloadSchema,
    TemplateConfigureResultSchema,
    TemplateListPayloadSchema,
    TemplateListResultSchema,
    TemplateRemovePayloadSchema,
    TemplateRemoveResultSchema,
    TemplateSavePayloadSchema,
    TemplateSaveResultSchema
} from './templates.ts';
import {
    CliUpdatePayloadSchema,
    CliUpdateResultSchema,
    CliVersionsPayloadSchema,
    CliVersionsResultSchema,
    RegistryAgentPayloadSchema,
    RegistryAgentResultSchema,
    RegistryCatalogPayloadSchema,
    RegistryCatalogResultSchema
} from './agent-registry.ts';
import { AgentServerPayloadSchema, AgentServerResultSchema } from './agent-server.ts';
import { AGENT_EVENT_SCHEMAS, AGENT_REQUEST_SCHEMAS, EmptySchema } from '@adecore/agent-contracts/protocol';
import {
    ChatExternalPayloadSchema,
    ChatExternalResultSchema,
    ChatSearchCancelPayloadSchema,
    ChatSearchPayloadSchema,
    ChatSearchResultSchema
} from './chat-search.ts';
import { ChatHandoffPayloadSchema, ChatHandoffResultSchema } from './chat-handoff.ts';
import {
    ChatMoveInfoPayloadSchema,
    ChatMoveInfoResultSchema,
    ChatMovePayloadSchema,
    ChatMoveResultSchema,
    ProjectProposalDeclinePayloadSchema,
    ProjectProposalDeclineResultSchema,
    ProjectProposalsSchema
} from './chat-move.ts';
import { ChatImageTargetPayloadSchema, ChatImageTargetResultSchema, ChatImageSavePayloadSchema, ChatImageSaveResultSchema } from './chat-image.ts';
import { ProjectSidebarResultSchema, ProjectSummaryEventSchema } from './project-sidebar.ts';
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
    DeviceCaptureResultSchema,
    DeviceImportCapturePayloadSchema,
    DeviceClipboardPayloadSchema,
    DeviceClipboardResultSchema,
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
    DevicePowerResultSchema,
    DeviceRecordPayloadSchema,
    DeviceRecordResultSchema,
    DeviceTargetPayloadSchema
} from './device.ts';
import {
    PushSubscribePayloadSchema,
    PushUnsubscribePayloadSchema,
    PushPreferencesResultSchema,
    PushAttentionResultSchema,
    PushReadPayloadSchema,
    PushAttentionEntrySchema,
    PresenceReportPayloadSchema
} from './push.ts';
import { RenderSceneResultSchema } from './render.ts';
import {
    PeerArtifactGetPayloadSchema,
    PeerArtifactListPayloadSchema,
    PeerArtifactReadPayloadSchema,
    PeerArtifactReadResultSchema,
    PeerBindPayloadSchema,
    PeerBundlePutPayloadSchema,
    PeerBundlePutResultSchema,
    PeerBundleReadPayloadSchema,
    PeerBundleReadResultSchema,
    PeerClosePayloadSchema,
    PeerLinkSchema,
    PeerListResultSchema,
    PeerPlaceNodesPayloadSchema,
    PeerResultPayloadSchema,
    PeerResultResultSchema,
    PeerSetCeilingPayloadSchema,
    PeerTaskSettledEventSchema,
    PeerTaskStartPayloadSchema,
    PeerTaskStartResultSchema,
    PeerTaskStopPayloadSchema,
    PeerUnbindPayloadSchema
} from './peer.ts';
import {
    RemoteConnectPayloadSchema,
    RemoteLinkPayloadSchema,
    RemoteLinkSchema,
    RemoteListPayloadSchema,
    RemoteListResultSchema,
    RemoteStatusEventSchema,
    RemoteUnlinkPayloadSchema
} from './remote.ts';
import { SnoozeClearPayloadSchema, SnoozeListSchema, SnoozeSetPayloadSchema } from './snooze.ts';
import {
    EndpointInstallUpdatePayloadSchema,
    EndpointInstallUpdateResultSchema,
    EndpointUpdateChangedEventSchema,
    MachineUpdateReportSchema
} from './machine-update.ts';
import { ArchiveExtractPayloadSchema, ArchiveExtractResultSchema, ArchiveListPayloadSchema, ArchiveListResultSchema } from './archive.ts';
import { BytesReadPayloadSchema, BytesReadResultSchema } from './bytes.ts';
import {
    DatabaseSnapshotRefreshPayloadSchema,
    LanguageSqlBindPayloadSchema,
    LanguageSqlChangedEventSchema,
    LanguageSqlPayloadSchema,
    LanguageSqlStateSchema
} from './sql-binding.ts';
import { AgentResumePayloadSchema, SessionStatusEventSchema } from './agent.ts';
import {
    FsBrowsePayloadSchema,
    FsBrowseResultSchema,
    FsChangedEventSchema,
    FsCreatePayloadSchema,
    FsCreateResultSchema,
    FsDeletePayloadSchema,
    FsDeleteResultSchema,
    FsGrepPayloadSchema,
    FsGrepResultSchema,
    FsListPayloadSchema,
    FsListResultSchema,
    FsLocatePayloadSchema,
    FsLocateResultSchema,
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
    GitClonePayloadSchema,
    GitCloneResultSchema,
    GitIgnoredFilesPayloadSchema,
    GitIgnoredFilesResultSchema,
    GitBlamePayloadSchema,
    GitBlameResultSchema,
    GitIdentityPayloadSchema,
    GitIdentityResultSchema,
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
    GitAuthorsResultSchema,
    GitOperationPayloadSchema,
    GitProgressEventSchema,
    GitIssuePayloadSchema,
    GitPullRequestPayloadSchema,
    GitPrSplitPayloadSchema,
    GitPrSplitResultSchema,
    GitPrUnwatchPayloadSchema,
    GitPrWatchesEventSchema,
    GitPrWatchesPayloadSchema,
    GitPrWatchesResultSchema,
    GitPrWatchPayloadSchema,
    GitPrWatchResultSchema,
    GitPullRequestResultSchema,
    GitIssueSchema,
    GitRefCommitPayloadSchema,
    GitRefCommitResultSchema,
    GitRefsResultSchema,
    GitBundlePayloadSchema,
    GitBundlePutPayloadSchema,
    GitBundlePutResultSchema,
    GitBundleResultSchema,
    GitFetchBundlePayloadSchema,
    GitFetchBundleResultSchema,
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
    GitWatchPayloadSchema,
    GitWatchResultSchema,
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
    AuthRevokePayloadSchema,
    AuthSessionsResultSchema,
    EndpointChangedEventSchema,
    EndpointClosedLidRulePayloadSchema,
    EndpointInfoPayloadSchema,
    EndpointInfoSchema,
    EndpointLeaveAccountResultSchema,
    EndpointSetIdentityPayloadSchema,
    EndpointSetNodeSizePayloadSchema,
    EndpointSettingsSchema,
    EndpointSignPeerAccessPayloadSchema,
    EndpointSignPeerAccessResultSchema,
    EndpointSignRegistrationPayloadSchema,
    EndpointSignRegistrationResultSchema,
    UsageCountPayloadSchema,
    UsageStartupPayloadSchema,
    UsageTimingPayloadSchema
} from './auth.ts';
import { DirectSignalPayloadSchema } from './direct.ts';
import { EndpointReachPayloadSchema, EndpointReachResultSchema } from './reach.ts';
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
    LanguageMessageAnswerPayloadSchema,
    LanguageMessageClosedEventSchema,
    LanguageMessageEventSchema,
    LanguagePreferPayloadSchema,
    LanguageProvidersEventSchema,
    LanguageRequestPayloadSchema,
    LanguageRequestResultSchema,
    LanguageRollbackPayloadSchema,
    LanguageServerStatusResultSchema,
    LanguageServerTargetPayloadSchema,
    LanguageShowEventSchema,
    LanguageStatusEventSchema,
    LanguageStatusPayloadSchema,
    LanguageStatusResultSchema,
    LanguageTracePayloadSchema,
    LanguageWillSavePayloadSchema,
    LanguageWorkspaceProblemsPayloadSchema,
    LanguageWorkspaceProblemsResultSchema
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
    LaunchesAfterSettlePayloadSchema,
    LaunchesChangedEventSchema,
    LaunchesDetectResultSchema,
    LaunchesDetectPayloadSchema,
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
    ProjectSetAccountsPayloadSchema,
    ProjectSetAccountsResultSchema,
    ProjectShowViewEventSchema,
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
    ComputerRequestGrantResultSchema,
    ComputerRevokePayloadSchema,
    ComputerRevokeResultSchema,
    ComputerSetLanguagePayloadSchema,
    ComputerUseSetEnabledPayloadSchema,
    ComputerUseStatusSchema
} from './computer.ts';
import { ClaudeApiConfigurePayloadSchema, ClaudeApiStatusSchema } from './claude-api.ts';
import { NanoGptConfigurePayloadSchema, NanoGptStatusSchema } from './nanogpt.ts';
import { SecretAnswerResultSchema, SecretDeclinePayloadSchema, SecretRequestsSchema, SecretSavePayloadSchema } from './secrets.ts';
import {
    VoiceActivityEventSchema,
    VoiceConfirmPayloadSchema,
    VoiceConfirmResultSchema,
    VoiceKeyStatusSchema,
    VoicePreferencesSchema,
    VoicePreferencesStateSchema,
    VoiceSetKeyPayloadSchema,
    VoiceStartPayloadSchema,
    VoiceStartResultSchema,
    VoiceStatusEventSchema,
    VoiceStopPayloadSchema,
    VoiceStopResultSchema
} from './voice.ts';

export * from './agent.ts';
export * from './agent-integrations.ts';
export * from './agent-registry.ts';
export * from './artifact.ts';
export * from './routine.ts';
export * from './routine-schedule.ts';
export * from './routine-cron.ts';
export * from './agent-server.ts';
export * from './apple-foundation.ts';
export * from './archive.ts';
export * from './auth.ts';
export * from './browser.ts';
export * from './bytes.ts';
export * from './chat.ts';
export * from './chat-image.ts';
export * from './chat-handoff.ts';
export * from './chat-move.ts';
export * from './chat-search.ts';
export * from './claude-api.ts';
export * from './computer.ts';
export * from './context.ts';
export * from './direct.ts';
export * from './direct-liveness.ts';
export * from './device.ts';
export * from './change-split.ts';
export * from './context-sources.ts';
export * from './database.ts';
export * from './diagram-host.ts';
export * from './drawing-host.ts';
export * from './envelope.ts';
export * from './fs.ts';
export * from './git.ts';
export * from './ids.ts';
export * from './language.ts';
export * from './ondevice.ts';
export * from './launches.ts';
export * from './secrets.ts';
export * from './live-stream.ts';
export * from './live-frame.ts';
export * from './lan-door.ts';
export * from './machine-http.ts';
export * from './machine-update.ts';
export * from './model.ts';
export * from './nanogpt.ts';
export * from './node-defaults.ts';
export { emptyCanvasGroupIds } from './canvas-groups.ts';
export * from './plan-host.ts';
export * from './processes.ts';
export * from './provenance.ts';
export * from './reach.ts';
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
export * from './peer.ts';
export * from './remote.ts';
export * from './snooze.ts';
export * from './language-patterns.ts';
export * from './stored-path.ts';
export * from './sql-binding.ts';
export * from './task.ts';
export * from './built-in-templates.ts';
export * from './templates.ts';
export * from './terminal-prepare.ts';
export * from './text.ts';
export * from './usage.ts';
export * from './visual.ts';
export * from './voice.ts';
export * from './voice-languages.ts';
export { FileLocationSchema, type FileLocation } from './file-location.ts';
export {
    TerminalCwdSnapshotSchema,
    TERMINAL_CWD_OSC,
    trackTerminalCwd,
    terminalCwdScreenSize,
    windowsPathOfMsys,
    type CwdTerminal,
    type TerminalCwd
} from './terminal-cwd.ts';

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
    'presence.report': { payload: PresenceReportPayloadSchema, result: EmptySchema },
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
    'peer.artifactRead': { payload: PeerArtifactReadPayloadSchema, result: PeerArtifactReadResultSchema },
    'remote.list': { payload: RemoteListPayloadSchema, result: RemoteListResultSchema },
    'remote.link': { payload: RemoteLinkPayloadSchema, result: RemoteLinkSchema },
    'remote.connect': { payload: RemoteConnectPayloadSchema, result: EmptySchema },
    'remote.unlink': { payload: RemoteUnlinkPayloadSchema, result: EmptySchema },
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
    'device.capture': { payload: DeviceTargetPayloadSchema, result: DeviceCaptureResultSchema },
    'device.importCapture': { payload: DeviceImportCapturePayloadSchema, result: DeviceCaptureResultSchema },
    'device.record': { payload: DeviceRecordPayloadSchema, result: DeviceRecordResultSchema },
    'device.clipboard': { payload: DeviceClipboardPayloadSchema, result: DeviceClipboardResultSchema },
    'device.power': { payload: DeviceTargetPayloadSchema, result: DevicePowerResultSchema },
    'agent.resume': { payload: AgentResumePayloadSchema, result: EmptySchema },
    'chat.create': AGENT_REQUEST_SCHEMAS['chat.create'],
    'chat.history': AGENT_REQUEST_SCHEMAS['chat.history'],
    'chat.attach': AGENT_REQUEST_SCHEMAS['chat.attach'],
    'chat.detach': AGENT_REQUEST_SCHEMAS['chat.detach'],
    'chat.send': AGENT_REQUEST_SCHEMAS['chat.send'],
    'chat.uiChoice': AGENT_REQUEST_SCHEMAS['chat.uiChoice'],
    'ui.query': AGENT_REQUEST_SCHEMAS['ui.query'],
    'ui.link': AGENT_REQUEST_SCHEMAS['ui.link'],
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
    'chat.toolOutput': AGENT_REQUEST_SCHEMAS['chat.toolOutput'],
    'chat.fork': AGENT_REQUEST_SCHEMAS['chat.fork'],
    'chat.continueOn': AGENT_REQUEST_SCHEMAS['chat.continueOn'],
    'chat.forkInfo': AGENT_REQUEST_SCHEMAS['chat.forkInfo'],
    'chat.summarize': AGENT_REQUEST_SCHEMAS['chat.summarize'],
    'chat.subagent': AGENT_REQUEST_SCHEMAS['chat.subagent'],
    'chat.stopSubagent': AGENT_REQUEST_SCHEMAS['chat.stopSubagent'],
    'chat.stopTask': AGENT_REQUEST_SCHEMAS['chat.stopTask'],
    'chat.goal': AGENT_REQUEST_SCHEMAS['chat.goal'],
    'chat.addBookmark': AGENT_REQUEST_SCHEMAS['chat.addBookmark'],
    'chat.renameBookmark': AGENT_REQUEST_SCHEMAS['chat.renameBookmark'],
    'chat.removeBookmark': AGENT_REQUEST_SCHEMAS['chat.removeBookmark'],
    'chat.removeVisual': AGENT_REQUEST_SCHEMAS['chat.removeVisual'],
    'chat.imageTarget': { payload: ChatImageTargetPayloadSchema, result: ChatImageTargetResultSchema },
    'chat.saveImage': { payload: ChatImageSavePayloadSchema, result: ChatImageSaveResultSchema },
    'chat.search': { payload: ChatSearchPayloadSchema, result: ChatSearchResultSchema },
    'chat.searchCancel': { payload: ChatSearchCancelPayloadSchema, result: EmptySchema },
    'chat.external': { payload: ChatExternalPayloadSchema, result: ChatExternalResultSchema },
    // Errors: `move-refused`, `files-conflict` and `move-failed`; each leaves the chat where it was.
    'chat.handoff': { payload: ChatHandoffPayloadSchema, result: ChatHandoffResultSchema },
    'chat.move': { payload: ChatMovePayloadSchema, result: ChatMoveResultSchema },
    'chat.moveInfo': { payload: ChatMoveInfoPayloadSchema, result: ChatMoveInfoResultSchema },
    // The suggestions of agents in Chats that a person has not answered yet, and a person's no to one.
    'chat.proposals': { payload: EmptySchema, result: ProjectProposalsSchema },
    'chat.proposalDecline': { payload: ProjectProposalDeclinePayloadSchema, result: ProjectProposalDeclineResultSchema },
    'skills.list': AGENT_REQUEST_SCHEMAS['skills.list'],
    'provider.list': AGENT_REQUEST_SCHEMAS['provider.list'],
    // The same list after the machine looked for its CLIs again, at most once every ten seconds; what a person coming back asks.
    'provider.detect': AGENT_REQUEST_SCHEMAS['provider.list'],
    // The chat server of a CLI that ships one apart (Antigravity), and a person's Install of it; the daemon never installs one itself.
    'provider.server': { payload: AgentServerPayloadSchema, result: AgentServerResultSchema },
    'provider.installServer': { payload: AgentServerPayloadSchema, result: AgentServerResultSchema },
    // The agents of the public ACP registry with a build for this machine, and a person's Install or removal of one; the daemon never installs one itself.
    'provider.registry': { payload: RegistryCatalogPayloadSchema, result: RegistryCatalogResultSchema },
    'provider.installAgent': { payload: RegistryAgentPayloadSchema, result: RegistryAgentResultSchema },
    'provider.removeAgent': { payload: RegistryAgentPayloadSchema, result: RegistryAgentResultSchema },
    // How each CLI was installed, its version and the newest its route offers, and a person's update through that route.
    'provider.versions': { payload: CliVersionsPayloadSchema, result: CliVersionsResultSchema },
    'provider.update': { payload: CliUpdatePayloadSchema, result: CliUpdateResultSchema },
    'accounts.list': AGENT_REQUEST_SCHEMAS['accounts.list'],
    'accounts.save': AGENT_REQUEST_SCHEMAS['accounts.save'],
    'accounts.refresh': AGENT_REQUEST_SCHEMAS['accounts.refresh'],
    'accounts.create': AGENT_REQUEST_SCHEMAS['accounts.create'],
    'accounts.watchLogin': AGENT_REQUEST_SCHEMAS['accounts.watchLogin'],
    'accounts.reorder': AGENT_REQUEST_SCHEMAS['accounts.reorder'],
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
    // One person's accounts for a project's new starts, in its private file. Only a person on this machine sets them, never a verb.
    'project.setAccounts': { payload: ProjectSetAccountsPayloadSchema, result: ProjectSetAccountsResultSchema },
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
    // Sent before a save writes; never holds the save up.
    'language.willSave': { payload: LanguageWillSavePayloadSchema, result: EmptySchema },
    // A whole-project pull on a person's press; the reports come as `language.diagnostics`.
    'language.workspaceProblems': { payload: LanguageWorkspaceProblemsPayloadSchema, result: LanguageWorkspaceProblemsResultSchema },
    'language.messageAnswer': { payload: LanguageMessageAnswerPayloadSchema, result: EmptySchema },
    // A debugging switch like restart: any client of the machine may set it.
    'language.trace': { payload: LanguageTracePayloadSchema, result: LanguageServerStatusResultSchema },
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
    'launches.detect': { payload: LaunchesDetectPayloadSchema, result: LaunchesDetectResultSchema },
    // A person's choice, which approves the task for the project's worktrees as it stands now.
    'launches.afterSettle': { payload: LaunchesAfterSettlePayloadSchema, result: EmptySchema },
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
    'fs.locate': { payload: FsLocatePayloadSchema, result: FsLocateResultSchema },
    'fs.list': { payload: FsListPayloadSchema, result: FsListResultSchema },
    'fs.read': { payload: FsReadPayloadSchema, result: FsReadResultSchema },
    'fs.create': { payload: FsCreatePayloadSchema, result: FsCreateResultSchema },
    'fs.delete': { payload: FsDeletePayloadSchema, result: FsDeleteResultSchema },
    'fs.rename': { payload: FsRenamePayloadSchema, result: FsRenameResultSchema },
    'fs.write': { payload: FsWritePayloadSchema, result: FsWriteResultSchema },
    'fs.watch': { payload: FsWatchPayloadSchema, result: EmptySchema },
    'fs.unwatch': { payload: FsWatchPayloadSchema, result: EmptySchema },
    'bytes.read': { payload: BytesReadPayloadSchema, result: BytesReadResultSchema },
    'archive.list': { payload: ArchiveListPayloadSchema, result: ArchiveListResultSchema },
    // Unpacks into a project; never overwrites and never makes a link.
    'archive.extract': { payload: ArchiveExtractPayloadSchema, result: ArchiveExtractResultSchema },
    'git.worktree-add': { payload: WorktreeAddPayloadSchema, result: WorktreeAddResultSchema },
    'git.worktree-list': { payload: WorktreeListPayloadSchema, result: WorktreeListResultSchema },
    'git.worktree-remove': { payload: WorktreeRemovePayloadSchema, result: WorktreeRemoveResultSchema },
    'git.worktree-merge': { payload: WorktreeMergePayloadSchema, result: WorktreeMergeResultSchema },
    'git.worktree-abort': { payload: GitCwdPayloadSchema, result: EmptySchema },
    'git.status': { payload: GitCwdPayloadSchema, result: GitStatusSchema },
    'git.watch': { payload: GitWatchPayloadSchema, result: GitWatchResultSchema },
    'git.unwatch': { payload: GitCwdPayloadSchema, result: EmptySchema },
    'git.diff': { payload: GitDiffPayloadSchema, result: GitDiffResultSchema },
    'git.blame': { payload: GitBlamePayloadSchema, result: GitBlameResultSchema },
    'git.identity': { payload: GitIdentityPayloadSchema, result: GitIdentityResultSchema },
    'git.stage': { payload: GitStagePayloadSchema, result: EmptySchema },
    'git.discard': { payload: GitDiscardPayloadSchema, result: GitDiscardResultSchema },
    'git.pr': { payload: GitPullRequestPayloadSchema, result: GitPullRequestResultSchema },
    'git.prSplit': { payload: GitPrSplitPayloadSchema, result: GitPrSplitResultSchema },
    'git.pr-watch': { payload: GitPrWatchPayloadSchema, result: GitPrWatchResultSchema },
    'git.pr-unwatch': { payload: GitPrUnwatchPayloadSchema, result: EmptySchema },
    'git.pr-watches': { payload: GitPrWatchesPayloadSchema, result: GitPrWatchesResultSchema },
    'git.issue': { payload: GitIssuePayloadSchema, result: GitIssueSchema },
    'git.ref-commit': { payload: GitRefCommitPayloadSchema, result: GitRefCommitResultSchema },
    'git.refs': { payload: GitCwdPayloadSchema, result: GitRefsResultSchema },
    'git.repos': { payload: GitReposPayloadSchema, result: GitReposResultSchema },
    'git.log': { payload: GitLogPayloadSchema, result: GitLogResultSchema },
    'git.authors': { payload: GitCwdPayloadSchema, result: GitAuthorsResultSchema },
    'git.action': { payload: GitActionPayloadSchema, result: GitActionResultSchema },
    'git.cancel': { payload: GitCancelPayloadSchema, result: EmptySchema },
    'git.clone': { payload: GitClonePayloadSchema, result: GitCloneResultSchema },
    'git.ignoredFiles': { payload: GitIgnoredFilesPayloadSchema, result: GitIgnoredFilesResultSchema },
    'git.conflicts': { payload: GitCwdPayloadSchema, result: GitConflictsResultSchema },
    'git.conflict': { payload: GitConflictPayloadSchema, result: GitConflictResultSchema },
    'git.resolve': { payload: GitResolvePayloadSchema, result: GitResolveResultSchema },
    'git.resolveAi': { payload: GitResolveAiPayloadSchema, result: GitResolveAiResultSchema },
    'git.operation': { payload: GitOperationPayloadSchema, result: GitActionResultSchema },
    'git.capabilities': { payload: GitCwdPayloadSchema, result: GitCapabilitiesResultSchema },
    'git.suggestMessage': { payload: GitSuggestMessagePayloadSchema, result: GitSuggestMessageResultSchema },
    'git.bundle': { payload: GitBundlePayloadSchema, result: GitBundleResultSchema },
    'git.bundlePut': { payload: GitBundlePutPayloadSchema, result: GitBundlePutResultSchema },
    'git.fetchBundle': { payload: GitFetchBundlePayloadSchema, result: GitFetchBundleResultSchema },
    'usage.summary': AGENT_REQUEST_SCHEMAS['usage.summary'],
    'usage.subscribe': AGENT_REQUEST_SCHEMAS['usage.subscribe'],
    'usage.unsubscribe': AGENT_REQUEST_SCHEMAS['usage.unsubscribe'],
    'usage.limits': AGENT_REQUEST_SCHEMAS['usage.limits'],
    'usage.refreshLimits': AGENT_REQUEST_SCHEMAS['usage.refreshLimits'],
    'usage.startup': { payload: UsageStartupPayloadSchema, result: EmptySchema },
    'usage.count': { payload: UsageCountPayloadSchema, result: EmptySchema },
    'usage.timing': { payload: UsageTimingPayloadSchema, result: EmptySchema },
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
    'computer.requestGrant': { payload: ComputerRequestGrantPayloadSchema, result: ComputerRequestGrantResultSchema },
    'computer.setLanguage': { payload: ComputerSetLanguagePayloadSchema, result: EmptySchema },
    'computer.grants': { payload: EmptySchema, result: ComputerAppGrantsSchema },
    'computer.revoke': { payload: ComputerRevokePayloadSchema, result: ComputerRevokeResultSchema },
    'secret.requests': { payload: EmptySchema, result: SecretRequestsSchema },
    'secret.save': { payload: SecretSavePayloadSchema, result: SecretAnswerResultSchema },
    'secret.decline': { payload: SecretDeclinePayloadSchema, result: SecretAnswerResultSchema },
    // Voice run by the daemon for a phone. Setting and clearing the key is the local secret's.
    'voice.keyStatus': { payload: EmptySchema, result: VoiceKeyStatusSchema },
    'voice.setKey': { payload: VoiceSetKeyPayloadSchema, result: VoiceKeyStatusSchema },
    'voice.clearKey': { payload: EmptySchema, result: VoiceKeyStatusSchema },
    'voice.start': { payload: VoiceStartPayloadSchema, result: VoiceStartResultSchema },
    'voice.stop': { payload: VoiceStopPayloadSchema, result: VoiceStopResultSchema },
    'voice.confirm': { payload: VoiceConfirmPayloadSchema, result: VoiceConfirmResultSchema },
    // How Voice on this machine talks, which any client but another machine reads and sets.
    'voice.preferences': { payload: EmptySchema, result: VoicePreferencesStateSchema },
    'voice.setPreferences': { payload: VoicePreferencesSchema, result: VoicePreferencesStateSchema },
    'endpoint.info': { payload: EndpointInfoPayloadSchema, result: EndpointInfoSchema },
    'endpoint.setIdentity': { payload: EndpointSetIdentityPayloadSchema, result: EndpointInfoSchema },
    'endpoint.settings': { payload: EndpointSettingsSchema, result: EndpointInfoSchema },
    'endpoint.setNodeSize': { payload: EndpointSetNodeSizePayloadSchema, result: EndpointInfoSchema },
    'endpoint.agentIntegrations': { payload: EmptySchema, result: AgentIntegrationsResultSchema },
    'endpoint.setAgentIntegration': { payload: AgentIntegrationSetPayloadSchema, result: AgentIntegrationSetResultSchema },
    'endpoint.closedLidRule': { payload: EndpointClosedLidRulePayloadSchema, result: EndpointInfoSchema },
    'endpoint.signPeerAccess': { payload: EndpointSignPeerAccessPayloadSchema, result: EndpointSignPeerAccessResultSchema },
    'endpoint.signRegistration': { payload: EndpointSignRegistrationPayloadSchema, result: EndpointSignRegistrationResultSchema },
    'endpoint.leaveAccount': { payload: EmptySchema, result: EndpointLeaveAccountResultSchema },
    // The desktop app on this machine saying where its updater stands. Local secret only: it speaks for the machine.
    'endpoint.reportUpdate': { payload: MachineUpdateReportSchema, result: EmptySchema },
    // Any client may ask, `update-no-app` without the desktop app and `update-none` with nothing to install.
    'endpoint.installUpdate': { payload: EndpointInstallUpdatePayloadSchema, result: EndpointInstallUpdateResultSchema },
    'endpoint.reach': { payload: EndpointReachPayloadSchema, result: EndpointReachResultSchema },
    'auth.sessions': { payload: EmptySchema, result: AuthSessionsResultSchema },
    'auth.revoke': { payload: AuthRevokePayloadSchema, result: EmptySchema },
    'direct.signal': { payload: DirectSignalPayloadSchema, result: EmptySchema },
    'chat.kill': AGENT_REQUEST_SCHEMAS['chat.kill'],
    'chat.restart': AGENT_REQUEST_SCHEMAS['chat.restart'],
    'chat.list': AGENT_REQUEST_SCHEMAS['chat.list'],
    'task.list': { payload: TaskListPayloadSchema, result: TaskListResultSchema },
    'agent.children': { payload: AgentChildrenPayloadSchema, result: AgentChildrenResultSchema },
    'plan.list': { payload: PlanListPayloadSchema, result: PlanListResultSchema },
    'plan.apply': { payload: PlanApplyPayloadSchema, result: PlanApplyResultSchema },
    // A person's own: no request of these is on a peer's list, and bytes go only through `bytes.read`.
    'artifact.list': { payload: ArtifactListPayloadSchema, result: ArtifactListResultSchema },
    'artifact.get': { payload: ArtifactGetPayloadSchema, result: ArtifactGetResultSchema },
    'artifact.watch': { payload: EmptySchema, result: EmptySchema },
    'artifact.unwatch': { payload: EmptySchema, result: EmptySchema },
    'artifact.save': { payload: ArtifactSavePayloadSchema, result: ArtifactSaveResultSchema },
    'artifact.saveFolder': { payload: ArtifactSaveFolderPayloadSchema, result: ArtifactSaveResultSchema },
    'artifact.copyToProject': { payload: ArtifactCopyToProjectPayloadSchema, result: ArtifactCopyToProjectResultSchema },
    'artifact.storage': { payload: EmptySchema, result: ArtifactStorageResultSchema },
    'artifact.cleanup': { payload: ArtifactCleanupPayloadSchema, result: ArtifactCleanupResultSchema },
    'artifact.importFrom': { payload: ArtifactImportFromPayloadSchema, result: ArtifactImportFromResultSchema },
    'artifact.remove': { payload: ArtifactRemovePayloadSchema, result: ArtifactRemoveResultSchema },
    // A person's own: no request of these is on a peer's list, and an agent reaches routines only through its verbs.
    'routine.list': { payload: RoutineListPayloadSchema, result: RoutineListResultSchema },
    'routine.get': { payload: RoutineTargetPayloadSchema, result: RoutineGetResultSchema },
    'routine.save': { payload: RoutineSavePayloadSchema, result: RoutineSaveResultSchema },
    'routine.approve': { payload: RoutineApprovePayloadSchema, result: EmptySchema },
    'routine.decline': { payload: RoutineApprovePayloadSchema, result: EmptySchema },
    'routine.pause': { payload: RoutineTargetPayloadSchema, result: EmptySchema },
    'routine.resume': { payload: RoutineTargetPayloadSchema, result: EmptySchema },
    'routine.runNow': { payload: RoutineTargetPayloadSchema, result: RoutineRunNowResultSchema },
    'routine.remove': { payload: RoutineRemovePayloadSchema, result: EmptySchema },
    'routine.watch': { payload: EmptySchema, result: EmptySchema },
    'routine.unwatch': { payload: EmptySchema, result: EmptySchema },
    'routine.skills': { payload: RoutineSkillsPayloadSchema, result: RoutineSkillsResultSchema },
    // Any client of the owner edits; no request of these is on a peer's list, and an agent reaches templates only through its verb.
    'template.list': { payload: TemplateListPayloadSchema, result: TemplateListResultSchema },
    'template.save': { payload: TemplateSavePayloadSchema, result: TemplateSaveResultSchema },
    'template.remove': { payload: TemplateRemovePayloadSchema, result: TemplateRemoveResultSchema },
    'template.configure': { payload: TemplateConfigurePayloadSchema, result: TemplateConfigureResultSchema },
    'provenance.read': { payload: ProvenanceReadPayloadSchema, result: ProvenanceReadResultSchema },
    'provenance.review': { payload: ProvenanceReviewPayloadSchema, result: ProvenanceReviewResultSchema },
    'nanogpt.status': { payload: EmptySchema, result: NanoGptStatusSchema },
    'nanogpt.configure': { payload: NanoGptConfigurePayloadSchema, result: NanoGptStatusSchema },
    'anthropic.status': { payload: EmptySchema, result: ClaudeApiStatusSchema },
    'anthropic.configure': { payload: ClaudeApiConfigurePayloadSchema, result: ClaudeApiStatusSchema }
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
    // The links of other machines to projects here changed, so the list in settings reloads.
    'peer.changed': EmptySchema,
    // Sent to the machine that gave the task, over its own link only.
    'peer.taskSettled': PeerTaskSettledEventSchema,
    // The link to another machine opened, was lost or is waiting to be tried again.
    'remote.status': RemoteStatusEventSchema,
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
    'language.message': LanguageMessageEventSchema,
    'language.messageClosed': LanguageMessageClosedEventSchema,
    // To the one client whose command runs on the server.
    'language.show': LanguageShowEventSchema,
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
    // The watches of a project changed (one started, stopped or ended by itself); a client that holds it asks again.
    'git.pr-watches': GitPrWatchesEventSchema,
    'git.worktrees': GitWorktreesEventSchema,
    'usage.changed': AGENT_EVENT_SCHEMAS['usage.changed'],
    'usage.limitsChanged': AGENT_EVENT_SCHEMAS['usage.limitsChanged'],
    'accounts.changed': AGENT_EVENT_SCHEMAS['accounts.changed'],
    // The list `provider.list` answers, to every client, whenever an agent reported models or abilities the machine did not know.
    'provider.changed': AGENT_REQUEST_SCHEMAS['provider.list'].result,
    'processes.sample': ProcessesSampleEventSchema,
    'processes.alerts': ProcessesAlertsSchema,
    'computer.status': ComputerUseStatusSchema,
    'computer.approvals': ComputerApprovalsSchema,
    'computer.grants': ComputerAppGrantsSchema,
    'secret.requests': SecretRequestsSchema,
    // To the connection that started the session only; the app routes them to the scene by `sceneId`.
    'voice.status': VoiceStatusEventSchema,
    'voice.activity': VoiceActivityEventSchema,
    // To every client of the machine, whenever a client sets them.
    'voice.preferences': VoicePreferencesStateSchema,
    // Every open suggestion of an agent in Chats, to every client, whenever the list changes.
    'chat.proposals': ProjectProposalsSchema,
    'task.changed': TaskChangedEventSchema,
    'plan.changed': PlanChangedEventSchema,
    'plan.removed': PlanRemovedEventSchema,
    'plan.created': PlanCreatedEventSchema,
    // Only to the clients that asked with `artifact.watch`.
    'artifact.changed': ArtifactChangedEventSchema,
    'provenance.changed': ProvenanceChangedEventSchema,
    // Only to the clients that asked with `routine.watch`.
    'routine.changed': RoutineChangedEventSchema,
    // A person's templates to every client, a project's to the clients that hold it.
    'template.changed': TemplateChangedEventSchema
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
