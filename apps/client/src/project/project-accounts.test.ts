import { describe, expect, test } from 'bun:test';
import { choiceAfter } from './project-accounts';

describe("a project's choice of accounts", () => {
    test('turns an account off and on again', () => {
        expect(choiceAfter(undefined, { account: 'private', offered: false })).toEqual({ default: null, off: ['private'] });
        expect(choiceAfter({ off: ['private'] }, { account: 'private', offered: true })).toEqual({ default: null, off: [] });
    });

    test('a default it picks is offered, and the machine default takes the pick away', () => {
        expect(choiceAfter({ off: ['client'] }, { default: 'client' })).toEqual({ default: 'client', off: [] });
        expect(choiceAfter({ default: 'client', off: ['private'] }, { default: null })).toEqual({ default: null, off: ['private'] });
    });
});
