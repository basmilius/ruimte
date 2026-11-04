import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, watch } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import * as prompts from '@clack/prompts';
import { Command } from 'commander';
// @ts-expect-error Bun hands over the file's text, so a compiled daemon carries it; TypeScript only knows the module.
import testRuntime from '../extensions/generated/test-runtime.js' with { type: 'text' };
import { logTail } from '../extensions/log-tail.ts';
import { buildExtension, packExtension, readManifest } from '../extensions/pack.ts';
import { scaffoldFiles, scaffoldFolder, scaffoldProblem, type ScaffoldAnswers } from '../extensions/scaffold.ts';
import { isLeftOut, sourceSignature } from '../extensions/source-signature.ts';
import { DOM_PRELOAD, hasDomTests, missingDom, reactWarning } from '../extensions/test-setup.ts';
import { bunRuntime } from '../language/runtime.ts';
import { commandIo, homeSecret, startFirst, type LocalDaemonOptions } from './local-daemon.ts';

const STORE_REPOSITORY = 'ruimte-app/extensions';
const WATCH_DEBOUNCE_MS = 150;
const LOG_POLL_MS = 250;

async function askDaemon(options: LocalDaemonOptions, path: string, body: object): Promise<Record<string, unknown>> {
    const { fetcher } = commandIo(options);
    const secret = await homeSecret(options);

    if (secret === null) {
        throw new Error(`No Ruimte has started with ${options.home} as its home. ${startFirst(options.port)}`);
    }

    const response = await fetcher(`http://127.0.0.1:${options.port}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
    }).catch(() => {
        throw new Error(`No Ruimte answers on port ${options.port}. Open the desktop app, or start it with \`ruimte\`.`);
    });
    const answer = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
        throw new Error(typeof answer.message === 'string' ? answer.message : `Ruimte answered ${response.status}`);
    }

    return answer;
}

function unwrap<Value>(value: Value): Exclude<Value, symbol> {
    if (prompts.isCancel(value)) {
        prompts.cancel('Nothing was created.');
        process.exit(1);
    }

    return value as Exclude<Value, symbol>;
}

async function askAnswers(): Promise<ScaffoldAnswers> {
    prompts.intro('New Ruimte extension');

    const name = unwrap(await prompts.text({ message: 'Name', placeholder: 'Builds', validate: (value) => (value?.trim() ? undefined : 'A name, please') }));
    const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const id = unwrap(
        await prompts.text({
            message: 'Id',
            initialValue: `acme.${slug}`,
            validate: (value) => (/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/.test(value ?? '') ? undefined : 'publisher.name, in lowercase')
        })
    );
    const description = unwrap(await prompts.text({ message: 'Description', placeholder: 'What it does, in one line', defaultValue: '' }));
    const parts = unwrap(
        await prompts.select({
            message: 'Parts',
            options: [
                { value: 'both', label: 'Client and server' },
                { value: 'client', label: 'Client' },
                { value: 'server', label: 'Server' }
            ]
        })
    ) as ScaffoldAnswers['parts'];
    const surface =
        parts === 'server'
            ? 'none'
            : (unwrap(
                  await prompts.select({
                      message: 'First surface',
                      options: [
                          { value: 'panel', label: 'Panel' },
                          { value: 'node', label: 'Canvas node' },
                          { value: 'view', label: 'View' },
                          { value: 'card', label: 'Sidebar card' }
                      ]
                  })
              ) as ScaffoldAnswers['surface']);
    const git = unwrap(await prompts.confirm({ message: 'Git repository', initialValue: true }));

    return { name: name.trim(), id, description, parts, surface, git };
}

async function create(values: {
    name?: string;
    id?: string;
    description?: string;
    parts?: ScaffoldAnswers['parts'];
    surface?: ScaffoldAnswers['surface'];
    yes?: boolean;
    git?: boolean;
}): Promise<void> {
    const answers: ScaffoldAnswers = values.yes
        ? {
              name: values.name ?? 'My extension',
              id: values.id ?? 'acme.my-extension',
              description: values.description ?? '',
              parts: values.parts ?? 'both',
              surface: values.surface ?? 'panel',
              git: values.git !== false
          }
        : await askAnswers();
    const problem = scaffoldProblem(answers);

    if (problem !== null) {
        throw new Error(problem);
    }

    const folder = resolve(scaffoldFolder(answers));

    if (existsSync(folder)) {
        throw new Error(`${folder} already exists`);
    }

    for (const [path, content] of Object.entries(scaffoldFiles(answers))) {
        await mkdir(join(folder, path, '..'), { recursive: true });
        await writeFile(join(folder, path), content);
    }

    if (answers.git) {
        spawnSync('git', ['init', '-q'], { cwd: folder });
    }

    const failed = installFailure(folder);

    if (failed !== null) {
        throw new Error(`Created ${folder}, but \`bun install\` failed:\n${failed}\n\nOnce that is fixed: cd ${basename(folder)} && bun install`);
    }

    console.log(`Created ${folder}\n\nNext: cd ${basename(folder)} && bun run dev`);
}

