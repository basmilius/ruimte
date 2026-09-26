import { ChatError as AgentChatError, type ChatErrorCode } from '@ruimte/agents/chat/errors';

type RuimteChatErrorCode =
    | ChatErrorCode
    // What a fork is refused with.
    | 'turn-not-found'
    | 'turn-running'
    | 'provider-not-installed'
    | 'not-on-a-canvas'
    | 'canvas-full'
    | 'not-a-repository'
    | 'branch-exists'
    | 'worktree-failed'
    | 'checkpoint-missing'
    // What a summary is refused with.
    | 'not-a-fork'
    | 'original-gone'
    // What going on under another account after a limit is refused with.
    | 'not-limited'
    | 'same-account';

export class ChatError extends AgentChatError<RuimteChatErrorCode> {}
