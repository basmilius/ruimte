import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ToolRefusal } from '@adecore/agents/context';
import { DESIGN_FOLDERS, designFolderOf, freeDesignFolder, type ProjectView } from '@ruimte/contracts';

/* What of an `agent_start` call decides whether `design` may come along. */
export interface DesignStart {
    terminal: boolean;
    view: boolean;
    beside: boolean;
    group: boolean;
    machine: boolean;
    task: boolean;
    /* Whether the agent stays off every canvas, which only a chat view's start does. */
    hidden: boolean;
    /* Whether the CLI runs as a chat here. */
    chat: boolean;
}

/* Refuses `design` on any start but a hidden chat agent with a task on this machine. */
export function refuseDesignStart(start: DesignStart): void {
    if (start.terminal || !start.chat) {
        throw new ToolRefusal(
            'design-needs-chat',
            'design makes a chat agent the designer, whose last answer names its pages; leave out terminal and pick a cli with a chat'
        );
    }

    const placing = (['view', 'beside', 'group'] as const).filter((field) => start[field]);

    if (placing.length > 0) {
        throw new ToolRefusal('design-off-canvas', `design starts a hidden agent, which stands on no canvas; leave out ${placing.join(' and ')}`);
    }

    if (start.machine) {
        throw new ToolRefusal('design-here', 'design works in a folder of this project on this machine; leave out machine');
    }

    if (!start.task) {
        throw new ToolRefusal('design-needs-task', 'design gives the agent a task, whose result names its pages; add task and prompt');
    }

    if (!start.hidden) {
        throw new ToolRefusal('design-off-canvas', 'design starts a hidden agent, which only a chat view opens; from a canvas, start the agent without design');
    }
}

/* The folders of designs on disk on both sides, which a removed design leaves behind; none for a side that is not there. */
async function designFoldersOnDisk(projectFolder: string): Promise<string[]> {
    const sides = await Promise.all(
        DESIGN_FOLDERS.map((side) =>
            readdir(join(projectFolder, side), { withFileTypes: true }).then(
                (entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
                () => []
            )
        )
    );

    return sides.flat();
}

/*
 * The folder, relative to the project folder, a hidden design agent works in: a private design folder
 * named after its task that no design of the project, no other design agent and nothing on disk has.
 */
export async function freeAgentDesignFolder(
    projectFolder: string,
    views: readonly ProjectView[],
    agentFolders: readonly string[],
    name: string
): Promise<string> {
    const onDisk = await designFoldersOnDisk(projectFolder);
    const taken = agentFolders.map((folder) => folder.split('/').at(-1) ?? folder);

    return designFolderOf({ path: freeDesignFolder(views, name, [...onDisk, ...taken]) }, false);
}
