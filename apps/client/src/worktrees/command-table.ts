import { GitBranch } from 'lucide-react';
import { worktreeChat } from '@/commands/conditions';
import { type CommandSpec } from '@/commands/types';

export const WORKTREE_COMMANDS = {
    'chat-new-worktree': {
        key: 'newChatInWorktree',
        icon: GitBranch,
        palette: true,
        menu: { menu: 'file', group: 'new', order: 30, when: worktreeChat }
    }
} satisfies Record<string, CommandSpec>;
