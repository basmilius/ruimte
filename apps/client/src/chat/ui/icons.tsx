import type { ReactNode } from 'react';
import { Bot, Eye, FolderSearch, Globe, Hammer, ListTodo, Search, SquarePen, Terminal, Wrench, Zap } from 'lucide-react';
import { Icon } from '@/ui/Icon';

const SIZE = 12;

/* A pending dock draws its mark a step up from the lines of a transcript, at the size a sidebar
   row uses, because it is a thing to answer rather than a thing to read past. */
export const DOCK_ICON_SIZE = 14;

/* The gutter every row in the thread opens with: 16 wide, on the line box of its first row of text,
   so the mark of a tool call, a note and a fold all sit in one column and their labels start at the
   same x. The same box the menu rows and the toasts use. */
export const ROW_GUTTER = 'grid h-5 w-4 shrink-0 place-items-center';

/* The icon that says what a tool call is about; unknown tools get the wrench. */
export const toolIcon = (name: string, size: number = SIZE): ReactNode => {
    switch (name) {
        case 'Read':
            return <Icon icon={Eye} size={size} />;
        case 'Edit':
        case 'Write':
        case 'MultiEdit':
        case 'NotebookEdit':
            return <Icon icon={SquarePen} size={size} />;
        case 'Bash':
            return <Icon icon={Terminal} size={size} />;
        case 'Grep':
            return <Icon icon={Search} size={size} />;
        case 'Glob':
            return <Icon icon={FolderSearch} size={size} />;
        case 'WebFetch':
        case 'WebSearch':
            return <Icon icon={Globe} size={size} />;
        case 'Task':
        case 'Agent':
            return <Icon icon={Bot} size={size} />;
        case 'Skill':
            return <Icon icon={Zap} size={size} />;
        case 'TodoWrite':
            return <Icon icon={ListTodo} size={size} />;
        default:
            return name.startsWith('mcp__') ? <Icon icon={Hammer} size={size} /> : <Icon icon={Wrench} size={size} />;
    }
};
