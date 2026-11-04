import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { detectLaunches } from './detect.ts';

const runServer = `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="Run server" type="PhpBuiltInWebServerConfigurationType" factoryName="PHP Built-in Web Server" activateToolWindowBeforeRun="false" document_root="$PROJECT_DIR$/public" host="0.0.0.0" port="8000" router_script="$PROJECT_DIR$/dev/server.php" use_router_script="true">
    <CommandLine parameters="-dopcache.enable=1 -dopcache.jit_buffer_size=128M -dopcache.jit=tracing" />
    <method v="2" />
  </configuration>
</component>`;

const debugServer = `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="Debug server" type="PhpBuiltInWebServerConfigurationType" factoryName="PHP Built-in Web Server" activateToolWindowBeforeRun="false" document_root="$PROJECT_DIR$/public" host="0.0.0.0" port="8000" router_script="$PROJECT_DIR$/dev/server.php" use_router_script="true">
    <CommandLine parameters="-dzend_extension=&quot;xdebug.so&quot; -dopcache.enable=1 -dxdebug.mode=debug,develop,profile -dxdebug.start_with_request=yes -dxdebug.start_upon_error=yes -dxdebug.output_dir=&quot;$PROJECT_DIR$/../../../Xdebug&quot; -dxdebug.use_compression=false -dxdebug.collect_params=false" />
    <method v="2" />
  </configuration>
</component>`;

const prodServer = `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="Prod server" type="PhpBuiltInWebServerConfigurationType" factoryName="PHP Built-in Web Server" activateToolWindowBeforeRun="false" document_root="$PROJECT_DIR$/public" host="127.0.0.1" port="8000" router_script="$PROJECT_DIR$/dev/server.php" use_router_script="true">
    <CommandLine parameters="-dopcache.enable=1 -dopcache.jit_buffer_size=128M -dopcache.jit=tracing -dopcache.preload=$PROJECT_DIR$/dev/preload.php" />
    <method v="2" />
  </configuration>
</component>`;

const runTests = `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="Run tests" type="PestRunConfigurationType">
    <PestRunner directory="$PROJECT_DIR$/tests" method="" parallel_testing_enabled="true" />
    <method v="2" />
  </configuration>
</component>`;

const npmDev = `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="dev" type="js.build_tools.npm">
    <package-json value="$PROJECT_DIR$/package.json" />
    <command value="run" />
    <scripts>
      <script value="dev" />
    </scripts>
    <node-interpreter value="project" />
    <envs>
      <env name="PORT" value="3000" />
    </envs>
    <method v="2" />
  </configuration>
</component>`;

const shellScript = `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="Seed" type="ShConfigurationType">
    <option name="SCRIPT_TEXT" value="" />
    <option name="INDEPENDENT_SCRIPT_PATH" value="true" />
    <option name="SCRIPT_PATH" value="$PROJECT_DIR$/dev/seed.sh" />
    <option name="SCRIPT_OPTIONS" value="--fresh" />
    <option name="INDEPENDENT_SCRIPT_WORKING_DIRECTORY" value="true" />
    <option name="SCRIPT_WORKING_DIRECTORY" value="$PROJECT_DIR$" />
    <option name="INDEPENDENT_INTERPRETER_PATH" value="true" />
    <option name="INTERPRETER_PATH" value="/bin/bash" />
    <option name="INTERPRETER_OPTIONS" value="" />
    <option name="EXECUTE_IN_TERMINAL" value="true" />
    <option name="EXECUTE_SCRIPT_FILE" value="true" />
    <envs />
    <method v="2" />
  </configuration>
</component>`;

const phpunit = `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="Main" type="PHPUnitRunConfigurationType" factoryName="PHPUnit">
    <TestRunner configuration_file="$PROJECT_DIR$/phpunit.xml" scope="XML" use_alternative_configuration_file="true" />
    <method v="2" />
  </configuration>
</component>`;

let root: string;
let folder: string;

async function write(path: string, text: string): Promise<void> {
    await mkdir(join(folder, path, '..'), { recursive: true });
    await writeFile(join(folder, path), text);
}

const newHome = tempHomes('ruimte-detect-');

beforeEach(async () => {
    root = await newHome();
    folder = join(root, 'projects', 'passly');
    await mkdir(join(folder, 'backend', '.idea'), { recursive: true });
    await write('backend/dev/run/Run server.run.xml', runServer);
    await write('backend/dev/run/Debug server.run.xml', debugServer);
    await write('backend/dev/run/Prod server.run.xml', prodServer);
    await write('backend/dev/run/Run tests.run.xml', runTests);
    await write('backend/dev/run/Main.run.xml', phpunit);
    await write(
        'frontend/package.json',
        JSON.stringify({ scripts: { dev: 'vite', build: 'vue-tsc -b && vite build', preview: 'vite preview', postinstall: 'touch vite.config.ts' } })
    );
    await write('frontend/bun.lock', '');
});

