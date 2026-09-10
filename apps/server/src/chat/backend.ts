import type { ChatAttachment, ChatFileChange, ChatQuestion, ModelSelection, RuntimeMode } from '@ruimte/contracts';

/*
 * The seam between one chat and one CLI. A backend owns a process and the protocol it speaks; it
 * reports what happened as `BackendEvent`s and never touches the thread, its item ids or its turns.
 * Everything a provider does differently lives behind this interface.
 */

export interface BackendLaunch {
    // The executable and its leading arguments; a test points this at a fake CLI.
    command: string[];
    cwd: string;
    env: Record<string, string>;
    selection: ModelSelection;
    runtimeMode: RuntimeMode;
    // The CLI's own session or thread id to continue, if the chat has one.
    resume: string | null;
    // How often this chat started a CLI; a protocol that numbers its own requests from zero
    // needs it to keep the ids of one process apart from those of the one before.
    generation: number;
    // Whether the person linked context to this chat; the backend decides how to tell the CLI.
    hasContext: boolean;
}

export interface TurnInput {
    text: string;
    // What the session wants in front of the text (a context change); the backend places it after its own prefix.
    preamble: string | null;
    attachments: ChatAttachment[];
    // The paths the person picked with `@`; they also sit in the text, for a CLI that expands them itself.
    mentions: string[];
}

export type ApprovalDecision = 'allow' | 'allow-always' | 'deny';

/*
 * What a CLI told us, in one vocabulary. `ref` is the backend's own key for an item (a tool use id,
 * a message id plus block ordinal, a native item id); the projector turns it into a thread item id.
 */
export type BackendEvent =
    | { type: 'session'; agentSessionId: string | null; model: string | null; slashCommands?: string[] }
    | { type: 'text.delta'; ref: string; text: string }
    | { type: 'text.done'; ref: string; text: string }
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
      }
    | { type: 'question.requested'; requestId: string; questions: ChatQuestion[] }
    // The CLI took an approval or a question back; the person no longer has to answer it.
    | { type: 'request.withdrawn'; requestId: string }
    | { type: 'usage'; contextTokens?: number; contextWindow?: number }
    | { type: 'compaction'; preTokens: number | null }
    | { type: 'model'; model: string }
    | { type: 'note'; level: 'info' | 'warning' | 'error'; text: string }
    | { type: 'turn.done'; state: 'done' | 'aborted' | 'error'; costUsd: number; error?: string }
    // The CLI could not be reached or refused the request; the turn ends and the chat needs a new one.
    | { type: 'failed'; message: string }
    | { type: 'exit'; exitCode: number | null };

export interface BackendHost {
    onEvent(event: BackendEvent): void;
}

export interface ChatBackend {
    readonly running: boolean;
    // Starts the process if it has not started; resolves once the CLI can take a turn.
    start(): Promise<void>;
    sendTurn(input: TurnInput): void;
    compact(): void;
    interrupt(): void;
    // False when nothing waits under that id, so the caller can answer the client with an error.
    respondApproval(requestId: string, decision: ApprovalDecision, message?: string): boolean;
    respondQuestion(requestId: string, answers: Record<string, string>): boolean;
    // Closes the input and lets the CLI leave on its own; `dispose` kills it.
    stop(): void;
    dispose(): void;
}
