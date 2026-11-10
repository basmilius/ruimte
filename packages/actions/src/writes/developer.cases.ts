import { SECRET_LIMITS } from '@ruimte/contracts';
import type { ActionInput } from '../index.ts';
import { type RestrictedValue, type WriteCases } from './case.ts';

const run: RestrictedValue = { value: 'run-1', actors: ['person'] };
const commit = { repository: null, message: 'test(actions): cover every write', body: null, push: false } as const;
const launches: ActionInput<'launch.save'> = {
    projectId: 'ruimte',
    baseRev: 4,
    launches: [{ id: 'dev', name: 'Dev', kind: 'service', command: 'bun dev', shared: true }],
    imported: []
};
const secret = {
    launch: 'api',
    variable: 'STRIPE_KEY',
    label: 'Stripe secret key',
    reason: 'The API charges cards in development.',
    placeholder: 'sk_test_...',
    wait: 30
} as const;
const template: ActionInput<'template.add'> = {
    kind: 'live',
    key: 'tdd',
    body: 'it("$1", () => {\n\t$0\n});',
    languages: ['typescript'],
    description: 'A test',
    places: ['code']
};
const routine: ActionInput<'routine.create'> = {
    title: 'Weekly report',
    schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' },
    prompt: 'Summarize what changed this week.'
};
const merge = { branch: 'agent/tests', strategy: 'squash', message: null } as const;
const resolution = { repository: 'ruimte', path: 'README.md', content: '# Ruimte\n', take: null, hash: 'abc123' } as const;

