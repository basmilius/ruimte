import { describe, expect, test } from 'bun:test';
import { defaultShell, defaultShellArgs, gitBash, personShell, shellName, signalExitCode } from './pty.ts';

describe('defaultShell', () => {
    test('prefers $SHELL', () => {
        expect(defaultShell({ SHELL: '/opt/fish' }, 'darwin')).toBe('/opt/fish');
    });

    test('falls back per platform when $SHELL is missing or blank', () => {
        expect(defaultShell({}, 'darwin')).toBe('/bin/zsh');
        expect(defaultShell({ SHELL: '  ' }, 'linux')).toBe('/bin/bash');
    });
});

describe('defaultShellArgs', () => {
    test('adds the login flag only for shells known to take it', () => {
        expect(defaultShellArgs('/bin/zsh')).toEqual(['-l']);
        expect(defaultShellArgs('/usr/local/bin/fish')).toEqual(['-l']);
        expect(defaultShellArgs('/usr/bin/nu')).toEqual([]);
    });

    test('PowerShell stays open with an encoded command that reports the cwd', () => {
        const args = defaultShellArgs(String.raw`C:\Windows\powershell.exe`);
        expect(args.slice(0, 3)).toEqual(['-NoLogo', '-NoExit', '-EncodedCommand']);
        expect(Buffer.from(args[3]!, 'base64').toString('utf16le')).toContain(']7;file://localhost/');
    });
});

describe('personShell', () => {
    const powershell = String.raw`C:\Windows\powershell.exe`;
    const wsl = String.raw`C:\Windows\wsl.exe`;
    const which = (program: string): string | null => ({ powershell, wsl })[program] ?? null;

    test('is the login shell outside Windows, whatever was chosen', () => {
        expect(personShell('wsl', { SHELL: '/bin/zsh' }, 'darwin', which)).toBe('/bin/zsh');
    });

    test('takes the choice on Windows, and PowerShell without one', () => {
        expect(personShell(null, {}, 'win32', which)).toBe(powershell);
        expect(personShell('wsl', {}, 'win32', which)).toBe(wsl);
        expect(personShell('cmd', { COMSPEC: 'cmd.exe' }, 'win32', which)).toBe('cmd.exe');
    });

    test('falls back to PowerShell when the choice is not there', () => {
        expect(personShell('wsl', {}, 'win32', (program) => (program === 'powershell' ? powershell : null))).toBe(powershell);
    });
});

describe('signalExitCode', () => {
    test('reports a signal death the way shells do', () => {
        expect(signalExitCode('SIGKILL', { SIGKILL: 9 })).toBe(137);
        expect(signalExitCode('SIGWEIRD', {})).toBe(128);
    });
});

describe('defaultShell on Windows', () => {
    const bash = String.raw`C:\Program Files\Git\bin\bash.exe`;

    test('finds Git Bash beside the git on PATH', () => {
        const which = (program: string): string | null => (program === 'git' ? String.raw`D:\Tools\Git\cmd\git.exe` : null);
        const found = String.raw`D:\Tools\Git\bin\bash.exe`;
        expect(defaultShell({}, 'win32', which, (path) => path === found)).toBe(found);
    });

    test('finds Git Bash in Program Files without a git on PATH', () => {
        expect(
            defaultShell(
                { ProgramFiles: String.raw`C:\Program Files` },
                'win32',
                () => null,
                (path) => path === bash
            )
        ).toBe(bash);
    });

    test('prefers PowerShell over Git Bash, and pwsh over the PowerShell of Windows', () => {
        const powershell = String.raw`C:\Windows\powershell.exe`;
        const pwsh = String.raw`C:\pwsh\pwsh.exe`;
        const inbox = (program: string): string | null => (program === 'powershell' ? powershell : null);
        const both = (program: string): string | null => (program === 'pwsh' ? pwsh : inbox(program));
        expect(defaultShell({}, 'win32', inbox, () => true)).toBe(powershell);
        expect(defaultShell({}, 'win32', both, () => true)).toBe(pwsh);
    });

    test('ignores the $SHELL a daemon started from Git Bash inherits', () => {
        const powershell = String.raw`C:\Windows\powershell.exe`;
        expect(
            defaultShell(
                { SHELL: '/usr/bin/bash' },
                'win32',
                (program) => (program === 'powershell' ? powershell : null),
                () => false
            )
        ).toBe(powershell);
    });

    test('falls back to the command prompt', () => {
        const cmd = String.raw`C:\Windows\cmd.exe`;
        expect(
            defaultShell(
                { COMSPEC: cmd },
                'win32',
                () => null,
                () => false
            )
        ).toBe(cmd);
    });
});

describe('gitBash', () => {
    test('finds bash under the git in mingw64/bin', () => {
        const which = (program: string): string | null => (program === 'git' ? String.raw`C:\Git\mingw64\bin\git.exe` : null);
        const found = String.raw`C:\Git\bin\bash.exe`;
        expect(gitBash({}, which, (path) => path === found)).toBe(found);
    });

    test('is null without Git for Windows, even with PowerShell there', () => {
        const which = (program: string): string | null => (program === 'pwsh' ? String.raw`C:\pwsh\pwsh.exe` : null);
        expect(gitBash({ COMSPEC: String.raw`C:\Windows\cmd.exe`, ProgramFiles: String.raw`C:\Program Files` }, which, () => false)).toBeNull();
    });
});

describe('shellName', () => {
    test('drops the folder and the .exe of either platform', () => {
        const bash = String.raw`C:\Program Files\Git\bin\bash.exe`;
        expect(shellName('/bin/zsh')).toBe('zsh');
        expect(shellName(bash)).toBe('bash');
        expect(defaultShellArgs(bash)).toEqual(['-l']);
    });
});
