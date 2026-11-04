import { z } from 'zod';
import { AGENT_ACTIONS } from './catalog/agents.ts';
import { CONTENT_ACTIONS } from './catalog/content.ts';
import { CONTROL_ACTIONS } from './catalog/control.ts';
import { DEVELOPER_ACTIONS } from './catalog/developer.ts';
import type { ActionActorKind } from './catalog/fields.ts';
import { GIT_ACTIONS } from './catalog/git.ts';
import { LAUNCH_ACTIONS } from './catalog/launches.ts';
import { PLAN_ACTIONS } from './catalog/plans.ts';
import { SESSION_ACTIONS } from './catalog/sessions.ts';
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

// The areas keep the order the actions had in one list, which ACTION_NAMES and every tool list built from it follow.
export const ACTION_DEFINITIONS = {
    ...WORKSPACE_ACTIONS,
    ...SESSION_ACTIONS,
    ...PLAN_ACTIONS,
    ...CONTROL_ACTIONS,
    ...AGENT_ACTIONS,
    ...GIT_ACTIONS,
    ...LAUNCH_ACTIONS,
    ...CONTENT_ACTIONS,
    ...DEVELOPER_ACTIONS
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
