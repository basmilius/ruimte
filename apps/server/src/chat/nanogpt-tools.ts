import { AppleFoundationEventSchema, type RuntimeMode } from '@ruimte/contracts';
import { executeAppleTool, type AppleToolCall, type AppleToolContext } from './apple-tools.ts';
import { executeAppleCommand } from './apple-command-tool.ts';

const string = { type: 'string' };
function tool(name: string, description: string, properties: Record<string, unknown>, required = Object.keys(properties)) {
    return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } };
}
export const NANOGPT_TOOLS = [
    tool('list_files', 'List a project directory. Paths must be relative, with forward slashes.', { path: string }),
    tool(
        'read_file',
        'Read up to 100 lines of a project file. Offset is zero-based; continue using nextOffset.',
        {
            path: string,
            offset: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 100 }
        },
        ['path', 'offset']
    ),
    tool('search_files', 'Search project files for text.', { path: string, query: string, glob: string }, ['path', 'query']),
    tool('edit_file', 'Replace one exact occurrence of oldText in a project file. Read it first.', { path: string, oldText: string, newText: string }),
    tool('write_file', 'Write a project file, up to 12000 characters.', { path: string, content: string }),
    tool('run_command', 'Run a shell command in the project. Windows uses PowerShell; macOS/Linux use sh.', { command: string }),
    tool(
        'ask_user',
        'Ask the person a question and wait for the answer. Use it whenever you need a decision, a preference or a fact you cannot find in the project, instead of writing the question in your reply. Give options when the answer is a choice.',
        { question: string, options: { type: 'array', items: string, maxItems: 6 } },
        ['question']
    )
];

/*
 * The mode this backend really works in. `auto` is a CLI's own classifier deciding what is safe, which
 * a chat on a plain API has none of, so it takes the narrower mode that has a rule here instead of
 * guessing: reads and edits go through, a command still asks.
 */
export function nanoEffectiveMode(mode: RuntimeMode): RuntimeMode {
    return mode === 'auto' ? 'auto-accept-edits' : mode;
}

const READ_TOOLS: ReadonlySet<string> = new Set(['list_files', 'read_file', 'search_files']);
const EDIT_TOOLS: ReadonlySet<string> = new Set(['edit_file', 'write_file']);

/* Whether a tool waits for a person: everything in `supervised`, only commands once edits are accepted, nothing in `full-access`. */
export function nanoNeedsApproval(mode: RuntimeMode, tool: string): boolean {
    const effective = nanoEffectiveMode(mode);
    if (effective === 'full-access') {
        return false;
    }
    if (effective === 'auto-accept-edits') {
        return !READ_TOOLS.has(tool) && !EDIT_TOOLS.has(tool);
    }
    return true;
}

export function nanoToolCall(id: string, name: string, argumentsJson: string): AppleToolCall {
    if (!NANOGPT_TOOLS.some((entry) => entry.function.name === name)) {
        throw new Error('Unsupported tool requested.');
    }
    const input: unknown = JSON.parse(argumentsJson);
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Invalid tool arguments.');
    }
    const call = AppleFoundationEventSchema.parse({ ...input, type: 'tool.call', id, name });
    if (call.type !== 'tool.call') {
        throw new Error('Invalid tool call.');
    }
    return call;
}

export function executeNanoTool(cwd: string, call: AppleToolCall, signal: AbortSignal, context: AppleToolContext) {
    if (call.name !== 'run_command' || process.platform !== 'win32') {
        return executeAppleTool(cwd, call, signal, context);
    }
    return executeAppleCommand(cwd, call.command, signal, context.env, {
        spawn: (directory, command, env) => {
            const child = Bun.spawn(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command], {
                cwd: directory,
                env,
                stdin: 'ignore',
                stdout: 'pipe',
                stderr: 'pipe',
                windowsHide: true
            });
            return {
                stdout: child.stdout,
                stderr: child.stderr,
                exited: child.exited,
                killGroup: () => {
                    const killer = Bun.spawn(['taskkill.exe', '/pid', String(child.pid), '/T', '/F'], {
                        stdout: 'ignore',
                        stderr: 'ignore',
                        windowsHide: true
                    });
                    void killer.exited;
                }
            };
        }
    });
}
