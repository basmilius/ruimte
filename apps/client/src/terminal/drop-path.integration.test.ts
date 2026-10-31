import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitBash } from '../../../server/src/pty/pty.ts';
import { shellQuotedPaths } from './drop-path';

// A name that would write a canary next to the output if the shell ran any part of it.
const NAMES = [
    "C:/repo/O'Neil$(whoami).txt",
    'C:\\repo\\x`whoami`.txt',
    'C:\\repo\\$env:USERNAME $HOME.txt',
    'C:\\repo\\semi;echo pwned>canary.txt;b.txt',
    'C:\\My Files\\plain name.txt'
];
const AMPERSAND = 'C:\\repo\\a&echo pwned>canary.txt&b.txt';
const TYPOGRAPHIC = 'C:\\repo\\it\u2019s $(whoami).txt';

describe.skipIf(process.platform !== 'win32')('a dropped path typed in a real shell on Windows', () => {
    let folder = '';
    let argvScript = '';
    const output = (): string => join(folder, 'argv.json');

    beforeAll(async () => {
        folder = await mkdtemp(join(tmpdir(), 'ruimte-drop-path-'));
        argvScript = join(folder, 'argv.js');
        await writeFile(argvScript, 'require("fs").writeFileSync(process.env.ARGV_OUT, JSON.stringify(process.argv.slice(2)));\n');
    });

    afterAll(async () => {
        await rm(folder, { recursive: true, force: true });
    });

    const run = async (command: string[], stdin: string | null): Promise<string[]> => {
        await rm(output(), { force: true });
        const child = Bun.spawn(command, {
            cwd: folder,
            env: { ...process.env, ARGV_OUT: output() },
            stdin: stdin === null ? 'ignore' : new TextEncoder().encode(stdin),
            stdout: 'ignore',
            stderr: 'ignore'
        });
        await child.exited;
        expect(await readdir(folder)).not.toContain('canary.txt');
        return JSON.parse(await readFile(output(), 'utf8'));
    };

    test('PowerShell hands over each path as it is', async () => {
        const paths = [...NAMES, AMPERSAND, TYPOGRAPHIC];
        const script = join(folder, 'typed.ps1');
        const quoted = (text: string): string => `'${text.replaceAll("'", "''")}'`;
        // With a byte order mark, or PowerShell 5.1 reads a typographic quote in the system's code page.
        await writeFile(script, `\ufeff& ${quoted(process.execPath)} ${quoted(argvScript)} ${shellQuotedPaths(paths, 'win32', 'powershell')}\n`);
        const args = await run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], null);
        expect(args).toEqual(paths);
    });

    test.skipIf(gitBash() === null)('Git Bash hands over each path as it is', async () => {
        const paths = [...NAMES, AMPERSAND, TYPOGRAPHIC];
        const line = `'${process.execPath.replaceAll('\\', '/')}' '${argvScript.replaceAll('\\', '/')}' ${shellQuotedPaths(paths, 'win32', 'bash')}\n`;
        const args = await run([gitBash()!, '--noprofile', '--norc', '-s'], line);
        expect(args).toEqual(paths);
    });

    test('cmd hands over each path as it is', async () => {
        const paths = [...NAMES, AMPERSAND, 'C:\\'];
        const args = await run(['cmd.exe', '/d', '/q', '/k'], `"${process.execPath}" "${argvScript}" ${shellQuotedPaths(paths, 'win32', 'cmd')}\nexit\n`);
        expect(args).toEqual(paths);
    });
});
