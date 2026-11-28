import { ACTION_NAMES, type ActionName } from './catalog.ts';

/*
 * What stays a person's, whatever permission an extension asks for: no action here ever names the `extension` actor.
 * Every other action is weighed for an extension and opens one at a time, by adding the actor after a look at its
 * handler and fields. A whole domain is here by its prefix, so an action it gains is closed from its first day.
 */
const PERSON_ONLY_DOMAINS: readonly string[] = [
    // Operating another app has permissions of its own, per app.
    'computer.',
    // Account, identity and who may reach the machine.
    'machine.',
    'tunnel.'
];

const PERSON_ONLY_NAMES: readonly ActionName[] = [
    // An agent's approval or question is answered by the person it asks.
    'chat.approve',
    'chat.answer',
    'chat.dismissQuestion',
    'chat.uiChoice',
    'agent.answer',
    // Cuts into a turn that is running.
    'chat.sendNow',
    // Saving a launch approves its command.
    'launch.save',
    'view.share',
    'project.close',
    'project.delete',
    'worktree.remove',
    'process.signal',
    'secret.request',
    // Has another extension work under its own permissions.
    'tool.run',
    // The person's own hand on a device an agent operates.
    'device.control'
];

export function isPersonOnlyAction(name: string): boolean {
    return (PERSON_ONLY_NAMES as readonly string[]).includes(name) || PERSON_ONLY_DOMAINS.some((prefix) => name.startsWith(prefix));
}

/* Every action of the catalog an extension never runs. */
export const PERSON_ONLY_ACTIONS: readonly ActionName[] = ACTION_NAMES.filter(isPersonOnlyAction);