describe('run configurations', () => {
    test('a PHP server puts its flags before -S, with the document root and the router after', async () => {
        await write(
            'backend/dev/run/Run server.run.xml',
            runServer
                .replace('name="Run server"', 'name="Run &amp; &#65; &quot;b&quot;"')
                .replace('$PROJECT_DIR$/public', '$PROJECT_DIR$/public &amp; &#65;')
                .replace('<method v="2" />', '<envs><env name="TOKEN" value="&quot;b&quot; &amp; &#65;"/></envs>')
        );
        const suggestions = await detectLaunches(folder, [join(folder, 'backend'), join(folder, 'frontend')]);
        const server = suggestions.find((suggestion) => suggestion.launch.name === 'Run & A "b"');
        expect(server).toMatchObject({
            source: 'run-xml',
            path: 'backend/dev/run/Run server.run.xml',
            detail: 'PHP Built-in Web Server',
            private: false,
            launch: {
                id: 'run-a-b',
                name: 'Run & A "b"',
                env: { TOKEN: '"b" & A' },
                kind: 'service',
                cwd: 'backend',
                command: "php -dopcache.enable=1 -dopcache.jit_buffer_size=128M -dopcache.jit=tracing -S 0.0.0.0:8000 -t 'public & A' dev/server.php",
                url: 'http://localhost:8000'
            }
        });
    });

    test('a path inside the project is written from the launch folder', async () => {
        const suggestions = await detectLaunches(folder, [join(folder, 'backend')]);
        const prod = suggestions.find((suggestion) => suggestion.launch.name === 'Prod server');
        expect(prod?.launch.command).toBe(
            'php -dopcache.enable=1 -dopcache.jit_buffer_size=128M -dopcache.jit=tracing -dopcache.preload=dev/preload.php -S 127.0.0.1:8000 -t public dev/server.php'
        );
        expect(prod?.launch.url).toBe('http://127.0.0.1:8000');
    });

    test('a path outside the project keeps the launch on this machine', async () => {
        const suggestions = await detectLaunches(folder, [join(folder, 'backend')]);
        const debug = suggestions.find((suggestion) => suggestion.launch.name === 'Debug server');
        expect(debug?.private).toBe(true);
        expect(debug?.launch.command).toContain(`-dxdebug.output_dir="${join(root, 'Xdebug')}"`);
        expect(debug?.launch.command).toStartWith('php -dzend_extension="xdebug.so" ');
        expect(debug?.launch.command).toEndWith(' -S 0.0.0.0:8000 -t public dev/server.php');
    });

    test('Pest runs its directory, in parallel when the file says so', async () => {
        const suggestions = await detectLaunches(folder, [join(folder, 'backend')]);
        expect(suggestions.find((suggestion) => suggestion.launch.name === 'Run tests')).toMatchObject({
            detail: 'Pest, parallel',
            launch: { kind: 'task', cwd: 'backend', command: 'vendor/bin/pest --parallel tests' }
        });
    });

    test('a type the import cannot read is shown with its reason', async () => {
        const suggestions = await detectLaunches(folder, [join(folder, 'backend')]);
        expect(suggestions.find((suggestion) => suggestion.launch.name === 'Main')).toMatchObject({ unsupported: 'PHPUnit', launch: { kind: 'task' } });
    });

    test('npm and shell script configurations', async () => {
        await write('web/.run/dev.run.xml', npmDev);
        await write('web/.run/seed.run.xml', shellScript);
        await mkdir(join(folder, 'web', '.idea'), { recursive: true });
        const suggestions = await detectLaunches(folder, [join(folder, 'web')]);
        expect(suggestions.find((suggestion) => suggestion.launch.name === 'dev')?.launch).toMatchObject({
            kind: 'service',
            cwd: 'web',
            command: 'npm run dev',
            env: { PORT: '3000' }
        });
        expect(suggestions.find((suggestion) => suggestion.launch.name === 'Seed')?.launch).toMatchObject({
            kind: 'task',
            cwd: 'web',
            command: '/bin/bash dev/seed.sh --fresh'
        });
    });

    test('a backup copy and hidden tooling folders are left alone', async () => {
        await write('~backup/backend/dev/run/Run server.run.xml', runServer);
        await write('.cache/Run server.run.xml', runServer);
        const suggestions = await detectLaunches(folder, [join(folder, 'backend')]);
        expect(suggestions.filter((suggestion) => suggestion.launch.name === 'Run server')).toHaveLength(1);
    });
});

