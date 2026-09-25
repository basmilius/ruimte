import type {
    ChatAttachment,
    ChatFileChange,
    ChatQuestion,
    ChatSkill,
    ChatSubagentUsage,
    ChatTurnLimit,
    ChatWorkflow,
    ContextSource,
    ModelSelection,
    RuntimeMode
} from '@ruimte/contracts';
import type { LimitsUpdate } from '../usage/limits/normalize.ts';
import type { SpawnChatProcess } from './chat-process.ts';

/*
 * The seam between one chat and one CLI. A backend owns a process and the protocol it speaks; it
 * reports what happened as `BackendEvent`s and never touches the thread, its item ids or its turns.
 * Everything a provider does differently lives behind this interface.
 */

export interface BackendLaunch {
    // A test points this at a fake CLI.
    command: string[];
    cwd: string;
    env: Record<string, string>;
    selection: ModelSelection;
    // The selected model as a person reads it, for the errors a backend puts in the thread.
    modelName: string;
    runtimeMode: RuntimeMode;
    // The CLI's own session or thread id to continue, if the chat has one.
    resume: string | null;
    // How often this chat started a CLI; a protocol that numbers its own requests from zero
    // needs it to keep the ids of one process apart from those of the one before.
    generation: number;
    // What the person linked to this chat, named for the CLI; empty when nothing is linked.
    context: ContextSource[];
    // How deep in a chain of agents this chat sits, which decides what the note about the verbs offers it.
    depth: number;
    standalone?: boolean;
    // Whether computer use is on for this machine, which is when the note names the `computer` noun.
    computer?: boolean;
    // How the CLI is started; a test runs a fake in the same process, everything else spawns it.
    spawn?: SpawnChatProcess;
}

export interface TurnInput {
    text: string;
    // What the session wants in front of the text (a context change); the backend places it after its own prefix.
    preamble: string | null;
    attachments: ChatAttachment[];
    // The paths the person picked with `@`; they also sit in the text, for a CLI that expands them itself.
    mentions: string[];
    // The skills the person picked with `$`; they also sit in the text, for a CLI that expands them itself.
    skills: string[];
}

export type ApprovalDecision = 'allow' | 'allow-always' | 'deny';

/*
 * What a CLI told us, in one vocabulary. `ref` is the backend's own key for an item (a tool use id,
 * a message id plus block ordinal, a native item id); the projector turns it into a thread item id.
 */
