import type { ReactNode } from 'react';
import { Bot, Eye, FileCode2, FolderSearch, Globe, Hammer, ListTodo, Search, SquarePen, Terminal, Wrench, Zap } from 'lucide-react';

const SIZE = 14;

/* The icon that says what a tool call is about; unknown tools get the wrench. */
export const toolIcon = (name: string): ReactNode => {
    switch (name) {
        case 'Read':
            return <Eye size={SIZE} />;
        case 'Edit':
        case 'Write':
        case 'MultiEdit':
        case 'NotebookEdit':
            return <SquarePen size={SIZE} />;
        case 'Bash':
            return <Terminal size={SIZE} />;
        case 'Grep':
            return <Search size={SIZE} />;
        case 'Glob':
            return <FolderSearch size={SIZE} />;
        case 'WebFetch':
        case 'WebSearch':
            return <Globe size={SIZE} />;
        case 'Task':
        case 'Agent':
            return <Bot size={SIZE} />;
        case 'Skill':
            return <Zap size={SIZE} />;
        case 'TodoWrite':
            return <ListTodo size={SIZE} />;
        default:
            return name.startsWith('mcp__') ? <Hammer size={SIZE} /> : <Wrench size={SIZE} />;
    }
};

export const fileIcon = (): ReactNode => <FileCode2 size={SIZE} />;
