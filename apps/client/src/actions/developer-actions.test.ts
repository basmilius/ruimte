import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ActionRegistry, type ActionResult } from '@ruimte/actions';
import type { GitFile, GitStatus, ProjectCanvasView, RequestMap, RequestType, Worktree } from '@ruimte/contracts';
import { developerActions } from './developer-actions';
import { PERSON_ACTION_CALL, VOICE_ACTION_CALL } from './client-actions';
import { useDocument } from '@/state/document';
import { TransportError, type Transport } from '@/transport/transport';

const FOLDER = '/work/atlas';

const status = (extra: Partial<GitStatus> = {}): GitStatus => ({
    repo: true,
    root: FOLDER,
    branch: 'main',
    detached: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    base: 'main',
    mergeBase: null,
    files: [],
    truncated: false,
    live: true,
    ...extra
});

const file = (path: string, state: GitFile['state']): GitFile => ({ path, state, status: 'M', added: 1, deleted: 0, binary: false });

type Answers = { [Type in RequestType]?: (payload: RequestMap[Type]['payload']) => RequestMap[Type]['result'] | Promise<RequestMap[Type]['result']> };

interface Fake {
    registry: ActionRegistry<void>;
    asked: { type: RequestType; payload: Record<string, unknown> }[];
    of(type: RequestType): Record<string, unknown>[];
}

const worktree = (branch: string, extra: Partial<Worktree> = {}): Worktree => ({
    path: `/home/.ruimte/worktrees/${branch}`,
    branch,
    from: { branch: 'main', commit: 'abc' },
    ...extra
});

const fake = (answers: Answers, options: { hidden?: string[] } = {}): Fake => {
    const asked: Fake['asked'] = [];
    const defaults: Answers = {
        'git.repos': () => ({
            repos: [
                { path: FOLDER, label: 'atlas', kind: 'root' },
                { path: `${FOLDER}/web`, label: 'web', kind: 'nested' }
            ],
            truncated: false
        }),
        'git.worktree-list': () => ({ worktrees: [] }),
        'git.status': () => status(),
        'git.action': (payload) => ({ actionId: payload.actionId, summary: `${payload.kind} done`, output: '' })
    };
    const transport = {
        request: (async (type: RequestType, payload: Record<string, unknown>) => {
            asked.push({ type, payload });
            const answer = (answers[type] ?? defaults[type]) as ((payload: unknown) => unknown) | undefined;
            if (!answer) {
                throw new Error(`No answer for ${type}`);
            }
            return answer(payload);
        }) as unknown as Transport['request']
    };
    let runs = 0;
    const registry = new ActionRegistry<void>(
        developerActions(useDocument, {
            transport: () => transport,
            folder: () => FOLDER,
            projectId: () => 'atlas',
            hiddenRepos: () => options.hidden ?? [],
            runId: () => `run-${++runs}`
        })
    );
    return { registry, asked, of: (type) => asked.filter((entry) => entry.type === type).map((entry) => entry.payload) };
};

const confirm = async (registry: ActionRegistry<void>, asked: ActionResult): Promise<ActionResult> => {
    if (asked.status !== 'needs_confirmation') {
        throw new Error(`Expected a confirmation, got ${JSON.stringify(asked)}`);
    }
    return registry.confirm(asked.confirmationToken, true, VOICE_ACTION_CALL);
};

const questionOf = (result: ActionResult): string =>
    result.status === 'needs_confirmation' ? [result.confirmation.title, ...result.confirmation.consequences].join(' ') : '';

const main: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [
        { id: 'lexer-agent', kind: 'chat', title: 'Lexer', x: 0, y: 0, w: 400, h: 300, cwd: '/home/.ruimte/worktrees/lexer/src' },
        { id: 'elsewhere', kind: 'terminal', title: 'Shell', x: 500, y: 0, w: 400, h: 300, cwd: FOLDER }
    ],
    texts: [],
    edges: [],
    layouts: []
};

beforeEach(() => {
    useDocument.getState().load({ version: 3, rev: 1, name: 'Atlas', color: '#000', views: [main] }, { activeViewId: 'main', views: {} });
});

afterEach(() => {
    useDocument.getState().load(null, null);
});

