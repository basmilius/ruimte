import { agentPaletteRows } from '@/agents/commands';
import { ATTENTION_BEHAVIORS } from '@/attention/commands';
import { CANVAS_BEHAVIORS, canvasPaletteRows } from '@/canvas/commands';
import { CANVAS_KEY_HANDLERS, canvasKeys, gapKeys } from '@/canvas/workspace-keys';
import { CHAT_BEHAVIORS, CHAT_KEY_HANDLERS } from '@/chat/commands';
import { chatKeys } from '@/chat/workspace-keys';
import { registerBehaviors, registerCanvasKeyHandlers, registerKeyHandlers } from '@/commands/behavior';
import { registerPaletteRows } from '@/commands/palette-rows';
import { registerWorkspaceKeys } from '@/commands/workspace-keys';
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
import { LAUNCH_BEHAVIORS, launchPaletteRows } from '@/launches/commands';
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

/* What the commands of a workspace do, who answers its keys and which rows its palette makes; loaded with the workspace's chunk. */
export function installWorkspaceCommands(): void {
    registerBehaviors(ATTENTION_BEHAVIORS);
    registerBehaviors(CANVAS_BEHAVIORS);
    registerBehaviors(CHAT_BEHAVIORS);
    registerBehaviors(DATABASE_BEHAVIORS);
    registerBehaviors(DEVICE_BEHAVIORS);
    registerBehaviors(DIAGRAM_BEHAVIORS);
    registerBehaviors(DRAWING_BEHAVIORS);
    registerBehaviors(FILE_BEHAVIORS);
    registerBehaviors(FIND_BEHAVIORS);
    registerBehaviors(GIT_BEHAVIORS);
    registerBehaviors(GITHUB_BEHAVIORS);
    registerBehaviors(GRID_BEHAVIORS);
    registerBehaviors(LAUNCH_BEHAVIORS);
    registerBehaviors(MEASURE_BEHAVIORS);
    registerBehaviors(OUTPUT_BEHAVIORS);
    registerBehaviors(PROBLEMS_BEHAVIORS);
    registerBehaviors(PROCESS_BEHAVIORS);
    registerBehaviors(ROUTINE_BEHAVIORS);
    registerBehaviors(TERMINAL_BEHAVIORS);
    registerBehaviors(VIEW_BEHAVIORS);
    registerBehaviors(WORKTREE_BEHAVIORS);

    registerPaletteRows(agentPaletteRows, canvasPaletteRows, githubPaletteRows, languagePaletteRows, launchPaletteRows);
    registerKeyHandlers(...VIEW_KEY_HANDLERS, ...CHAT_KEY_HANDLERS);
    registerCanvasKeyHandlers(...CANVAS_KEY_HANDLERS);
    // Held and released keys in the order they must hear a press: the voice and dictation keys before Escape steps out of anything.
    registerWorkspaceKeys(gapKeys, voiceKeys, dictationKeys, canvasKeys, sidebarKeys, chatKeys);
}