describe('package scripts', () => {
    test('run through the package manager of the lockfile, without the install hooks', async () => {
        await write(
            'frontend/package.json',
            JSON.stringify({
                scripts: {
                    dev: 'vite',
                    build: 'vite build',
                    preview: 'vite preview',
                    postinstall: 'touch vite.config.ts',
                    'dev:port': 'vite --port 3001',
                    'dev:next': 'next dev',
                    'serve:build': 'vite build',
                    'serve:node': 'node server.js'
                }
            })
        );
        const suggestions = (await detectLaunches(folder, [join(folder, 'frontend')])).filter((suggestion) => suggestion.source === 'package-json');
        expect(suggestions.map((suggestion) => [suggestion.launch.id, suggestion.launch.kind, suggestion.launch.command, suggestion.launch.url])).toEqual([
            ['dev', 'service', 'bun run dev', 'http://localhost:5173'],
            ['build', 'task', 'bun run build', undefined],
            ['preview', 'service', 'bun run preview', 'http://localhost:4173'],
            ['dev-port', 'service', 'bun run dev:port', 'http://localhost:3001'],
            ['dev-next', 'service', 'bun run dev:next', 'http://localhost:3000'],
            ['serve-build', 'service', 'bun run serve:build', undefined],
            ['serve-node', 'service', 'bun run serve:node', undefined]
        ]);
        expect(suggestions[0]).toMatchObject({ source: 'package-json', path: 'frontend/package.json', detail: 'dev' });
    });

    test('composer scripts, without its own events', async () => {
        await write('api/composer.json', JSON.stringify({ scripts: { serve: 'php -S localhost:8080', 'post-install-cmd': 'x', lint: 'phpcs' } }));
        const suggestions = (await detectLaunches(folder, [join(folder, 'api')])).filter((suggestion) => suggestion.source === 'composer-json');
        expect(suggestions.map((suggestion) => [suggestion.launch.name, suggestion.launch.kind, suggestion.launch.command])).toEqual([
            ['Serve', 'service', 'composer run serve'],
            ['Lint', 'task', 'composer run lint']
        ]);
    });

    test('ids stay unique over the suggestions', async () => {
        await write('shop/package.json', JSON.stringify({ scripts: { dev: 'nuxt dev', 'Build:no-check': 'tsc', '!!!': 'node server.js' } }));
        const suggestions = await detectLaunches(folder, [join(folder, 'frontend'), join(folder, 'shop')]);
        expect(suggestions.filter((suggestion) => suggestion.launch.name === 'Dev').map((suggestion) => suggestion.launch.id)).toEqual(['dev', 'dev-2']);
        expect(suggestions.find((suggestion) => suggestion.detail === 'Build:no-check')?.launch.id).toBe('build-no-check');
        expect(suggestions.find((suggestion) => suggestion.detail === '!!!')?.launch.id).toBe('launch');
        expect(suggestions.find((suggestion) => suggestion.launch.name === 'Run server')?.launch.id).toBe('run-server');
    });
});

describe('VS Code launch configurations', () => {
    const launchFile = JSON.stringify({
        configurations: [{ type: 'node', request: 'launch', name: 'Api', program: '${workspaceFolder}/server.js', args: ['--name', 'a b'] }]
    });

    test('each checkout gets its own working folder, and only when the request names the source', async () => {
        await write('.vscode/launch.json', launchFile);
        await write('backend/.vscode/launch.json', launchFile);
        const sources = ['vscode-launch'];
        const suggestions = (await detectLaunches(folder, [join(folder, 'backend')], { sources })).filter(
            (suggestion) => suggestion.source === 'vscode-launch'
        );
        expect(suggestions.map((suggestion) => [suggestion.path, suggestion.launch.cwd])).toEqual([
            ['.vscode/launch.json', undefined],
            ['backend/.vscode/launch.json', 'backend']
        ]);
        expect(suggestions[0]!.launch.command).toBe("node server.js --name 'a b'");
    });

    test('without sources, no VS Code suggestion is sent', async () => {
        await write('.vscode/launch.json', launchFile);
        const suggestions = await detectLaunches(folder, [join(folder, 'backend')]);
        expect(suggestions.some((suggestion) => suggestion.source === 'vscode-launch')).toBe(false);
    });
});

describe('Flutter', () => {
    test('suggests the web run as a service with its address and the device run as a task, when the request names the source', async () => {
        await write('app/pubspec.yaml', 'name: atlas\n');
        const suggestions = (await detectLaunches(folder, [join(folder, 'app')], { sources: ['pubspec-yaml'] })).filter(
            (suggestion) => suggestion.source === 'pubspec-yaml'
        );

        expect(suggestions.map((suggestion) => [suggestion.path, suggestion.launch])).toEqual([
            [
                'app/pubspec.yaml',
                {
                    id: 'flutter-web',
                    name: 'Flutter web',
                    kind: 'service',
                    cwd: 'app',
                    command: 'flutter run -d web-server --web-port 8080',
                    url: 'http://localhost:8080'
                }
            ],
            ['app/pubspec.yaml', { id: 'flutter', name: 'Flutter', kind: 'task', cwd: 'app', command: 'flutter run' }]
        ]);
    });

    test('without the source, no Flutter suggestion is sent', async () => {
        await write('pubspec.yaml', 'name: atlas\n');
        expect((await detectLaunches(folder, [])).some((suggestion) => suggestion.source === 'pubspec-yaml')).toBe(false);
    });
});
