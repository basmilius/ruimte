import { AGENT_GENERATED } from '@/agents/generated-commands';
import { AGENT_MENU_EXTRAS } from '@/agents/menu-extras';
import { agentFacts } from '@/agents/menu-facts';
import { ATTENTION_COMMANDS } from '@/attention/command-table';
import { attentionFacts } from '@/attention/menu-facts';
import { CANVAS_COMMANDS } from '@/canvas/command-table';
import { CANVAS_GENERATED } from '@/canvas/generated-commands';
import { CANVAS_MENU_EXTRAS } from '@/canvas/menu-extras';
import { canvasFacts } from '@/canvas/menu-facts';
import { CHAT_COMMANDS } from '@/chat/command-table';
import { CHAT_GENERATED } from '@/chat/generated-commands';
import { CHAT_MENU_EXTRAS } from '@/chat/menu-extras';
import { chatFacts } from '@/chat/menu-facts';
import { registerBehaviors } from '@/commands/behavior';
import { registerGenerated } from '@/commands/generated';
import { GRID_COMMANDS } from '@/commands/grid-command-table';
import { registerMenuExtras } from '@/commands/menu-extras';
import { registerMenuFacts } from '@/commands/menu-facts';
import { registerCommands } from '@/commands/registry';
import { WINDOW_COMMANDS } from '@/commands/window-command-table';
import { DATABASE_COMMANDS } from '@/database/command-table';
import { DEVICE_COMMANDS } from '@/devices/command-table';
import { DIAGRAM_COMMANDS } from '@/diagram/command-table';
import { DICTATION_COMMANDS } from '@/dictation/command-table';
import { DRAWING_COMMANDS } from '@/drawing/command-table';
import { FILE_COMMANDS } from '@/files/command-table';
import { fileFacts } from '@/files/menu-facts';
import { FIND_COMMANDS } from '@/find/command-table';
import { GIT_COMMANDS } from '@/git/command-table';
import { GITHUB_COMMANDS } from '@/github/command-table';
import { GITHUB_GENERATED } from '@/github/generated-commands';
import { GITHUB_MENU_EXTRAS } from '@/github/menu-extras';
import { githubFacts } from '@/github/menu-facts';
import { LANGUAGE_AND_EDITOR_COMMANDS } from '@/language/command-specs';
import { languageFacts } from '@/language/menu-facts';
import { PROBLEMS_COMMANDS } from '@/language/problems-command-table';
import { LAUNCH_COMMANDS } from '@/launches/command-table';
import { LAUNCH_GENERATED } from '@/launches/generated-commands';
import { LAUNCH_MENU_EXTRAS } from '@/launches/menu-extras';
import { launchFacts } from '@/launches/menu-facts';
import { MEASURE_COMMANDS } from '@/measure/command-table';
import { MEASURE_BEHAVIORS } from '@/measure/commands';
import { OUTPUT_COMMANDS } from '@/output/command-table';
import { PROCESS_COMMANDS } from '@/processes/command-table';
import { ROUTINE_COMMANDS } from '@/routines/command-table';
import { routineFacts } from '@/routines/menu-facts';
import { WINDOW_BEHAVIORS } from '@/shell/window-commands';
import { TERMINAL_COMMANDS } from '@/terminal/command-table';
import { terminalFacts } from '@/terminal/menu-facts';
import { VIEW_COMMANDS } from '@/views/command-table';
import { VIEW_GENERATED } from '@/views/generated-commands';
import { VIEW_MENU_EXTRAS } from '@/views/menu-extras';
import { viewFacts } from '@/views/menu-facts';
import { VOICE_COMMANDS } from '@/voice/command-table';
import { WORKTREE_COMMANDS } from '@/worktrees/command-table';

/*
 * What the window and the menu need of the commands before any workspace opens: every row of the table with
 * its place, the facts and extra rows of the menu, the generated kinds and what the window's own commands do.
 * A new feature adds its lines here; a new command of a feature that is here adds nothing.
 */
export function installCommands(): void {
    registerCommands(WINDOW_COMMANDS);
    registerCommands(GRID_COMMANDS);
    registerCommands(CHAT_COMMANDS);
    registerCommands(VIEW_COMMANDS);
    registerCommands(FILE_COMMANDS);
    registerCommands(DATABASE_COMMANDS);
    registerCommands(CANVAS_COMMANDS);
    registerCommands(FIND_COMMANDS);
    registerCommands(GITHUB_COMMANDS);
    registerCommands(GIT_COMMANDS);
    registerCommands(DEVICE_COMMANDS);
    registerCommands(OUTPUT_COMMANDS);
    registerCommands(ROUTINE_COMMANDS);
    registerCommands(WORKTREE_COMMANDS);
    registerCommands(PROCESS_COMMANDS);
    registerCommands(PROBLEMS_COMMANDS);
    registerCommands(LAUNCH_COMMANDS);
    registerCommands(ATTENTION_COMMANDS);
    registerCommands(TERMINAL_COMMANDS);
    registerCommands(DRAWING_COMMANDS);
    registerCommands(DIAGRAM_COMMANDS);
    registerCommands(MEASURE_COMMANDS);
    registerCommands(VOICE_COMMANDS);
    registerCommands(DICTATION_COMMANDS);
    registerCommands(LANGUAGE_AND_EDITOR_COMMANDS);

    registerMenuFacts(
        agentFacts,
        attentionFacts,
        canvasFacts,
        chatFacts,
        fileFacts,
        githubFacts,
        languageFacts,
        launchFacts,
        routineFacts,
        terminalFacts,
        viewFacts
    );
    registerMenuExtras(...AGENT_MENU_EXTRAS, ...CANVAS_MENU_EXTRAS, ...CHAT_MENU_EXTRAS, ...GITHUB_MENU_EXTRAS, ...LAUNCH_MENU_EXTRAS, ...VIEW_MENU_EXTRAS);
    registerGenerated(...AGENT_GENERATED, ...CANVAS_GENERATED, ...CHAT_GENERATED, ...GITHUB_GENERATED, ...LAUNCH_GENERATED, ...VIEW_GENERATED);
    registerBehaviors(WINDOW_BEHAVIORS);
    // Offered on the start screen too, as main did; what they run loads on first use.
    registerBehaviors(MEASURE_BEHAVIORS);
}
