import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RECYCLE_BIN_SOURCE, recycleBinCommand } from './recycle-bin.ts';

/* The helper only runs on Windows, but PowerShell 7 compiles it anywhere, so a broken source fails here and not first on a PC. */
const powershell = process.platform === 'win32' ? 'powershell.exe' : Bun.which('pwsh');

let folder: string;

beforeEach(async () => {
    folder = await mkdtemp(join(process.env.RUIMTE_INTEGRATION_FIXTURE_ROOT ?? tmpdir(), 'ruimte-recycle-bin-'));
});

afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
});

async function run(command: string[], env: Record<string, string>): Promise<{ code: number; output: string; errors: string }> {
    const child = Bun.spawn(command, { env: { ...process.env, ...env }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', windowsHide: true });
    const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, output, errors };
}

describe.skipIf(powershell === null)('the Recycle Bin helper', () => {
    test('compiles as C# 5 without a warning, which Windows PowerShell 5.1 counts as an error', async () => {
        const script =
            // Windows PowerShell has no -CompilerOptions, and is the C# 5 compiler itself.
            "$ErrorActionPreference = 'Stop'; if ($PSVersionTable.PSVersion.Major -ge 6) { Add-Type -TypeDefinition $env:RUIMTE_TEST_SOURCE -CompilerOptions '/langversion:5', '/warnaserror' } else { Add-Type -TypeDefinition $env:RUIMTE_TEST_SOURCE }; 'compiled'";

        const result = await run([powershell ?? '', '-NoProfile', '-NonInteractive', '-Command', script], { RUIMTE_TEST_SOURCE: RECYCLE_BIN_SOURCE });

        expect(result.errors).toBe('');
        expect(result.output.trim()).toBe('compiled');
        expect(result.code).toBe(0);
    }, 60_000);

    test('compiles the helper once, keeps it under its own name, and writes a failure as plain text', async () => {
        const source = join(folder, 'recycle-bin-test.cs');
        const assembly = join(folder, 'recycle-bin-test.dll');
        await writeFile(source, RECYCLE_BIN_SOURCE);
        const command = [powershell ?? '', ...recycleBinCommand().slice(1)];
        // A path that is not there fails inside the helper on Windows, and off Windows the call into kernel32 does.
        const env = { RUIMTE_TRASH_PATH: join(folder, 'missing.txt'), RUIMTE_RECYCLE_BIN_SOURCE: source, RUIMTE_RECYCLE_BIN_ASSEMBLY: assembly };

        const first = await run(command, env);
        expect((await readdir(folder)).sort()).toEqual(['recycle-bin-test.cs', 'recycle-bin-test.dll']);
        // Without its source the helper can only come from the assembly the first run kept.
        await rm(source);
        const second = await run(command, env);

        for (const result of [first, second]) {
            expect(result.code).toBe(1);
            expect(result.errors).not.toContain('CLIXML');
            expect(result.errors.trim()).not.toBe('');
        }
        expect(second.errors).toBe(first.errors);
    }, 60_000);
});
