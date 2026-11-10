import { Layers } from 'lucide-react';
import type { GeneratedCommands } from '@/commands/generated';
import { showView, viewAtIndex } from '@/project/views';
import { GO_VIEW_PREFIX } from '@/views/menu-extras';

/* The menu's rows that go to one view each, kept apart so the start screen's chunk holds no command of a workspace. */
export const VIEW_GENERATED: readonly GeneratedCommands[] = [
    {
        prefix: GO_VIEW_PREFIX,
        usage: 'goView',
        palette: false,
        icon: Layers,
        run: (rest) => {
            const view = viewAtIndex(Number(rest));
            if (view) {
                showView(view.id);
            }
        }
    }
];
