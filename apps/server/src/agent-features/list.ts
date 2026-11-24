import type { CanvasHost } from '../canvas/host.ts';
import { agentFeature } from './agent.ts';
import { alertFeature } from './alert.ts';
import { artifactFeature } from './artifact.ts';
import { browserFeature } from './browser.ts';
import { canvasFeature } from './canvas.ts';
import { chatFeature } from './chat.ts';
import { computerFeature } from './computer.ts';
import { contextFeature } from './context.ts';
import { databaseFeature } from './database.ts';
import { deviceFeature } from './device.ts';
import { toolkitsOf, type ComposedHost } from './feature.ts';
import { flagFeature } from './flag.ts';
import { languageFeature } from './language.ts';
import { launchFeature } from './launch.ts';
import { linkFeature } from './link.ts';
import { nodeFeature } from './node.ts';
import { notifyFeature } from './notify.ts';
import { operationFeature } from './operation.ts';
import { planFeature } from './plan.ts';
import { projectFeature } from './project.ts';
import { providerFeature } from './provider.ts';
import { routineFeature } from './routine.ts';
import { secretFeature } from './secret.ts';
import { taskFeature } from './task.ts';
import { templateFeature } from './template.ts';
import { toolFeature } from './tool.ts';
import { tunnelFeature } from './tunnel.ts';
import { uiFeature } from './ui.ts';
import { viewFeature } from './view.ts';
import { visualFeature } from './visual.ts';
import { voiceFeature } from './voice.ts';
import { worktreeFeature } from './worktree.ts';

/*
 * Every feature an agent has, in one list: the daemon's tools (in this order), its actions and the host
 * they reach the daemon through are all read from it. A new feature is a file in this folder and a line here.
 */
export const AGENT_FEATURES = [
    canvasFeature,
    nodeFeature,
    linkFeature,
    viewFeature,
    databaseFeature,
    languageFeature,
    operationFeature,
    worktreeFeature,
    launchFeature,
    routineFeature,
    projectFeature,
    templateFeature,
    providerFeature,
    contextFeature,
    taskFeature,
    notifyFeature,
    alertFeature,
    agentFeature,
    flagFeature,
    browserFeature,
    tunnelFeature,
    chatFeature,
    planFeature,
    toolFeature,
    deviceFeature,
    computerFeature,
    visualFeature,
    artifactFeature,
    uiFeature,
    secretFeature,
    voiceFeature
] as const;

type MustFillHost<Filled extends CanvasHost> = Filled;

/* Fails to compile when a field the host must have is filled by no feature. */
export type FilledHost = MustFillHost<ComposedHost<typeof AGENT_FEATURES>>;

/* The toolkits of the features, which the catalog is built from. */
export const AGENT_TOOLKITS = toolkitsOf(AGENT_FEATURES);
