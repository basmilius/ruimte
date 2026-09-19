import type { ReactNode } from 'react';
import { Hammer, Wrench } from 'lucide-react';
import { toolEntry } from '@/chat/logic/tool-catalog';
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
    const known = toolEntry(name);
    if (known !== undefined) {
        return <Icon icon={known.icon} size={size} />;
    }
    return name.startsWith('mcp__') ? <Icon icon={Hammer} size={size} /> : <Icon icon={Wrench} size={size} />;
};
