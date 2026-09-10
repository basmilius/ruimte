import type { ReactNode } from 'react';
import { Bot, Eye, FileCode, FolderSearch, Globe, Hammer, ListTodo, Search, SquarePen, Terminal, Wrench, Zap } from 'lucide-react';
import { Icon } from '@/ui/Icon';

const SIZE = 12;

/* The icon that says what a tool call is about; unknown tools get the wrench. */
export const toolIcon = (name: string): ReactNode => {
    switch (name) {
        case 'Read':
            return <Icon icon={Eye} size={SIZE} />;
        case 'Edit':
        case 'Write':
        case 'MultiEdit':
        case 'NotebookEdit':
            return <Icon icon={SquarePen} size={SIZE} />;
        case 'Bash':
            return <Icon icon={Terminal} size={SIZE} />;
        case 'Grep':
            return <Icon icon={Search} size={SIZE} />;
        case 'Glob':
            return <Icon icon={FolderSearch} size={SIZE} />;
        case 'WebFetch':
        case 'WebSearch':
            return <Icon icon={Globe} size={SIZE} />;
        case 'Task':
        case 'Agent':
            return <Icon icon={Bot} size={SIZE} />;
        case 'Skill':
            return <Icon icon={Zap} size={SIZE} />;
        case 'TodoWrite':
            return <Icon icon={ListTodo} size={SIZE} />;
        default:
            return name.startsWith('mcp__') ? <Icon icon={Hammer} size={SIZE} /> : <Icon icon={Wrench} size={SIZE} />;
    }
};

export const fileIcon = (): ReactNode => <Icon icon={FileCode} size={SIZE} />;