export const cases: WriteCases = {
    'operation.cancel': {
        actors: ['person', 'voice', 'agent'],
        input: { operationId: 'agent.start:chat-2' },
        refused: { 'an empty operation': { operationId: '' }, 'no operation at all': {} }
    },
    'git.stage': {
        actors: ['person', 'voice'],
        input: { repository: 'ruimte', paths: ['README.md'] },
        refused: { 'no files': { repository: 'ruimte', paths: [] }, 'every repository at once': { repository: null, paths: ['README.md'] } }
    },
    'git.unstage': {
        actors: ['person', 'voice'],
        input: { repository: 'ruimte', paths: ['README.md'] },
        refused: { 'an empty file': { repository: 'ruimte', paths: [''] } }
    },
    'git.discard': {
        actors: ['person', 'voice'],
        input: { repository: 'ruimte', paths: ['apps/client/src/main.tsx'] },
        refused: { 'no files': { repository: 'ruimte', paths: [] } },
        confirms: true
    },
    'git.commit': {
        actors: ['person', 'voice'],
        input: commit,
        refused: { 'a blank subject': { ...commit, message: ' ' }, 'push as a word': { ...commit, push: 'yes' } },
        restricted: { stageAll: { value: true, actors: ['person'] }, run, amend: { value: true, actors: ['person'] } },
        confirms: true
    },
    'git.fetch': {
        actors: ['person', 'voice'],
        input: { repository: null },
        refused: { 'an empty repository': { repository: '' } },
        restricted: { run }
    },
    'git.pull': {
        actors: ['person', 'voice'],
        input: { repository: 'ruimte' },
        refused: { 'a strategy it has not': { repository: 'ruimte', strategy: 'octopus' } },
        restricted: { strategy: { value: 'rebase', actors: ['person'] }, run },
        confirms: true
    },
    'git.push': {
        actors: ['person', 'voice'],
        input: { repository: null },
        refused: { 'no repository at all': {}, 'force as a word': { repository: 'ruimte', force: 'yes' } },
        restricted: { force: { value: true, actors: ['person'] }, run },
        confirms: true
    },
    'git.sync': {
        actors: ['person', 'voice'],
        input: { repository: null },
        refused: { 'a strategy it has not': { repository: null, strategy: 'squash' } },
        restricted: { strategy: { value: 'merge', actors: ['person'] }, run },
        confirms: true
    },
    'git.publishBranch': {
        actors: ['person', 'voice'],
        input: { repository: 'ruimte' },
        refused: { 'every repository at once': { repository: null } },
        restricted: { run },
        confirms: true
    },
    'git.checkout': {
        actors: ['person', 'voice'],
        input: { repository: 'ruimte', branch: 'main' },
        refused: { 'an empty branch': { repository: 'ruimte', branch: '' } },
        restricted: { stashFirst: { value: true, actors: ['person'] }, run },
        confirms: true
    },
    'git.createBranch': {
        actors: ['person', 'voice'],
        input: { repository: 'ruimte', name: 'feature/tests' },
        refused: { 'a blank name': { repository: 'ruimte', name: ' ' } },
        restricted: { run }
    },
    'git.renameBranch': {
        actors: ['person', 'voice'],
        input: { repository: 'ruimte', name: 'feature/catalog-tests' },
        refused: { 'no name': { repository: 'ruimte' } },
        restricted: { run }
    },
    'git.deleteBranch': {
        actors: ['person', 'voice'],
        input: { repository: 'ruimte', branch: 'feature/old' },
        refused: { 'no branch': { repository: 'ruimte' } },
        restricted: { force: { value: true, actors: ['person'] }, run },
        confirms: true
    },
    'git.merge': {
        actors: ['person', 'voice'],
        input: { repository: 'ruimte', branch: 'feature/tests' },
        refused: { 'an empty branch': { repository: 'ruimte', branch: '' } },
        restricted: { run },
        confirms: true
    },
    'git.rebase': {
        actors: ['person'],
        input: { repository: 'ruimte', onto: 'main' },
        refused: { 'nothing to rebase onto': { repository: 'ruimte' } },
        restricted: { run },
        confirms: true
    },
    'git.stash': {
        actors: ['person', 'voice'],
        input: { repository: 'ruimte', message: 'Before the merge' },
        refused: { 'a blank message': { repository: 'ruimte', message: ' ' }, 'no message at all': { repository: 'ruimte' } },
        restricted: { run }
    },
    'git.popStash': {
        actors: ['person', 'voice'],
        input: { repository: 'ruimte', stash: 'stash@{0}' },
        refused: { 'an empty stash': { repository: 'ruimte', stash: '' } },
        restricted: { run },
        confirms: true
    },
    'git.createPullRequest': {
        actors: ['person', 'voice'],
        input: { repository: 'ruimte', title: 'Cover the actions catalog', body: null },
        refused: { 'a blank title': { repository: 'ruimte', title: ' ', body: null }, 'no body at all': { repository: 'ruimte', title: 'Tests' } },
        restricted: { run },
        confirms: true
    },
    'git.resolveConflict': {
        actors: ['person'],
        input: resolution,
        refused: {
            'a side it has not': { ...resolution, content: null, take: 'both' },
            'an empty file': { ...resolution, path: '' },
            'no digest at all': { repository: 'ruimte', path: 'README.md', content: 'x', take: null }
        }
    },
    'git.operation': {
        actors: ['person', 'voice'],
        input: { repository: 'ruimte', step: 'abort' },
        refused: { 'a step it has not': { repository: 'ruimte', step: 'skip' } },
        restricted: { step: { value: 'continue', actors: ['person'] }, run },
        confirms: true
    },
    'worktree.create': {
        actors: ['person', 'voice'],
        input: { branch: 'agent/tests' },
        refused: { 'a blank branch': { branch: ' ' } },
        restricted: { base: { value: 'main', actors: ['person'] } },
        confirms: true
    },
    'worktree.merge': {
        actors: ['person', 'voice', 'agent'],
        input: merge,
        refused: {
            'a strategy it has not': { ...merge, strategy: 'octopus' },
            'a blank message': { ...merge, message: ' ' },
            'no strategy': { branch: 'agent/tests', message: null }
        },
        restricted: {
            strategy: { value: 'rebase', actors: ['person', 'agent'] },
            body: { value: 'Every write is covered.', actors: ['person'] },
            commitFirst: { value: true, actors: ['person'] },
            remove: { value: true, actors: ['person'] },
            stopAgent: { value: true, actors: ['person'] },
            into: { value: 'release', actors: ['person'] },
            run
        },
        confirms: true
    },
    'worktree.remove': {
        actors: ['person'],
        input: { branch: 'agent/tests' },
        refused: { 'an empty branch': { branch: '' } },
        restricted: {
            force: { value: true, actors: ['person'] },
            stopAgent: { value: true, actors: ['person'] }
        }
    },
    'launch.save': {
        actors: ['person'],
        input: launches,
        refused: {
            'a revision below zero': { ...launches, baseRev: -1 },
            'a kind of launch it has not': { ...launches, launches: [{ ...launches.launches[0], kind: 'daemon' }] },
            'no list of imports': { projectId: 'ruimte', baseRev: 4, launches: [] }
        }
    },
    'launch.create': {
        actors: ['person', 'agent'],
        input: { name: 'Dev', kind: 'service', command: 'bun dev', url: 'http://localhost:5173', env: { PORT: '5173' } },
        refused: {
            'a kind of launch it has not': { name: 'Dev', kind: 'daemon', command: 'bun dev' },
            'a blank name': { name: ' ', kind: 'task', command: 'bun test' },
            'a variable that starts with a digit': { name: 'Dev', kind: 'service', command: 'bun dev', env: { '1PORT': '5173' } },
            'a group that starts nothing': { name: 'Stack', kind: 'group', members: [] }
        }
    },
    'launch.edit': {
        actors: ['person', 'agent'],
        input: { launch: 'dev', command: 'bun run dev', env: { DEBUG: null } },
        refused: { 'no launch': { command: 'bun run dev' }, 'an empty command': { launch: 'dev', command: ' ' } }
    },
    'launch.start': {
        actors: ['person', 'agent', 'extension'],
        input: { launch: 'dev' },
        refused: { 'a blank launch': { launch: ' ' } }
    },
    'launch.restart': {
        actors: ['person', 'agent', 'extension'],
        input: { launch: 'Dev server' },
        refused: { 'no launch': {} }
    },
    'launch.stop': {
        actors: ['person', 'agent', 'extension'],
        input: { launch: 'dev' },
        refused: { 'an empty launch': { launch: '' } }
    },
    'routine.create': {
        actors: ['person', 'agent'],
        input: routine,
        refused: {
            'a blank title': { ...routine, title: ' ' },
            'a time past the clock': { ...routine, schedule: { kind: 'weekly', days: [1], time: '24:00' } },
            'a key with capitals': { ...routine, key: 'Weekly' },
            'a kind it has not': { ...routine, kind: 'cron' }
        }
    },
    'routine.edit': {
        actors: ['person', 'agent'],
        input: { routineId: 'weekly-report', title: 'Monday report' },
        refused: {
            'no routine': { title: 'Monday report' },
            'a day past Sunday': { routineId: 'weekly-report', schedule: { kind: 'weekly', days: [8], time: '09:00' } }
        }
    },
    'routine.pause': {
        actors: ['person', 'agent', 'extension'],
        input: { routineId: 'weekly-report' },
        refused: { 'an empty routine': { routineId: '' } }
    },
    'routine.resume': {
        actors: ['person', 'agent', 'extension'],
        input: { routineId: 'weekly-report' },
        refused: { 'no routine': {} }
    },
    'routine.run': {
        actors: ['person', 'agent', 'extension'],
        input: { routineId: 'weekly-report' },
        refused: { 'an empty routine': { routineId: '' } }
    },
    'secret.request': {
        actors: ['agent'],
        input: secret,
        refused: {
            'a variable that starts with a digit': { ...secret, variable: '1KEY' },
            'a variable past its limit': { ...secret, variable: 'K'.repeat(SECRET_LIMITS.variable + 1) },
            'a blank reason': { ...secret, reason: ' ' },
            'a wait past what a call holds': { ...secret, wait: 111 }
        }
    },
    'template.add': {
        actors: ['agent'],
        input: template,
        refused: {
            'a blank key': { ...template, key: '' },
            'no language': { ...template, languages: [] },
            'a language it has not': { ...template, languages: ['cobol'] },
            'a place it has not': { ...template, places: ['margin'] }
        }
    },
    'database.request': {
        actors: ['person'],
        input: { request: { kind: 'tables', connection: 'local' } },
        refused: { 'no request object': null, 'a request as a word': 'tables' }
    },
    'database.execute': {
        actors: ['person', 'agent'],
        input: { connection: 'local', sql: "UPDATE users SET name = 'Bas' WHERE id = 1", schema: null },
        refused: {
            'no statement': { connection: 'local', sql: '', schema: null },
            'a blank connection': { connection: ' ', sql: 'DELETE FROM users', schema: null },
            'no schema at all': { connection: 'local', sql: 'DELETE FROM users' }
        }
    }
};
