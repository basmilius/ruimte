import { describe, expect, test } from 'bun:test';
import { EXTENSION_ACTIONS } from '@ruimte/contracts';
import { ACTION_DEFINITIONS, ACTION_NAMES } from './catalog.ts';
import { fieldActors } from './catalog/fields.ts';
import { isPersonOnlyAction, PERSON_ONLY_ACTIONS } from './person-only.ts';

// Written out a second time on purpose: taking an action off the list fails here until this changes too.
const HELD = [
    'view.share',
    'chat.uiChoice',
    'chat.sendNow',
    'chat.answer',
    'chat.dismissQuestion',
    'chat.approve',
    'tool.run',
    'agent.answer',
    'project.close',
    'project.delete',
    'worktree.remove',
    'launch.save',
    'secret.request',
    'computer.answerApproval',
    'computer.apps',
    'computer.state',
    'computer.read',
    'computer.wait',
    'computer.click',
    'computer.type',
    'computer.key',
    'computer.setValue',
    'computer.scroll',
    'computer.menu',
    'computer.drag',
    'computer.open',
    'machine.setIdentity',
    'machine.setNodeSize',
    'machine.setStartFolder',
    'machine.revokeAccess',
    'computer.control',
    'device.control',
    'process.signal'
];

describe('what only a person does', () => {
    test('is the list this test holds, in the order of the catalog', () => {
        expect<readonly string[]>(PERSON_ONLY_ACTIONS).toEqual(HELD);
    });

    test('never names the extension actor, on the action or on one of its fields', () => {
        const open = PERSON_ONLY_ACTIONS.filter((name) => {
            const definition = ACTION_DEFINITIONS[name];
            const fields = Object.values(definition.input.shape as Record<string, unknown>);

            return (definition.actors as readonly string[]).includes('extension') || fields.some((field) => fieldActors(field as never)?.includes('extension'));
        });

        expect(open).toEqual([]);
    });

    test('is nothing the permission table of an extension names', () => {
        expect(Object.keys(EXTENSION_ACTIONS).filter(isPersonOnlyAction)).toEqual([]);
    });

    test('closes every action of a whole domain, also one it gains', () => {
        expect(ACTION_NAMES.filter((name) => /^(computer|machine|tunnel)\./.test(name)).filter((name) => !isPersonOnlyAction(name))).toEqual([]);
        expect(isPersonOnlyAction('tunnel.add')).toBe(true);
        expect(isPersonOnlyAction('machine.rename')).toBe(true);
    });

    test('leaves the actions an extension runs today open', () => {
        expect(isPersonOnlyAction('launch.start')).toBe(false);
        expect(isPersonOnlyAction('device.tap')).toBe(false);
    });
});
