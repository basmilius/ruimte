import { agentToolkit } from './agent-tools.ts';
import { alertToolkit } from './alert-tools.ts';
import { artifactToolkit } from './artifact-tools.ts';
import { browserToolkit } from './browser-tools.ts';
import { chatToolkit } from './chat-tools.ts';
import { computerToolkit } from './computer-tools.ts';
import { contextToolkit } from './context-tools.ts';
import { databaseToolkit } from './database-tools.ts';
import { deviceToolkit } from './device-tools.ts';
import { flagToolkit } from './flag-tools.ts';
import { languageToolkit } from './language-tools.ts';
import { launchToolkit } from './launch-tools.ts';
import { linkToolkit } from './link-tools.ts';
import { nodeToolkit } from './node-tools.ts';
import { notifyToolkit } from './notify-tools.ts';
import { operationToolkit } from './operation-tools.ts';
import { planToolkit } from './plan-tools.ts';
import { projectToolkit } from './project-tools.ts';
import { providerToolkit } from './provider-tools.ts';
import { routineToolkit } from './routine-tools.ts';
import { secretToolkit } from './secret-tools.ts';
import { taskToolkit } from './task-tools.ts';
import { templateToolkit } from './template-tools.ts';
import { toolToolkit } from './tool-tools.ts';
import type { Toolkit } from './tool.ts';
import { uiToolkit } from './ui-tools.ts';
import { viewToolkit } from './view-tools.ts';
import { visualToolkit } from './visual-tools.ts';
import { worktreeToolkit } from './worktree-tools.ts';

/* Every toolkit an agent's tools come from, in the order the catalog serves them. */
export const TOOLKITS: readonly Toolkit[] = [
    nodeToolkit,
    linkToolkit,
    viewToolkit,
    databaseToolkit,
    languageToolkit,
    operationToolkit,
    worktreeToolkit,
    launchToolkit,
    routineToolkit,
    projectToolkit,
    templateToolkit,
    providerToolkit,
    contextToolkit,
    taskToolkit,
    notifyToolkit,
    alertToolkit,
    agentToolkit,
    flagToolkit,
    browserToolkit,
    chatToolkit,
    planToolkit,
    toolToolkit,
    deviceToolkit,
    computerToolkit,
    visualToolkit,
    artifactToolkit,
    uiToolkit,
    secretToolkit
];
