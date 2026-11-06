import { AGENT_EVENT_SCHEMAS, AGENT_REQUEST_SCHEMAS } from '@adecore/agent-contracts/protocol';
import { z } from 'zod';
import { AGENT_INTEGRATIONS_REQUEST_SCHEMAS } from './agent-integrations.ts';
import { AGENT_REGISTRY_REQUEST_SCHEMAS } from './agent-registry.ts';
import { AGENT_SERVER_REQUEST_SCHEMAS, AGENT_SERVER_EVENT_SCHEMAS } from './agent-server.ts';
import { RUIMTE_AGENT_REQUEST_SCHEMAS, RUIMTE_AGENT_EVENT_SCHEMAS } from './agent.ts';
import { ARCHIVE_REQUEST_SCHEMAS } from './archive.ts';
import { ARTIFACT_REQUEST_SCHEMAS, ARTIFACT_EVENT_SCHEMAS } from './artifact.ts';
import { AUTH_REQUEST_SCHEMAS, AUTH_EVENT_SCHEMAS } from './auth.ts';
import { BROWSER_REQUEST_SCHEMAS, BROWSER_EVENT_SCHEMAS } from './browser.ts';
import { BYTES_REQUEST_SCHEMAS } from './bytes.ts';
import { CHAT_HANDOFF_REQUEST_SCHEMAS } from './chat-handoff.ts';
import { CHAT_IMAGE_REQUEST_SCHEMAS } from './chat-image.ts';
import { CHAT_MOVE_REQUEST_SCHEMAS, CHAT_MOVE_EVENT_SCHEMAS } from './chat-move.ts';
import { CHAT_SEARCH_REQUEST_SCHEMAS } from './chat-search.ts';
import { CLAUDE_API_REQUEST_SCHEMAS } from './claude-api.ts';
import { COMPUTER_REQUEST_SCHEMAS, COMPUTER_EVENT_SCHEMAS } from './computer.ts';
import { DATABASE_REQUEST_SCHEMAS, DATABASE_EVENT_SCHEMAS } from './database.ts';
import { DEVICE_REQUEST_SCHEMAS, DEVICE_EVENT_SCHEMAS } from './device.ts';
import { DIAGRAM_HOST_REQUEST_SCHEMAS, DIAGRAM_HOST_EVENT_SCHEMAS } from './diagram-host.ts';
import { DIRECT_REQUEST_SCHEMAS, DIRECT_EVENT_SCHEMAS } from './direct.ts';
import { DRAWING_HOST_REQUEST_SCHEMAS, DRAWING_HOST_EVENT_SCHEMAS } from './drawing-host.ts';
import { EDITOR_ASSIST_REQUEST_SCHEMAS, EDITOR_ASSIST_EVENT_SCHEMAS } from './editor-assist.ts';
import { EXTENSION_EVENT_SCHEMAS, EXTENSION_REQUEST_SCHEMAS } from './extension.ts';
import { FS_REQUEST_SCHEMAS, FS_EVENT_SCHEMAS } from './fs.ts';
import { GIT_REQUEST_SCHEMAS, GIT_EVENT_SCHEMAS } from './git.ts';
import { LANGUAGE_REQUEST_SCHEMAS, LANGUAGE_EVENT_SCHEMAS } from './language.ts';
import { LAUNCHES_REQUEST_SCHEMAS, LAUNCHES_EVENT_SCHEMAS } from './launches.ts';
import { MACHINE_UPDATE_REQUEST_SCHEMAS, MACHINE_UPDATE_EVENT_SCHEMAS } from './machine-update.ts';
import { NANOGPT_REQUEST_SCHEMAS } from './nanogpt.ts';
import { PEER_REQUEST_SCHEMAS, PEER_EVENT_SCHEMAS } from './peer.ts';
import { PLAN_HOST_REQUEST_SCHEMAS, PLAN_HOST_EVENT_SCHEMAS } from './plan-host.ts';
import { PROCESSES_REQUEST_SCHEMAS, PROCESSES_EVENT_SCHEMAS } from './processes.ts';
import { PROJECT_SIDEBAR_REQUEST_SCHEMAS, PROJECT_SIDEBAR_EVENT_SCHEMAS } from './project-sidebar.ts';
import { PROJECT_REQUEST_SCHEMAS, PROJECT_EVENT_SCHEMAS } from './project.ts';
import { PROVENANCE_REQUEST_SCHEMAS, PROVENANCE_EVENT_SCHEMAS } from './provenance.ts';
import { PUSH_REQUEST_SCHEMAS, PUSH_EVENT_SCHEMAS } from './push.ts';
import { REACH_REQUEST_SCHEMAS } from './reach.ts';
import { REMOTE_REQUEST_SCHEMAS, REMOTE_EVENT_SCHEMAS } from './remote.ts';
import { RENDER_REQUEST_SCHEMAS } from './render.ts';
import { ROUTINE_REQUEST_SCHEMAS, ROUTINE_EVENT_SCHEMAS } from './routine.ts';
import { SECRETS_REQUEST_SCHEMAS, SECRETS_EVENT_SCHEMAS } from './secrets.ts';
import { SERVER_REQUEST_SCHEMAS } from './server.ts';
import { SESSION_PORTS_REQUEST_SCHEMAS } from './session-ports.ts';
import { SESSION_REQUEST_SCHEMAS, SESSION_EVENT_SCHEMAS } from './session.ts';
import { SNOOZE_REQUEST_SCHEMAS, SNOOZE_EVENT_SCHEMAS } from './snooze.ts';
import { SQL_BINDING_REQUEST_SCHEMAS, SQL_BINDING_EVENT_SCHEMAS } from './sql-binding.ts';
import { TASK_REQUEST_SCHEMAS, TASK_EVENT_SCHEMAS } from './task.ts';
import { TEMPLATES_REQUEST_SCHEMAS, TEMPLATES_EVENT_SCHEMAS } from './templates.ts';
import { TERMINAL_PREPARE_REQUEST_SCHEMAS } from './terminal-prepare.ts';
import { VOICE_REQUEST_SCHEMAS, VOICE_EVENT_SCHEMAS } from './voice.ts';

