import type { ApiToolCall, ChatFileChange, RuntimeMode } from '@ruimte/contracts';
import { executeApiCommand } from './api-command-tool.ts';
import { executeApiFileTool } from './api-file-tools.ts';

export type { ApiToolCall } from '@ruimte/contracts';

export const API_TOOL_NAMES = {
    list_files: 'ListFiles',
    read_file: 'Read',
    search_files: 'Grep',
    edit_file: 'Edit',
    write_file: 'Write',
    run_command: 'Bash',
    web_search: 'WebSearch',
    fetch_page: 'WebFetch',
    mcp_list_tools: 'MCPListTools',
    mcp_call: 'MCPCall',
    ask_user: 'AskUserQuestion'
} as const satisfies Record<ApiToolCall['name'], string>;

export function apiToolInput(call: ApiToolCall): Record<string, unknown> {
    const { type: _type, id: _id, name: _name, ...input } = call;
    switch (call.name) {
        case 'read_file':
            return { file_path: call.path, offset: call.offset, ...(call.limit === undefined ? {} : { limit: call.limit }) };
        case 'edit_file':
            return { file_path: call.path, old_string: call.oldText, new_string: call.newText };
        case 'write_file':
            return { file_path: call.path, content: call.content };
        case 'search_files':
            return { path: call.path, pattern: call.query, ...(call.glob === undefined ? {} : { glob: call.glob }) };
        default:
            return input;
    }
}

/* The card an `ask_user` call puts in the thread, one question with its options as choices. */
export function askUserCard(id: string, call: Extract<ApiToolCall, { name: 'ask_user' }>) {
    return {
        type: 'question.requested' as const,
        requestId: id,
        questions: [
            { id, header: 'Question', question: call.question, choices: (call.options ?? []).map((label) => ({ label, description: '' })), multiSelect: false }
        ]
    };
}

export interface ApiToolContext {
    env: Record<string, string>;
    home: string;
    runtimeMode?: RuntimeMode;
}

export interface ApiToolResult {
    output: string;
    failed: boolean;
    // Only validation failures before any side effect may let the model correct its input.
    recoverable?: boolean;
    changes?: ChatFileChange[];
}

export async function executeApiTool(cwd: string, call: ApiToolCall, signal?: AbortSignal, context?: ApiToolContext): Promise<ApiToolResult> {
    try {
        signal?.throwIfAborted();
        let result: ApiToolResult;
        switch (call.name) {
            case 'list_files':
            case 'read_file':
            case 'search_files':
            case 'edit_file':
            case 'write_file':
                result = await executeApiFileTool(cwd, call, signal);
                break;
            case 'run_command':
                result = await executeApiCommand(cwd, call.command, signal, context?.env);
                break;
            case 'web_search':
            case 'fetch_page':
            case 'mcp_list_tools':
            case 'mcp_call': {
                const { executeApiNetworkTool } = await import('./api-network-tools.ts');
                result = await executeApiNetworkTool(cwd, call, signal, context);
                break;
            }
            case 'ask_user':
                throw new Error('Questions must be answered through the chat question card.');
        }
        signal?.throwIfAborted();
        return result;
    } catch (error) {
        signal?.throwIfAborted();
        const message = error instanceof Error && !('code' in error) ? error.message : 'The requested local tool could not complete.';
        return { output: `Tool failed: ${message}`, failed: true };
    }
}
