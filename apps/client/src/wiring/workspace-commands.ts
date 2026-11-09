import { agentPaletteRows } from '@/agents/commands';
import { ATTENTION_BEHAVIORS } from '@/attention/commands';
import { BROWSER_KEY_HANDLERS } from '@/browser/browser-keys';
import { CANVAS_BEHAVIORS, layoutPaletteRows, nodeMovePaletteRows } from '@/canvas/commands';
import { CANVAS_KEY_HANDLERS, canvasKeys, gapKeys } from '@/canvas/workspace-keys';
import { CHAT_BEHAVIORS, CHAT_KEY_HANDLERS } from '@/chat/commands';
import { chatKeys } from '@/chat/workspace-keys';
import { clearKeyHandlers, registerBehaviors, registerCanvasKeyHandlers, registerKeyHandlers } from '@/commands/behavior';
import { clearPaletteRows, registerPaletteRows } from '@/commands/palette-rows';
import { clearWorkspaceKeys, registerWorkspaceKeys } from '@/commands/workspace-keys';
import { DATABASE_BEHAVIORS } from '@/database/commands';
import { DEVICE_BEHAVIORS } from '@/devices/commands';
import { DIAGRAM_BEHAVIORS } from '@/diagram/commands';
import { dictationKeys } from '@/dictation/workspace-keys';
import { DRAWING_BEHAVIORS } from '@/drawing/commands';
import { FILE_BEHAVIORS } from '@/files/commands';
import { FIND_BEHAVIORS } from '@/find/commands';
import { GIT_BEHAVIORS } from '@/git/commands';
import { GITHUB_BEHAVIORS, githubPaletteRows } from '@/github/commands';
import { languagePaletteRows } from '@/language/commands';
import { PROBLEMS_BEHAVIORS } from '@/language/problems-commands';
import { afterSettlePaletteRows, LAUNCH_BEHAVIORS, launchPaletteRows } from '@/launches/commands';
import { MEASURE_BEHAVIORS } from '@/measure/commands';
import { OUTPUT_BEHAVIORS } from '@/output/commands';
import { PROCESS_BEHAVIORS } from '@/processes/commands';
import { ROUTINE_BEHAVIORS } from '@/routines/commands';
import { GRID_BEHAVIORS } from '@/shell/grid-commands';
import { sidebarKeys } from '@/sidebar/workspace-keys';
import { TERMINAL_BEHAVIORS } from '@/terminal/commands';
import { VIEW_BEHAVIORS, VIEW_KEY_HANDLERS } from '@/views/commands';
import { voiceKeys } from '@/voice/workspace-keys';
import { WORKTREE_BEHAVIORS } from '@/worktrees/commands';

/*
 * What the commands of a workspace do, who answers its keys and which rows its palette makes; loaded with the workspace's chunk.
 *
 * When a command module changes, Vite runs this wiring again against registries that still hold the first run, and only its
 * dev page has `import.meta.hot`. There a behavior takes the place of the one before it, and the lists only this function
 * fills start empty. A build and the tests still throw on a behavior twice. `replacing` is the seam for a test.
 */
export function installWorkspaceCommands(replacing: boolean = import.meta.hot !== undefined): void {
    if (replacing) {
        clearKeyHandlers();
        clearPaletteRows();
        clearWorkspaceKeys();
    }

    for (const table of [
        ATTENTION_BEHAVIORS,
        CANVAS_BEHAVIORS,
        CHAT_BEHAVIORS,
        DATABASE_BEHAVIORS,
        DEVICE_BEHAVIORS,
        DIAGRAM_BEHAVIORS,
        DRAWING_BEHAVIORS,
        FILE_BEHAVIORS,
        FIND_BEHAVIORS,
        GIT_BEHAVIORS,
        GITHUB_BEHAVIORS,
        GRID_BEHAVIORS,
        LAUNCH_BEHAVIORS,
        MEASURE_BEHAVIORS,
        OUTPUT_BEHAVIORS,
        PROBLEMS_BEHAVIORS,
        PROCESS_BEHAVIORS,
        ROUTINE_BEHAVIORS,
        TERMINAL_BEHAVIORS,
        VIEW_BEHAVIORS,
        WORKTREE_BEHAVIORS
    ]) {
        registerBehaviors(table, replacing);
    }

    registerPaletteRows({
        'pull-requests': githubPaletteRows,
        language: languagePaletteRows,
        agents: agentPaletteRows,
        'node-moves': nodeMovePaletteRows,
        layouts: layoutPaletteRows,
        launches: launchPaletteRows,
        'after-settle': afterSettlePaletteRows
    });
    registerKeyHandlers(...VIEW_KEY_HANDLERS, ...BROWSER_KEY_HANDLERS, ...CHAT_KEY_HANDLERS);
    registerCanvasKeyHandlers(...CANVAS_KEY_HANDLERS);
    // Held and released keys in the order they must hear a press: the voice and dictation keys before Escape steps out of anything.
    registerWorkspaceKeys(gapKeys, voiceKeys, dictationKeys, canvasKeys, sidebarKeys, chatKeys);
}
