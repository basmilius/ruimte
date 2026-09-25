import type { AppleFoundationEvent, ChatFileChange, RuntimeMode } from '@ruimte/contracts';
import { executeAppleFileTool } from './apple-file-tools.ts';
import { executeAppleCommand } from './apple-command-tool.ts';

export type AppleToolCall = Extract<AppleFoundationEvent, { type: 'tool.call' }>;

// The private helper protocol stays stable across independently restarted helpers and servers.
export const APPLE_TOOL_NAMES = {
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
} as const satisfies Record<AppleToolCall['name'], string>;

export const appleToolInput = (call: AppleToolCall): Record<string, unknown> => {
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
};

export interface AppleToolContext {
    env: Record<string, string>;
    home: string;
    runtimeMode?: RuntimeMode;
}

export interface AppleToolResult {
    output: string;
    failed: boolean;
    // Only validation failures before any side effect may let the model correct its input.
    recoverable?: boolean;
    changes?: ChatFileChange[];
}

export const executeAppleTool = async (cwd: string, call: AppleToolCall, signal?: AbortSignal, context?: AppleToolContext): Promise<AppleToolResult> => {
    try {
        signal?.throwIfAborted();
        let result: AppleToolResult;
        switch (call.name) {
            case 'list_files':
            case 'read_file':
            case 'search_files':
            case 'edit_file':
            case 'write_file':
                result = await executeAppleFileTool(cwd, call, signal);
                break;
            case 'run_command':
                result = await executeAppleCommand(cwd, call.command, signal, context?.env);
                break;
            case 'web_search':
            case 'fetch_page':
            case 'mcp_list_tools':
            case 'mcp_call': {
                const { executeAppleNetworkTool } = await import('./apple-network-tools.ts');
                result = await executeAppleNetworkTool(cwd, call, signal, context);
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
};
