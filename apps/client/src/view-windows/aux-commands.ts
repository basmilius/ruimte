import { CANVAS_COMMANDS } from '@/canvas/command-table';
import { CHAT_COMMANDS } from '@/chat/command-table';
import type { CommandRelay } from '@/commands/behavior';
import { generatedOf } from '@/commands/generated';
import { GRID_COMMANDS } from '@/commands/grid-command-table';
import { isCommandId } from '@/commands/registry';
import { desktop } from '@/desktop/bridge';
import { DIAGRAM_COMMANDS } from '@/diagram/command-table';
import { DICTATION_COMMANDS } from '@/dictation/command-table';
import { DRAWING_COMMANDS } from '@/drawing/command-table';
import { FIND_COMMANDS } from '@/find/command-table';
import { LANGUAGE_AND_EDITOR_COMMANDS } from '@/language/command-specs';
import { TERMINAL_COMMANDS } from '@/terminal/command-table';
import { VIEW_WINDOW_COMMANDS } from './command-table';
import { projectKey, tellWindow } from './messages';

/*
 * An auxiliary window runs the commands about its grid and about what stands in a cell. Every other
 * command is about the project, whose lists, panels, settings and dialogs only the window that has it draws.
 */
const HERE = new Set<string>([
    ...[
        GRID_COMMANDS,
        CANVAS_COMMANDS,
        CHAT_COMMANDS,
        TERMINAL_COMMANDS,
        LANGUAGE_AND_EDITOR_COMMANDS,
        DRAWING_COMMANDS,
        DIAGRAM_COMMANDS,
        FIND_COMMANDS,
        DICTATION_COMMANDS,
        VIEW_WINDOW_COMMANDS
    ].flatMap((table) => Object.keys(table)),
    'palette',
    'fullscreen',
    'theme',
    'window-new',
    'find-in-files',
    'open-file-at-line'
]);

/* About the frame of the window that has the project, so they do nothing when given from another window. */
const DROPPED = new Set(['sidebar', 'panel-toggle', 'window-move', 'project-tab-move-left', 'project-tab-move-right']);

export const AUX_COMMAND_RELAY: CommandRelay = {
    placeOf(id) {
        if (DROPPED.has(id)) {
            return 'dropped';
        }

        if (isCommandId(id)) {
            return HERE.has(id) ? 'here' : 'relayed';
        }

        // A generated row (an agent, a launch, a layout) starts something in the project. Any other id is the palette's own.
        return generatedOf(id) === undefined ? 'here' : 'relayed';
    },
    relay(id) {
        const project = projectKey();

        if (project === null) {
            return;
        }

        desktop()?.openWindow?.(project);
        tellWindow(project, { type: 'run', command: id });
    }
};
