import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, watch } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import * as prompts from '@clack/prompts';
import { Command } from 'commander';
import { bunRuntime } from '../language/runtime.ts';
import { BUILD_FOLDER, buildExtension, packExtension, readManifest } from '../extensions/pack.ts';
import { scaffoldFiles, type ScaffoldAnswers } from '../extensions/scaffold.ts';
// @ts-expect-error Bun hands over the file's text, so a compiled daemon carries it; TypeScript only knows the module.
import testRuntime from '../extensions/test-runtime.ts' with { type: 'text' };
import { commandIo, homeSecret, startFirst, type LocalDaemonOptions } from './local-daemon.ts';

const STORE_REPOSITORY = 'ruimte-app/extensions';
const WATCH_DEBOUNCE_MS = 150;

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
    const folder = resolve(answers.id.split('.').join('-'));

    if (existsSync(folder)) {
        throw new Error(`${folder} already exists`);
    }

    for (const [path, content] of Object.entries(scaffoldFiles(answers))) {
        await mkdir(join(folder, path, '..'), { recursive: true });
        await writeFile(join(folder, path), content);
    }

    const runtime = bunRuntime();

    spawnSync(runtime.command, [...runtime.args, 'install'], { cwd: folder, env: { ...process.env, ...runtime.env }, stdio: 'ignore' });

    if (answers.git) {
        spawnSync('git', ['init', '-q'], { cwd: folder });
    }

    console.log(`Created ${folder}\n\nNext: cd ${basename(folder)} && bun run dev`);
}

/* Builds on every save and tells the machine, which restarts `server/` and has the client load the new build. */
async function dev(options: LocalDaemonOptions): Promise<void> {
    const folder = resolve('.');
    const manifest = readManifest(folder);
    let timer: ReturnType<typeof setTimeout> | null = null;

    const rebuild = async (): Promise<void> => {
        try {
            const { outdir } = await buildExtension(folder);

            await askDaemon(options, '/extensions/link', { folder: outdir });
            console.log(`${new Date().toLocaleTimeString()} ${manifest.name} is loaded`);
        } catch (e) {
            console.error(e instanceof Error ? e.message : e);
        }
    };

    await rebuild();
    watch(folder, { recursive: true }, (_event, name) => {
        if (name === null || name.startsWith(BUILD_FOLDER) || name.startsWith('node_modules') || name.startsWith('dist') || name.startsWith('.git')) {
            return;
        }

        if (timer !== null) {
            clearTimeout(timer);
        }

        timer = setTimeout(() => void rebuild(), WATCH_DEBOUNCE_MS);
    });
    process.on('SIGINT', () => {
        void askDaemon(options, '/extensions/unlink', { id: manifest.id })
            .catch(() => undefined)
            .finally(() => process.exit(0));
    });
    console.log('Watching for changes. Ctrl-C takes it out of Ruimte again.');
    await new Promise(() => undefined);
}

async function test(args: string[]): Promise<number> {
    const folder = mkdtempSync(join(tmpdir(), 'ruimte-extension-test-'));
    const preload = join(folder, 'preload.ts');

    await writeFile(preload, testRuntime);

    const runtime = bunRuntime();
    const child = spawn(runtime.command, [...runtime.args, 'test', '--preload', preload, ...args], {
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
