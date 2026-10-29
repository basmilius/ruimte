import type { AgentRequest } from '@adecore/agent-contracts/agent';
import type { ChatRequestSummary } from '@adecore/agent-contracts/chat';

/* What a waiting node asks a person for, read from its oldest open request. */
export interface WaitAsk {
    readonly kind: 'command' | 'edit' | 'tool' | 'question';
    readonly tool: string;

    /* One line naming the command, file, subject or question; null when the request names none. */
    readonly detail: string | null;

    /* How many more requests wait behind this one. */
    readonly more: number;
}

const DETAIL_MAX = 120;

// Claude Code and Codex both report a shell call as `Bash`; the others are the names other CLIs use.
const COMMAND_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell', 'exec_command', 'shell', 'local_shell', 'run_shell_command']);
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'write_file', 'replace']);

/* The first line that says something, with its white space folded, cut to fit a notification. */
function oneLine(text: string | null | undefined): string | null {
    const line = (text ?? '')
        .split('\n')
        .map((part) => part.replace(/\s+/g, ' ').trim())
        .find((part) => part !== '');
    if (line === undefined) {
        return null;
    }

    return line.length > DETAIL_MAX ? `${line.slice(0, DETAIL_MAX - 1).trimEnd()}…` : line;
}

function baseName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/* The file a terminal's edit request names. Its text is the input as JSON, which the hook may have cut short. */
function editedFile(text: string): string | null {
    try {
        const input: unknown = JSON.parse(text);
        if (typeof input !== 'object' || input === null) {
            return null;
        }

        const fields = input as Record<string, unknown>;
        const path = [fields.file_path, fields.path, fields.notebook_path].find((value) => typeof value === 'string' && value !== '');

        return typeof path === 'string' ? baseName(path) : null;
    } catch {
        return null;
    }
}

function terminalAsk(request: AgentRequest, more: number): WaitAsk {
    const tool = request.toolName;
    if (request.kind === 'question') {
        return { kind: 'question', tool, detail: oneLine(request.text), more };
    }

    if (COMMAND_TOOLS.has(tool)) {
        return { kind: 'command', tool, detail: oneLine(request.text), more };
    }

    if (EDIT_TOOLS.has(tool)) {
        return { kind: 'edit', tool, detail: oneLine(editedFile(request.text)) ?? oneLine(request.title), more };
    }

    return { kind: 'tool', tool, detail: oneLine(request.title), more };
}

function chatAsk(request: ChatRequestSummary, more: number): WaitAsk | null {
    if (request.kind === 'question') {
        const first = request.question?.questions[0];

        return { kind: 'question', tool: 'AskUserQuestion', detail: oneLine(first?.question ?? first?.header), more };
    }

    const approval = request.approval;
    if (!approval) {
        return null;
    }

    const tool = approval.toolName;
    if (approval.command !== undefined || COMMAND_TOOLS.has(tool)) {
        return { kind: 'command', tool, detail: oneLine(approval.command ?? approval.subject), more };
    }

    if (approval.path !== undefined || EDIT_TOOLS.has(tool)) {
        return { kind: 'edit', tool, detail: oneLine(approval.path === undefined ? approval.subject : baseName(approval.path)), more };
    }

    return { kind: 'tool', tool, detail: oneLine(approval.subject) ?? oneLine(approval.description), more };
}

/* What a terminal's agent waits on; null while it reports no request, as a CLI that asks only through `Notification` does. */
export function terminalWaitAsk(requests: readonly AgentRequest[] | undefined): WaitAsk | null {
    const oldest = requests?.[0];

    return oldest ? terminalAsk(oldest, requests.length - 1) : null;
}

/* What a chat waits on, from the requests on its info, oldest first. */
export function chatWaitAsk(requests: readonly ChatRequestSummary[] | undefined): WaitAsk | null {
    const oldest = requests?.[0];

    return oldest ? chatAsk(oldest, requests.length - 1) : null;
}

/*
 * The words for a push to a phone, whose lock screen anyone near it reads: the kind and the tool only,
 * never the command, the file or the question. English, like every push text of the daemon.
 */
export function pushWaitText(ask: WaitAsk): string {
    const said =
        ask.kind === 'command'
            ? 'Wants to run a command'
            : ask.kind === 'edit'
              ? 'Wants to edit a file'
              : ask.kind === 'question'
                ? 'Asks a question'
                : `Wants to use ${ask.tool}`;

    return ask.more > 0 ? `${said}, and ${ask.more} more` : said;
}