export * from './agent.ts';
export * from './agent-integrations.ts';
export * from './agent-registry.ts';
export * from './artifact.ts';
export * from './routine.ts';
export * from './routine-approval.ts';
export * from './ruimte-folder.ts';
export * from './routine-schedule.ts';
export * from './routine-cron.ts';
export * from './agent-server.ts';
export * from './archive.ts';
export * from './auth.ts';
export * from './browser.ts';
export * from './browser-url.ts';
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
export * from './direct-handshake.ts';
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
export * from './editor-assist.ts';
export { cheapestEditorModel, type EditorModelPrice } from './editor-assist-model.ts';
export { explainPrompt, type ExplainInput } from './editor-assist-explain.ts';
export { cleanGhost, ghostPrompt, type GhostInput } from './editor-assist-ghost.ts';
export { NAMES_ASKED, namesPrompt, parseNames, type NamesInput } from './editor-assist-names.ts';
export { EDITOR_ASSIST_INSTRUCTIONS } from './editor-assist-purposes.ts';
export * from './timeouts.ts';
export * from './launches.ts';
export * from './launch-rules.ts';
export * from './secrets.ts';
export * from './live-stream.ts';
export * from './live-frame.ts';
export * from './machine-http.ts';
export * from './machine-update.ts';
export * from './model.ts';
export * from './model-sniff.ts';
export * from './nanogpt.ts';
export * from './node-defaults.ts';
export * from './node-title.ts';
export { emptyCanvasGroupIds, groupUnder, joinGroupUnder } from './canvas-groups.ts';
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
export * from './slug.ts';
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
export * from './extension.ts';
export * from './extension-actions.ts';
export * from './extension-client.ts';
export * from './extension-pack.ts';
export * from './extension-permissions.ts';
export * from './extension-results.ts';
export * from './voice.ts';
export * from './voice-languages.ts';
export * from './wait-ask.ts';
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
    ...AGENT_REQUEST_SCHEMAS,
    ...EXTENSION_REQUEST_SCHEMAS,
    ...SERVER_REQUEST_SCHEMAS,
    ...SESSION_REQUEST_SCHEMAS,
    ...PUSH_REQUEST_SCHEMAS,
    ...PEER_REQUEST_SCHEMAS,
    ...REMOTE_REQUEST_SCHEMAS,
    ...SNOOZE_REQUEST_SCHEMAS,
    ...TERMINAL_PREPARE_REQUEST_SCHEMAS,
    ...SESSION_PORTS_REQUEST_SCHEMAS,
    ...BROWSER_REQUEST_SCHEMAS,
    ...DEVICE_REQUEST_SCHEMAS,
    ...RUIMTE_AGENT_REQUEST_SCHEMAS,
    ...CHAT_IMAGE_REQUEST_SCHEMAS,
    ...CHAT_SEARCH_REQUEST_SCHEMAS,
    ...CHAT_HANDOFF_REQUEST_SCHEMAS,
    ...CHAT_MOVE_REQUEST_SCHEMAS,
    ...AGENT_SERVER_REQUEST_SCHEMAS,
    ...AGENT_REGISTRY_REQUEST_SCHEMAS,
    ...PROJECT_SIDEBAR_REQUEST_SCHEMAS,
    ...PROJECT_REQUEST_SCHEMAS,
    ...DRAWING_HOST_REQUEST_SCHEMAS,
    ...RENDER_REQUEST_SCHEMAS,
    ...DIAGRAM_HOST_REQUEST_SCHEMAS,
    ...LANGUAGE_REQUEST_SCHEMAS,
    ...SQL_BINDING_REQUEST_SCHEMAS,
    ...EDITOR_ASSIST_REQUEST_SCHEMAS,
    ...LAUNCHES_REQUEST_SCHEMAS,
    ...DATABASE_REQUEST_SCHEMAS,
    ...FS_REQUEST_SCHEMAS,
    ...BYTES_REQUEST_SCHEMAS,
    ...ARCHIVE_REQUEST_SCHEMAS,
    ...GIT_REQUEST_SCHEMAS,
    ...AUTH_REQUEST_SCHEMAS,
    ...PROCESSES_REQUEST_SCHEMAS,
    ...COMPUTER_REQUEST_SCHEMAS,
    ...SECRETS_REQUEST_SCHEMAS,
    ...VOICE_REQUEST_SCHEMAS,
    ...AGENT_INTEGRATIONS_REQUEST_SCHEMAS,
    ...MACHINE_UPDATE_REQUEST_SCHEMAS,
    ...REACH_REQUEST_SCHEMAS,
    ...DIRECT_REQUEST_SCHEMAS,
    ...TASK_REQUEST_SCHEMAS,
    ...PLAN_HOST_REQUEST_SCHEMAS,
    ...ARTIFACT_REQUEST_SCHEMAS,
    ...ROUTINE_REQUEST_SCHEMAS,
    ...TEMPLATES_REQUEST_SCHEMAS,
    ...PROVENANCE_REQUEST_SCHEMAS,
    ...NANOGPT_REQUEST_SCHEMAS,
    ...CLAUDE_API_REQUEST_SCHEMAS
} as const;