export type BackendEvent =
    // `title` is the name the CLI already has for the thread, as a resumed Codex thread carries it.
    | { type: 'session'; agentSessionId: string | null; model: string | null; slashCommands?: string[]; skills?: string[]; title?: string | null }
    // The CLI renamed its thread, for a protocol that says so.
    | { type: 'title'; title: string }
    | { type: 'text.delta'; ref: string; text: string }
    // `parentRef` is set for text a subagent wrote; it belongs to that agent's row, not to the thread.
    | { type: 'text.done'; ref: string; text: string; parentRef?: string | null }
    // What the model thought before it answered; consecutive blocks become one thinking item.
    | { type: 'thinking.delta'; ref: string; text: string }
    | { type: 'thinking.done'; ref: string; text: string }
    | { type: 'tool.started'; ref: string; name: string; input: unknown; parentRef: string | null; changes?: ChatFileChange[] }
    | { type: 'tool.progress'; ref: string; startedAt: number | null; description: string | null }
    | { type: 'tool.output'; ref: string; text: string }
    | { type: 'tool.done'; ref: string; output: string | null; state: 'done' | 'error'; changes?: ChatFileChange[] }
    | {
          type: 'approval.requested';
          requestId: string;
          // The tool call the request is about, when the CLI names one.
          ref: string | null;
          toolName: string;
          input: unknown;
          description: string | null;
          canAllowAlways: boolean;
          allowAlways?: { label: string; description: string };
      }
    // `async` marks a question the CLI goes on past, which is the only kind the person may dismiss.
    | { type: 'question.requested'; requestId: string; questions: ChatQuestion[]; async?: boolean }
    // The CLI took an approval or a question back; the person no longer has to answer it.
    | { type: 'request.withdrawn'; requestId: string }
    // An agent the agent delegated to, keyed by the call that spawned it. `background` says whether
    // it runs beside the turn; a foreground one settles with the call's own result instead.
    | {
          type: 'task.started';
          ref: string;
          description: string | null;
          subagentType: string | null;
          prompt: string | null;
          background: boolean;
          // The CLI's own id for the agent, which stays the same when a message wakes it again under another call.
          taskId?: string | null;
          // The thread a CLI that keeps one per agent opened for it, which is where its whole conversation is read.
          threadId?: string | null;
          // How many agents deep it runs: 1 for one the chat's own agent opened, 2 for one a subagent opened.
          depth?: number;
      }
    | { type: 'task.progress'; ref: string; taskId?: string | null; summary: string | null; lastTool: string | null; usage: ChatSubagentUsage | null }
    // A task the CLI runs beside the turn (a background subagent, a backgrounded command) settled.
    // Its summary is what the CLI says came of it, and what a turn the CLI opens on its own is about.
    | {
          type: 'task.done';
          ref: string | null;
          taskId?: string | null;
          summary: string | null;
          ok: boolean;
          usage?: ChatSubagentUsage | null;
          outputFile?: string | null;
      }
    // What the workflow a Workflow call launched runs now, whole; a null name leaves the one said before.
    | { type: 'workflow.progress'; ref: string; workflow: ChatWorkflow }
    // A command or a monitor the CLI keeps running beside its turns. `ref` is the call that started it, when a
    // call did; `monitor` is set when the CLI's own frame already says it is one.
    | { type: 'background.started'; taskId: string; ref: string | null; monitor: boolean; description: string | null }
    | { type: 'background.ended'; taskId: string }
    | { type: 'usage'; contextTokens?: number; contextWindow?: number }
    // What the CLI said in passing about the plan it runs on; it belongs to the machine, not the chat.
    | { type: 'limits'; update: LimitsUpdate }
    | { type: 'compaction'; preTokens: number | null }
    | { type: 'model'; model: string }
    | { type: 'note'; level: 'info' | 'warning' | 'error'; text: string }
    // `native` is the CLI's own name for where the turn ended, which a fork of the chat is cut at.
    | {
          type: 'turn.done';
          state: 'done' | 'aborted' | 'error';
          costUsd: number;
          error?: string;
          native?: { turnId?: string; lastUuid?: string };
          limit?: ChatTurnLimit;
      }
    // The CLI could not be reached or refused the request; the turn ends and the chat needs a new one.
    | { type: 'failed'; message: string }
    // `stderr` is the last of what the CLI wrote there, for an exit with an error code.
    | { type: 'exit'; exitCode: number | null; stderr?: string };

export interface BackendHost {
    onEvent(event: BackendEvent): void;
}

export interface ChatBackend {
    readonly running: boolean;
    // The CLI's process while it runs, so the process panel can put its tree under the node.
    readonly pid: number | null;
    // Starts the process if it has not started; resolves once the CLI can take a turn.
    start(): Promise<void>;
    sendTurn(input: TurnInput): void;
    compact(): void;
    interrupt(): void;
    // False when nothing waits under that id, so the caller can answer the client with an error.
    respondApproval(requestId: string, decision: ApprovalDecision, message?: string): boolean;
    respondQuestion(requestId: string, answers: Record<string, string>): boolean;
    // Ends one command or monitor the CLI runs beside its turns, for a protocol that can name one.
    stopTask?(taskId: string): void;
    // Turns down a request the CLI still holds after a person stopped the turn, for a protocol that leaves one open past it.
    declineRequest?(requestId: string, message: string): boolean;
    // Drops an asynchronous question without telling the CLI, for a protocol that keeps one waiting.
    dismissRequest?(requestId: string): boolean;
    // Gives the CLI's own thread the name the chat got, for a protocol whose thread list and resume carry one.
    setTitle?(title: string): void;
    // What this CLI would run right now, for a protocol that answers the question itself.
    listSkills?(): Promise<ChatSkill[]>;
    // One page of a thread the CLI keeps, asked of this running process rather than of a new one.
    listThreadItems?(params: { threadId: string; cursor?: string; limit: number; sortDirection: 'asc' | 'desc' }): Promise<unknown>;
    // Closes the input and lets the CLI leave on its own; `dispose` ends it.
    stop(): void;
    // Ends the CLI and everything it started; settles once it exited or was sent the SIGKILL.
    dispose(): Promise<void>;
}
