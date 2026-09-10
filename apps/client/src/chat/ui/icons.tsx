import type { ReactNode } from 'react';
import {
    faBolt,
    faEye,
    faFileCode,
    faFolderMagnifyingGlass,
    faGlobe,
    faHammer,
    faListCheck,
    faMagnifyingGlass,
    faPenToSquare,
    faRobot,
    faTerminal,
    faWrench
} from '@fortawesome/pro-regular-svg-icons';
import { Icon } from '@/ui/Icon';

const SIZE = 14;

/* The icon that says what a tool call is about; unknown tools get the wrench. */
export const toolIcon = (name: string): ReactNode => {
    switch (name) {
        case 'Read':
            return <Icon icon={faEye} size={SIZE} />;
        case 'Edit':
        case 'Write':
        case 'MultiEdit':
        case 'NotebookEdit':
            return <Icon icon={faPenToSquare} size={SIZE} />;
        case 'Bash':
            return <Icon icon={faTerminal} size={SIZE} />;
        case 'Grep':
            return <Icon icon={faMagnifyingGlass} size={SIZE} />;
        case 'Glob':
            return <Icon icon={faFolderMagnifyingGlass} size={SIZE} />;
        case 'WebFetch':
        case 'WebSearch':
            return <Icon icon={faGlobe} size={SIZE} />;
        case 'Task':
        case 'Agent':
            return <Icon icon={faRobot} size={SIZE} />;
        case 'Skill':
            return <Icon icon={faBolt} size={SIZE} />;
        case 'TodoWrite':
            return <Icon icon={faListCheck} size={SIZE} />;
        default:
            return name.startsWith('mcp__') ? <Icon icon={faHammer} size={SIZE} /> : <Icon icon={faWrench} size={SIZE} />;
    }
};

export const fileIcon = (): ReactNode => <Icon icon={faFileCode} size={SIZE} />;
