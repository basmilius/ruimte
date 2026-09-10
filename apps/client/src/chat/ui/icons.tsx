import type { ReactNode } from 'react';
import {
    BotIcon,
    EyeIcon,
    FileCodeIcon,
    FolderSearchIcon,
    GlobeIcon,
    HammerIcon,
    ListTodoIcon,
    Search01Icon,
    SquarePenIcon,
    TerminalIcon,
    Wrench01Icon,
    ZapIcon
} from '@hugeicons/core-free-icons';
import { Icon } from '@/ui/Icon';

const SIZE = 14;

/* The icon that says what a tool call is about; unknown tools get the wrench. */
export const toolIcon = (name: string): ReactNode => {
    switch (name) {
        case 'Read':
            return <Icon icon={EyeIcon} size={SIZE} />;
        case 'Edit':
        case 'Write':
        case 'MultiEdit':
        case 'NotebookEdit':
            return <Icon icon={SquarePenIcon} size={SIZE} />;
        case 'Bash':
            return <Icon icon={TerminalIcon} size={SIZE} />;
        case 'Grep':
            return <Icon icon={Search01Icon} size={SIZE} />;
        case 'Glob':
            return <Icon icon={FolderSearchIcon} size={SIZE} />;
        case 'WebFetch':
        case 'WebSearch':
            return <Icon icon={GlobeIcon} size={SIZE} />;
        case 'Task':
        case 'Agent':
            return <Icon icon={BotIcon} size={SIZE} />;
        case 'Skill':
            return <Icon icon={ZapIcon} size={SIZE} />;
        case 'TodoWrite':
            return <Icon icon={ListTodoIcon} size={SIZE} />;
        default:
            return name.startsWith('mcp__') ? <Icon icon={HammerIcon} size={SIZE} /> : <Icon icon={Wrench01Icon} size={SIZE} />;
    }
};

export const fileIcon = (): ReactNode => <Icon icon={FileCodeIcon} size={SIZE} />;
