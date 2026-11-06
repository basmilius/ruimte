import { DATABASES_PANEL } from '@/database/panel';
import { DEVICES_PANEL } from '@/devices/panel';
import { FILES_PANEL } from '@/files/panel';
import { GIT_PANEL } from '@/git/panel';
import { PROBLEMS_PANEL } from '@/language/problems-panel';
import { LAUNCHES_PANEL } from '@/launches/panel';
import { OUTPUT_PANEL } from '@/output/panel';
import { PROCESSES_PANEL } from '@/processes/panel';
import { panelRegistry } from '@/registry/panels';
import { VOICE_PANEL } from '@/voice/panel';

/*
 * The panels of the side column, in the order their buttons sit in the toolbar. A panel without a button
 * opens elsewhere: Processes and Problems from the Window menu, Launches from the launch chip, and Voice
 * Control beside the palette's button.
 */
export function installPanels(): void {
    panelRegistry.add(FILES_PANEL, GIT_PANEL, DATABASES_PANEL, DEVICES_PANEL, OUTPUT_PANEL, PROCESSES_PANEL, LAUNCHES_PANEL, PROBLEMS_PANEL, VOICE_PANEL);
}