/* What `bun install` said when it failed in a new project, or null when it did not. */
export function installFailure(folder: string, run: typeof spawnSync = spawnSync): string | null {
    const runtime = bunRuntime();
    const result = run(runtime.command, [...runtime.args, 'install'], { cwd: folder, env: { ...process.env, ...runtime.env }, encoding: 'utf8' });

    if (result.error !== undefined) {
        return result.error.message;
    }

    return result.status === 0 ? null : `${String(result.stderr ?? '')}${String(result.stdout ?? '')}`.trim() || `It exited with ${result.status}`;
}

/*
 * Runs `work` one at a time. Calls while it runs ask for a single run after it, so two builds never
 * write the same folder at once and the last save is still built.
 */
export function oneAtATime(work: () => Promise<void>): () => Promise<void> {
    let running: Promise<void> | null = null;
    let again = false;

    const loop = async (): Promise<void> => {
        try {
            do {
                again = false;
                await work();
            } while (again);
        } finally {
            running = null;
        }
    };

    return () => {
        if (running !== null) {
            again = true;

            return running;
        }

        running = loop();

        return running;
    };
}

/*
 * Builds once, and again for every save after the sources were read: the watcher is there before the first build, so a
 * save while it runs is built after it. What a build writes or another tool keeps in the project is no save.
 */
export async function watchAndBuild(options: {
    folder: string;
    rebuild: () => Promise<void>;
    watch: (listener: (name: string | null) => void) => void;
    debounce: (run: () => void) => void;
}): Promise<void> {
    const { folder, rebuild } = options;
    let built = sourceSignature(folder);

    options.watch((name) => {
        if (name === null || isLeftOut(name)) {
            return;
        }

        options.debounce(() => {
            const now = sourceSignature(folder);

            if (now !== built) {
                built = now;
                void rebuild();
            }
        });
    });
    await rebuild();
}

/* Builds on every save and tells the machine, which restarts `server/` and has the client load the new build. */
async function dev(options: LocalDaemonOptions): Promise<void> {
    const folder = resolve('.');
    const manifest = readManifest(folder);
    const owner = randomUUID();
    let timer: ReturnType<typeof setTimeout> | null = null;

    // A build is linked only once it finished, and the next one starts only after that.
    const rebuild = oneAtATime(async () => {
        try {
            const { outdir } = await buildExtension(folder);

            await askDaemon(options, '/extensions/link', { folder: outdir, owner });
            console.log(`${new Date().toLocaleTimeString()} ${manifest.name} is loaded`);
        } catch (e) {
            console.error(e instanceof Error ? e.message : e);
        }
    });

    await watchAndBuild({
        folder,
        rebuild,
        watch: (listener) => void watch(folder, { recursive: true }, (_event, name) => listener(name)),
        debounce: (run) => {
            if (timer !== null) {
                clearTimeout(timer);
            }

            timer = setTimeout(run, WATCH_DEBOUNCE_MS);
        }
    });
    // Also when its terminal closes or something ends it, or the link outlives the run and hides what is installed.
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        process.on(signal, () => {
            // With this run's own token, so a later `extension dev` of the same extension keeps its link.
            void askDaemon(options, '/extensions/unlink', { id: manifest.id, owner })
                .catch(() => undefined)
                .finally(() => process.exit(0));
        });
    }
    // What `server/` wrote and what the client said, together.
    const readLog = logTail(join(options.home, 'extensions', manifest.id, 'server.log'));

    setInterval(() => process.stdout.write(readLog()), LOG_POLL_MS);
    console.log('Watching for changes. Ctrl-C takes it out of Ruimte again.');
    await new Promise(() => undefined);
}

async function test(args: string[]): Promise<number> {
    const project = process.cwd();
    const page = hasDomTests(project);
    const missing = page ? missingDom(project) : null;

    if (missing !== null) {
        console.error(missing);

        return 1;
    }

    const warning = reactWarning(project);

    if (warning !== null) {
        console.warn(warning);
    }

    // Inside the project, so the fakes import the project's own React.
    await mkdir(join('node_modules', '.cache'), { recursive: true });

    const folder = mkdtempSync(join('node_modules', '.cache', 'ruimte-extension-test-'));
    const preload = resolve(folder, 'preload.js');
    const preloads = ['--preload', preload];

    await writeFile(preload, testRuntime);

    // The page goes first: React DOM reads `document` as it loads.
    if (page) {
        const dom = resolve(folder, 'dom.js');

        await writeFile(dom, DOM_PRELOAD);
        preloads.unshift('--preload', dom);
    }

    const runtime = bunRuntime();
    const child = spawn(runtime.command, [...runtime.args, 'test', ...preloads, ...args], {
        stdio: 'inherit',
        env: { ...process.env, ...runtime.env }
    });

    return new Promise((done) => {
        child.on('exit', (code) => {
            void rm(folder, { recursive: true, force: true }).finally(() => done(code ?? 1));
        });
    });
}