describe('git actions for a person', () => {
    test('stage and unstage the path the panel names without looking it up', async () => {
        const { registry, asked } = fake({ 'git.stage': () => ({}) });
        await registry.execute('git.stage', { repository: `${FOLDER}/web`, paths: ['a.ts'] }, PERSON_ACTION_CALL);
        await registry.execute('git.unstage', { repository: `${FOLDER}/web`, paths: ['a.ts'] }, PERSON_ACTION_CALL);
        expect(asked).toEqual([
            { type: 'git.stage', payload: { cwd: `${FOLDER}/web`, paths: ['a.ts'], staged: true } },
            { type: 'git.stage', payload: { cwd: `${FOLDER}/web`, paths: ['a.ts'], staged: false } }
        ]);
    });

    test('a person runs a discard straight away, since the dialog asked', async () => {
        const { registry, of } = fake({ 'git.discard': () => ({ stash: 'stash@{0}' }) });
        const result = await registry.execute('git.discard', { repository: FOLDER, paths: ['a.ts'] }, PERSON_ACTION_CALL);
        expect(result).toMatchObject({ status: 'completed', output: { repository: 'atlas', stash: 'stash@{0}' } });
        expect(of('git.discard')).toEqual([{ cwd: FOLDER, paths: ['a.ts'] }]);
    });

    test('a diverged pull keeps the machine code, so the panel still asks how it comes together', async () => {
        const { registry } = fake({
            'git.action': () => {
                throw new TransportError('diverged', 'main and the remote have both moved on.');
            }
        });
        const result = await registry.execute('git.pull', { repository: FOLDER, strategy: null, run: 'mine' }, PERSON_ACTION_CALL);
        expect(result).toMatchObject({ status: 'failed', error: { code: 'diverged', message: 'main and the remote have both moved on.' } });
    });

    test('the run id the panel draws progress under reaches the machine', async () => {
        const { registry, of } = fake({});
        await registry.execute('git.pull', { repository: FOLDER, strategy: 'rebase', run: 'mine' }, PERSON_ACTION_CALL);
        expect(of('git.action')).toEqual([{ cwd: FOLDER, actionId: 'mine', kind: 'pull', strategy: 'rebase' }]);
    });

    test('commit takes where the panel weighed it should land, and reports the commit', async () => {
        const { registry, of } = fake({
            'git.action': (payload) => ({ actionId: payload.actionId, summary: 'Committed fix.', output: '', commit: { hash: 'abc', subject: 'fix' } })
        });
        const result = await registry.execute(
            'git.commit',
            { repository: `${FOLDER}/web`, message: 'fix', body: null, push: true, stageAll: true, run: 'mine' },
            PERSON_ACTION_CALL
        );
        expect(of('git.action')).toEqual([{ cwd: `${FOLDER}/web`, actionId: 'mine', kind: 'commit-push', subject: 'fix', stageAll: true }]);
        expect(of('git.status')).toEqual([]);
        expect(result).toMatchObject({ status: 'completed', output: { runs: [{ repository: 'web', commit: { hash: 'abc' }, error: null }] } });
    });

    test('a resolution is the merged file over its digest or one side, never neither', async () => {
        const { registry, of } = fake({ 'git.resolve': () => ({ remaining: 0 }) });
        expect(
            await registry.execute('git.resolveConflict', { repository: FOLDER, path: 'a.ts', content: 'x', take: null, hash: null }, PERSON_ACTION_CALL)
        ).toMatchObject({ status: 'failed', error: { code: 'invalid-resolution' } });
        expect(
            await registry.execute('git.resolveConflict', { repository: FOLDER, path: 'a.ts', content: null, take: 'ours', hash: null }, PERSON_ACTION_CALL)
        ).toMatchObject({ status: 'completed', output: { remaining: 0 } });
        expect(of('git.resolve')).toEqual([{ cwd: FOLDER, path: 'a.ts', take: 'ours' }]);
    });

    test('worktree remove finds the worktree by its branch and forces only when told', async () => {
        const { registry, of } = fake({
            'git.worktree-list': () => ({ worktrees: [worktree('lexer')] }),
            'git.worktree-remove': () => ({ branchDeleted: true, branchCommit: 'def' })
        });
        const result = await registry.execute('worktree.remove', { branch: 'lexer', force: false }, PERSON_ACTION_CALL);
        expect(of('git.worktree-remove')).toEqual([{ repo: FOLDER, path: '/home/.ruimte/worktrees/lexer' }]);
        expect(result).toMatchObject({ status: 'completed', output: { branch: 'lexer', branchDeleted: true, branchCommit: 'def' } });
    });
});

