/*
 * A host provider as a test asks it: through the same reads of `extension-hosts.ts` the machine puts every answer
 * through, so a test sees what a person and an agent would, and never the provider's own shape.
 */
import {
    providedChange,
    providedChangePage,
    providedCheckLog,
    providedHostStatus,
    providedIssue,
    providedIssuePage,
    providedLocator,
    type HostProviderMethod,
    type HostProviderShape
} from '@ruimte/contracts/extension-hosts';
import type * as PublicServer from '../../../../packages/extension/server';
import type * as PublicTesting from '../../../../packages/extension/testing';

interface TestProviderMachine {
    project: PublicServer.ProjectInfo;
    /* Asks the provider as over the pipe: what goes in and what comes back is JSON. */
    ask(method: HostProviderMethod, args: readonly unknown[]): Promise<unknown>;
    refused(reason: string): void;
}

export function testHostProvider(id: string, shape: HostProviderShape, machine: TestProviderMachine): PublicTesting.TestHostProvider {
    const scopeOf = (scope: PublicTesting.TestHostScope = {}): PublicServer.HostScope => ({
        project: { ...machine.project, ...scope.project },
        ...(scope.remote === undefined ? {} : { remote: scope.remote })
    });

    return {
        title: shape.title,
        kind: shape.matches ? 'code-host' : 'tracker',
        capabilities: { issues: shape.issues, parses: shape.parses, changes: shape.changes, checks: shape.checks },
        match: async (remote) => shape.matches && (await machine.ask('match', [remote])) === true,
        async status(scope) {
            const { state, reason, account } = providedHostStatus(await machine.ask('status', [scopeOf(scope)]));

            return { state, ...(reason === undefined ? {} : { reason }), ...(account === undefined ? {} : { account }) };
        },
        async issues(filter = {}, scope) {
            const page = providedIssuePage(id, await machine.ask('issues.list', [scopeOf(scope), filter]), machine.refused);

            return { issues: page.items, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) };
        },
        issue: async (issue, scope) => providedIssue(id, await machine.ask('issues.read', [scopeOf(scope), issue])),
        parse: async (text, scope) => providedLocator(await machine.ask('issues.parse', [scopeOf(scope), text])),
        async changes(filter = {}, scope) {
            const page = providedChangePage(id, await machine.ask('changes.list', [scopeOf(scope), filter]), machine.refused);

            return { changes: page.items, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) };
        },
        change: async (change, scope) => providedChange(id, await machine.ask('changes.read', [scopeOf(scope), change])),
        changeOfBranch: async (branch, scope) => providedLocator(await machine.ask('changes.forBranch', [scopeOf(scope), branch])),
        checkLog: async (change, check, scope) => providedCheckLog(await machine.ask('checks.log', [scopeOf(scope), change, check]))
    };
}