async function publish(): Promise<void> {
    const packed = await packExtension('.');
    const { manifest } = packed;
    const fork = spawnSync('gh', ['repo', 'fork', STORE_REPOSITORY, '--clone=false', '--default-branch-only'], { encoding: 'utf8' });

    if (fork.status !== 0 && !/already exists/.test(`${fork.stdout}${fork.stderr}`)) {
        throw new Error(`The GitHub CLI could not fork ${STORE_REPOSITORY}: ${fork.stderr.trim()}. Is \`gh\` installed and signed in?`);
    }

    const login = spawnSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).stdout.trim();
    const checkout = mkdtempSync(join(tmpdir(), 'ruimte-extension-publish-'));
    const branch = `${manifest.id}-${manifest.version}`;
    const git = (...args: string[]): void => {
        const result = spawnSync('git', args, { cwd: checkout, encoding: 'utf8' });

        if (result.status !== 0) {
            throw new Error(`git ${args[0]}: ${result.stderr.trim()}`);
        }
    };

    git('clone', '--depth=1', `https://github.com/${login}/extensions.git`, '.');
    git('checkout', '-b', branch);
    await mkdir(join(checkout, 'extensions', manifest.id), { recursive: true });
    await cp(packed.path, join(checkout, 'extensions', manifest.id, `${manifest.version}.rex`));
    git('add', '.');
    git('commit', '-m', `${manifest.id} ${manifest.version}`);
    git('push', 'origin', branch);

    const pr = spawnSync(
        'gh',
        [
            'pr',
            'create',
            '--repo',
            STORE_REPOSITORY,
            '--head',
            `${login}:${branch}`,
            '--title',
            `${manifest.name} ${manifest.version}`,
            '--body',
            `sha256 ${packed.sha256}`
        ],
        { cwd: checkout, encoding: 'utf8' }
    );

    await rm(checkout, { recursive: true, force: true });

    if (pr.status !== 0) {
        throw new Error(`The pull request failed: ${pr.stderr.trim()}`);
    }

    console.log(`Opened ${pr.stdout.trim()}`);
}

/* `ruimte extension`: everything an author needs comes with the binary, and only `dev` needs a Ruimte running. */
export async function runExtension(args: readonly string[], options: LocalDaemonOptions): Promise<number> {
    const program = new Command('ruimte extension').exitOverride();

    program
        .command('create')
        .description('Create a new extension project')
        .option('--name <name>')
        .option('--id <id>')
        .option('--description <text>')
        .option('--parts <parts>', 'client, server or both')
        .option('--surface <surface>', 'panel, node, view or card')
        .option('--no-git')
        .option('--yes', 'skip the questions')
        .action(create);
    program
        .command('dev')
        .description('Load this extension into the running Ruimte, again on every save')
        .option('--port <port>', 'the machine to load it into, for one on another port than the default')
        .action((values: { port?: string }) => dev(values.port === undefined ? options : { ...options, port: Number(values.port) }));
    program
        .command('test')
        .description('Run the tests against a fake host')
        .allowUnknownOption()
        .argument('[args...]')
        .action(async (rest: string[]) => {
            process.exitCode = await test(rest);
        });
    program
        .command('pack')
        .description('Build a .rex')
        .action(async () => {
            const packed = await packExtension('.');

            console.log(`Checked manifest.json, api ${packed.manifest.api}\n${packed.path} (${Math.ceil(packed.bytes / 1024)} KB)\nsha256 ${packed.sha256}`);
        });
    program.command('publish').description('Pack and open a pull request on the store').action(publish);
    program
        .command('logs')
        .description('Show what server/ wrote')
        .action(async () => {
            const { id } = readManifest('.');

            console.log(await readFile(join(options.home, 'extensions', id, 'server.log'), 'utf8').catch(() => 'Nothing yet.'));
        });

    try {
        await program.parseAsync([...args], { from: 'user' });

        return Number(process.exitCode ?? 0);
    } catch (e) {
        const code = (e as { code?: string }).code;

        if (code === 'commander.helpDisplayed' || code === 'commander.help') {
            return 0;
        }

        if (code === undefined || !code.startsWith('commander.')) {
            console.error(e instanceof Error ? e.message : e);
        }

        return 1;
    }
}
