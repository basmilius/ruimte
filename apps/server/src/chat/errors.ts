import { CodedError } from '@ruimte/agents/coded-error';

type ChatErrorCode =
    | 'history-expired'
    | 'chat-not-found'
    | 'chat-busy'
    | 'request-not-found'
    | 'chat-unsupported'
    | 'invalid-attachments'
    | 'subagent-not-found'
    | 'task-not-found'
    // What a fork is refused with.
    | 'turn-not-found'
    | 'turn-running'
    | 'provider-not-installed'
    | 'transcript-missing'
    | 'transcript-format'
    | 'fork-failed'
    | 'not-on-a-canvas'
    | 'canvas-full'
    | 'not-a-repository'
    | 'branch-exists'
    | 'worktree-failed'
    | 'checkpoint-missing'
    // What a summary is refused with.
    | 'not-a-fork'
    | 'original-gone'
    // What a bookmark is refused with.
    | 'item-not-found'
    | 'bookmark-not-found'
    | 'too-many-bookmarks'
    // What going on under another account after a limit is refused with.
    | 'not-limited'
    | 'same-account';

export class ChatError extends CodedError<ChatErrorCode> {}