describe('git actions for Voice', () => {
    test('names a repository by its label and refuses one the project does not have', async () => {
        const { registry, of } = fake({ 'git.refs': () => ({ refs: [], current: 'main', stashes: [] }) });
        expect(await registry.execute('git.refs', { repository: 'web' }, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
        expect(of('git.refs')).toEqual([{ cwd: `${FOLDER}/web` }]);
        const unknown = await registry.execute('git.refs', { repository: 'api' }, VOICE_ACTION_CALL);
        expect(unknown).toMatchObject({ status: 'failed', error: { code: 'unknown-repository' } });
        expect(unknown.status === 'failed' && unknown.error.message).toContain('“atlas” and “web”');
    });

    test('status over every repository leaves out the ones a person hid', async () => {
        const { registry, of } = fake({}, { hidden: ['web'] });
        const result = await registry.execute('git.status', { repository: null }, VOICE_ACTION_CALL);
        expect(result).toMatchObject({ status: 'completed', output: { repositories: [{ repository: 'atlas', kind: 'root', error: null }] } });
        expect(of('git.status')).toEqual([{ cwd: FOLDER }]);
    });

    test('discard asks first, naming the files and the repository, and changes nothing before the answer', async () => {
        const { registry, of } = fake({ 'git.discard': () => ({ stash: null }) });
        const asked = await registry.execute('git.discard', { repository: 'web', paths: ['a.ts', 'b.ts'] }, VOICE_ACTION_CALL);
        expect(questionOf(asked)).toContain('2 files in web');
        expect(questionOf(asked)).toContain('a.ts and b.ts');
        expect(of('git.discard')).toEqual([]);
        expect(await confirm(registry, asked)).toMatchObject({ status: 'completed', output: { stash: null } });
        expect(of('git.discard')).toEqual([{ cwd: `${FOLDER}/web`, paths: ['a.ts', 'b.ts'] }]);
    });

    test('a push over the folder asks for the repositories with commits for their upstream, and one failure does not stop the rest', async () => {
        const { registry, of } = fake({
            'git.status': ({ cwd }) => (cwd === FOLDER ? status({ ahead: 2 }) : status({ branch: 'dev', upstream: 'origin/dev', ahead: 1 })),
            'git.action': (payload) => {
                if (payload.cwd === FOLDER) {
                    throw new TransportError('git-failed', 'rejected');
                }
                return { actionId: payload.actionId, summary: 'Pushed dev.', output: '' };
            }
        });
        const asked = await registry.execute('git.push', { repository: null, run: null }, VOICE_ACTION_CALL);
        expect(questionOf(asked)).toContain('atlas: 2 commits of main to origin/main');
        expect(questionOf(asked)).toContain('web: 1 commit of dev to origin/dev');
        expect(of('git.action')).toEqual([]);
        const result = await confirm(registry, asked);
        expect(result).toMatchObject({
            status: 'completed',
            output: {
                runs: [
                    { repository: 'atlas', error: { code: 'git-failed', message: 'rejected' } },
                    { repository: 'web', summary: 'Pushed dev.', error: null }
                ]
            }
        });
    });

    test('nothing to push anywhere is refused before anything is asked', async () => {
        const { registry } = fake({});
        expect(await registry.execute('git.push', { repository: null, run: null }, VOICE_ACTION_CALL)).toMatchObject({
            status: 'failed',
            error: { code: 'nothing-to-push' }
        });
    });

    test('a pull never says how a diverged branch comes together for Voice', async () => {
        const { registry } = fake({});
        expect(await registry.execute('git.pull', { repository: 'atlas', strategy: 'merge' }, VOICE_ACTION_CALL)).toMatchObject({
            status: 'failed',
            error: { code: 'forbidden-field' }
        });
        const asked = await registry.execute('git.pull', { repository: 'atlas', strategy: null }, VOICE_ACTION_CALL);
        expect(questionOf(asked)).toContain('Only a fast-forward');
    });

    test('a commit with nothing staged over two changed repositories waits for staging', async () => {
        const { registry } = fake({ 'git.status': () => status({ files: [file('a.ts', 'unstaged')] }) });
        expect(await registry.execute('git.commit', { repository: null, message: 'fix', body: null, push: null }, VOICE_ACTION_CALL)).toMatchObject({
            status: 'failed',
            error: { code: 'nothing-to-commit' }
        });
    });

    test('a commit asks with the staged files and the message, then commits only where something is staged', async () => {
        const { registry, of } = fake({
            'git.status': ({ cwd }) =>
                status(cwd === FOLDER ? { files: [file('a.ts', 'staged'), file('b.ts', 'unstaged')] } : { files: [file('c.ts', 'unstaged')] })
        });
        const asked = await registry.execute('git.commit', { repository: null, message: 'fix', body: null, push: null }, VOICE_ACTION_CALL);
        expect(questionOf(asked)).toContain('Commit “fix” in “atlas”?');
        expect(questionOf(asked)).toContain('atlas on main: a.ts.');
        await confirm(registry, asked);
        expect(of('git.action')).toEqual([{ cwd: FOLDER, actionId: 'run-1', kind: 'commit', subject: 'fix', stageAll: false }]);
    });

    test('checkout of a clean tree switches at once; a changed tree asks and stashes first', async () => {
        const clean = fake({});
        expect(await clean.registry.execute('git.checkout', { repository: 'atlas', branch: 'dev' }, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
        expect(clean.of('git.action')).toEqual([{ cwd: FOLDER, actionId: 'run-1', kind: 'checkout', ref: 'dev' }]);

        const dirty = fake({ 'git.status': () => status({ files: [file('a.ts', 'unstaged')] }) });
        const asked = await dirty.registry.execute('git.checkout', { repository: 'atlas', branch: 'dev' }, VOICE_ACTION_CALL);
        expect(questionOf(asked)).toContain('1 changed file on main: a.ts');
        await dirty.registry.confirm((asked as { confirmationToken: string }).confirmationToken, true, VOICE_ACTION_CALL);
        expect(dirty.of('git.action')).toEqual([{ cwd: FOLDER, actionId: 'run-1', kind: 'checkout', ref: 'dev', stash: true }]);
    });

    test('a merge that stops with conflicts is not a failure: the files come back', async () => {
        const { registry } = fake({
            'git.action': (payload) => ({ actionId: payload.actionId, summary: '1 file conflicts.', output: '', conflicts: ['a.ts'] })
        });
        const asked = await registry.execute('git.merge', { repository: 'atlas', branch: 'dev' }, VOICE_ACTION_CALL);
        expect(questionOf(asked)).toContain('Merge dev into main in atlas?');
        expect(await confirm(registry, asked)).toMatchObject({ status: 'completed', output: { conflicts: ['a.ts'] } });
    });

    test('only a person rebases, force pushes, accepts a resolution or removes a worktree', async () => {
        const { registry, asked } = fake({});
        for (const [name, input] of [
            ['git.rebase', { repository: 'atlas', onto: 'main' }],
            ['git.forcePush', { repository: 'atlas' }],
            ['git.resolveConflict', { repository: 'atlas', path: 'a.ts', content: null, take: 'ours', hash: null }],
            ['git.proposeResolution', { repository: 'atlas', path: 'a.ts' }],
            ['worktree.remove', { branch: 'lexer' }]
        ] as const) {
            expect(await registry.execute(name, input, VOICE_ACTION_CALL)).toMatchObject({ status: 'failed', error: { code: 'forbidden-action' } });
        }
        expect(asked).toEqual([]);
    });

    test('Voice takes a waiting merge back after asking, and never finishes one', async () => {
        const { registry, of } = fake({
            'git.conflicts': () => ({ operation: 'merge', ours: 'main', theirs: 'dev', files: [{ path: 'a.ts', kind: 'text' }] }),
            'git.operation': (payload) => ({ actionId: payload.actionId, summary: 'Took the merge back.', output: '' })
        });
        expect(await registry.execute('git.operation', { repository: 'atlas', step: 'continue' }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'forbidden-field' }
        });
        const asked = await registry.execute('git.operation', { repository: 'atlas', step: 'abort' }, VOICE_ACTION_CALL);
        expect(questionOf(asked)).toContain('Take back the merge in atlas?');
        await confirm(registry, asked);
        expect(of('git.operation')).toEqual([{ cwd: FOLDER, actionId: 'run-1', action: 'abort' }]);
    });

    test('a pull request asks first, naming the branch it publishes', async () => {
        const { registry, of } = fake({
            'git.status': () => status({ branch: 'feature', upstream: null }),
            'git.action': (payload) => ({ actionId: payload.actionId, summary: 'Pull request ready.', output: '', url: 'https://example.test/pr/1' })
        });
        const asked = await registry.execute('git.createPullRequest', { repository: 'atlas', title: 'Lexer', body: null }, VOICE_ACTION_CALL);
        expect(questionOf(asked)).toContain('feature is published to origin first');
        expect(await confirm(registry, asked)).toMatchObject({ output: { url: 'https://example.test/pr/1' } });
        expect(of('git.action')).toEqual([{ cwd: FOLDER, actionId: 'run-1', kind: 'create-pr', subject: 'Lexer' }]);
    });
});

describe('worktree actions for Voice', () => {
    const lexer = worktree('lexer', { nodeId: 'lexer-agent', work: { changed: 1, untracked: 1, ahead: 2 } });

    test('list names the nodes working in each worktree', async () => {
        const { registry } = fake({ 'git.worktree-list': () => ({ worktrees: [lexer] }) });
        expect(await registry.execute('worktree.list', {}, VOICE_ACTION_CALL)).toMatchObject({
            output: { worktrees: [{ branch: 'lexer', nodes: ['lexer-agent'], from: 'main', changed: 1, untracked: 1, ahead: 2 }] }
        });
    });

    test('merge asks first, commits the loose work and never removes the worktree or rebases', async () => {
        const { registry, of } = fake({
            'git.worktree-list': () => ({ worktrees: [lexer] }),
            'git.worktree-merge': (payload) => ({ actionId: payload.actionId, summary: '1 file conflicts.', output: '', cwd: FOLDER, conflicts: ['a.ts'] })
        });
        expect(await registry.execute('worktree.merge', { branch: 'lexer', strategy: 'rebase', message: null }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'forbidden-field' }
        });
        expect(await registry.execute('worktree.merge', { branch: 'lexer', strategy: 'squash', message: null, remove: true }, VOICE_ACTION_CALL)).toMatchObject(
            {
                error: { code: 'forbidden-field' }
            }
        );
        const asked = await registry.execute('worktree.merge', { branch: 'lexer', strategy: 'squash', message: null }, VOICE_ACTION_CALL);
        expect(questionOf(asked)).toContain('into main');
        expect(questionOf(asked)).toContain('2 uncommitted files committed first');
        expect(of('git.worktree-merge')).toEqual([]);
        expect(await confirm(registry, asked)).toMatchObject({ output: { branch: 'lexer', conflicts: ['a.ts'], cwd: FOLDER } });
        expect(of('git.worktree-merge')).toEqual([
            {
                repo: FOLDER,
                path: '/home/.ruimte/worktrees/lexer',
                actionId: 'run-1',
                strategy: 'squash',
                subject: 'Lexer: work of the agent',
                commitFirst: true
            }
        ]);
    });

    test('create asks first and binds nothing on its own', async () => {
        const { registry, of } = fake({ 'git.worktree-add': () => ({ worktree: worktree('docs'), created: true }) });
        const asked = await registry.execute('worktree.create', { branch: 'docs' }, VOICE_ACTION_CALL);
        expect(questionOf(asked)).toContain('Create a worktree on docs?');
        expect(await confirm(registry, asked)).toMatchObject({ output: { created: true } });
        expect(of('git.worktree-add')).toEqual([{ repo: FOLDER, branch: 'docs', projectId: 'atlas' }]);
    });
});
