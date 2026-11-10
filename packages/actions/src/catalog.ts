import { z } from 'zod';
import { AGENTS_ACTIONS } from './catalog/agents.ts';
import { CANVAS_ACTIONS } from './catalog/canvas.ts';
import { COMMUNICATE_ACTIONS } from './catalog/communicate.ts';
import { CONTENT_ACTIONS } from './catalog/content.ts';
import { DEVELOPER_ACTIONS } from './catalog/developer.ts';
import type { ActionActorKind } from './catalog/fields.ts';
import { FILES_ACTIONS } from './catalog/files.ts';
import { LAYOUT_ACTIONS } from './catalog/layout.ts';
import { MACHINE_ACTIONS } from './catalog/machine.ts';
import { PAGES_ACTIONS } from './catalog/pages.ts';
import { PLANS_ACTIONS } from './catalog/plans.ts';
import { PROJECTS_ACTIONS } from './catalog/projects.ts';
import { SESSIONS_ACTIONS } from './catalog/sessions.ts';
import { VIEWS_ACTIONS } from './catalog/views.ts';
import { WORKSPACE_ACTIONS } from './catalog/workspace.ts';

export {
    ACTION_ACTOR_KINDS,
    ActionActorKindSchema,
    ACTION_DOMAINS,
    type ActionDomain,
    ActionViewKindSchema,
    ActionCreatableViewKindSchema,
    ActionCanvasNodeKindSchema,
    ActionCreatableCanvasNodeKindSchema,
    fieldActors,
    ARRANGE_LAYOUTS,
    FILE_READ_MAX_LINES,
    OperationStatusSchema,
    type OperationStatus,
    OPERATION_ACTIONS,
    DATABASE_QUERY_ROWS,
    DATABASE_QUERY_MAX_ROWS,
    type ActionActorKind
} from './catalog/fields.ts';

// One file per domain, in the order of ACTION_DOMAINS, which ACTION_NAMES and every tool list built from it follow.
export const ACTION_DEFINITIONS = {
    ...WORKSPACE_ACTIONS,
    ...VIEWS_ACTIONS,
    ...CANVAS_ACTIONS,
    ...LAYOUT_ACTIONS,
    ...COMMUNICATE_ACTIONS,
    ...SESSIONS_ACTIONS,
    ...PLANS_ACTIONS,
    ...AGENTS_ACTIONS,
    ...PROJECTS_ACTIONS,
    ...DEVELOPER_ACTIONS,
    ...FILES_ACTIONS,
    ...CONTENT_ACTIONS,
    ...PAGES_ACTIONS,
    ...MACHINE_ACTIONS
} as const;

export type ActionName = keyof typeof ACTION_DEFINITIONS;
export const ACTION_NAMES = Object.keys(ACTION_DEFINITIONS) as readonly ActionName[];
export type ActionInput<Name extends ActionName> = z.input<(typeof ACTION_DEFINITIONS)[Name]['input']>;
export type ActionOutput<Name extends ActionName> = z.output<(typeof ACTION_DEFINITIONS)[Name]['output']>;
export type ActionEffect = (typeof ACTION_DEFINITIONS)[ActionName]['effect'];

/* What an action does, in the words for this actor: an agent reaches the daemon's executor, whose rules differ. */
export function actionDescription(name: ActionName, actor: ActionActorKind): string {
    const definition = ACTION_DEFINITIONS[name];
    return actor === 'agent' && 'agentDescription' in definition ? definition.agentDescription : definition.description;
}
