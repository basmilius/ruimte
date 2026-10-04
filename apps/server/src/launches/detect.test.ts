import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectLaunches, parseXml, scriptAddress, slugOf } from './detect.ts';

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

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-detect-'));
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

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('run configurations', () => {
    test('a PHP server puts its flags before -S, with the document root and the router after', async () => {
        const suggestions = await detectLaunches(folder, [join(folder, 'backend'), join(folder, 'frontend')]);
        const server = suggestions.find((suggestion) => suggestion.launch.name === 'Run server');
        expect(server).toMatchObject({
            source: 'run-xml',
            path: 'backend/dev/run/Run server.run.xml',
            detail: 'PHP Built-in Web Server',
            private: false,
            launch: {
                id: 'run-server',
                kind: 'service',
                cwd: 'backend',
                command: 'php -dopcache.enable=1 -dopcache.jit_buffer_size=128M -dopcache.jit=tracing -S 0.0.0.0:8000 -t public dev/server.php',
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
        const suggestions = (await detectLaunches(folder, [join(folder, 'frontend')])).filter((suggestion) => suggestion.source === 'package-json');
        expect(suggestions.map((suggestion) => [suggestion.launch.id, suggestion.launch.kind, suggestion.launch.command, suggestion.launch.url])).toEqual([
            ['dev', 'service', 'bun run dev', 'http://localhost:5173'],
            ['build', 'task', 'bun run build', undefined],
            ['preview', 'service', 'bun run preview', 'http://localhost:4173']
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
        await write('shop/package.json', JSON.stringify({ scripts: { dev: 'nuxt dev' } }));
        const suggestions = await detectLaunches(folder, [join(folder, 'frontend'), join(folder, 'shop')]);
        expect(suggestions.filter((suggestion) => suggestion.launch.name === 'Dev').map((suggestion) => suggestion.launch.id)).toEqual(['dev', 'dev-2']);
    });
});

describe('the pieces', () => {
    test('entities in attributes are decoded', () => {
        const document = parseXml('<a x="&quot;b&quot; &amp; &#65;"><c/></a>');
        expect(document.children[0]?.attributes.x).toBe('"b" & A');
        expect(document.children[0]?.children[0]?.name).toBe('c');
    });

    test('an address from the dev server a script runs', () => {
        expect(scriptAddress('vite --port 3001')).toBe('http://localhost:3001');
        expect(scriptAddress('vite build')).toBeUndefined();
        expect(scriptAddress('next dev')).toBe('http://localhost:3000');
        expect(scriptAddress('node server.js')).toBeUndefined();
    });

    test('a name becomes an id', () => {
        expect(slugOf('Run server')).toBe('run-server');
        expect(slugOf('Build:no-check')).toBe('build-no-check');
        expect(slugOf('!!!')).toBe('launch');
    });
});