export type RequestType = keyof typeof REQUEST_SCHEMAS;

export type RequestMap = {
    [T in RequestType]: {
        payload: z.infer<(typeof REQUEST_SCHEMAS)[T]['payload']>;
        result: z.infer<(typeof REQUEST_SCHEMAS)[T]['result']>;
    };
};

export const EVENT_SCHEMAS = {
    ...AGENT_EVENT_SCHEMAS,
    ...EXTENSION_EVENT_SCHEMAS,
    ...SESSION_EVENT_SCHEMAS,
    ...PUSH_EVENT_SCHEMAS,
    ...PEER_EVENT_SCHEMAS,
    ...REMOTE_EVENT_SCHEMAS,
    ...SNOOZE_EVENT_SCHEMAS,
    ...BROWSER_EVENT_SCHEMAS,
    ...DEVICE_EVENT_SCHEMAS,
    ...RUIMTE_AGENT_EVENT_SCHEMAS,
    ...CHAT_MOVE_EVENT_SCHEMAS,
    ...AGENT_SERVER_EVENT_SCHEMAS,
    ...PROJECT_SIDEBAR_EVENT_SCHEMAS,
    ...PROJECT_EVENT_SCHEMAS,
    ...DRAWING_HOST_EVENT_SCHEMAS,
    ...DIAGRAM_HOST_EVENT_SCHEMAS,
    ...LANGUAGE_EVENT_SCHEMAS,
    ...SQL_BINDING_EVENT_SCHEMAS,
    ...EDITOR_ASSIST_EVENT_SCHEMAS,
    ...LAUNCHES_EVENT_SCHEMAS,
    ...DATABASE_EVENT_SCHEMAS,
    ...FS_EVENT_SCHEMAS,
    ...GIT_EVENT_SCHEMAS,
    ...AUTH_EVENT_SCHEMAS,
    ...PROCESSES_EVENT_SCHEMAS,
    ...COMPUTER_EVENT_SCHEMAS,
    ...SECRETS_EVENT_SCHEMAS,
    ...VOICE_EVENT_SCHEMAS,
    ...MACHINE_UPDATE_EVENT_SCHEMAS,
    ...DIRECT_EVENT_SCHEMAS,
    ...TASK_EVENT_SCHEMAS,
    ...PLAN_HOST_EVENT_SCHEMAS,
    ...ARTIFACT_EVENT_SCHEMAS,
    ...ROUTINE_EVENT_SCHEMAS,
    ...TEMPLATES_EVENT_SCHEMAS,
    ...PROVENANCE_EVENT_SCHEMAS
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
