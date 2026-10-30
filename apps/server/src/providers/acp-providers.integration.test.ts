import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createGrokProvider } from './acp-providers.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';

const newHome = tempHomes('ruimte-grok-account-');

test.skipIf(process.platform === 'win32')('account discovery runs only grok models in the account environment', async () => {
    const home = await newHome();
    const command = join(home, 'grok');
    const output = ['You are logged in with grok.com.', 'Default model: grok-4.7', 'Available models:', '  * grok-4.7'].join('\n');
    await writeFile(
        command,
        `#!${process.execPath}
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
writeFileSync(join(process.env.GROK_HOME, 'called.json'), JSON.stringify(process.argv.slice(2)));
console.log(${JSON.stringify(output)});
`,
        { mode: 0o700 }
    );
    const provider = createGrokProvider();
    expect(await provider.askAccount!([command, 'agent', 'stdio'], { ...process.env, GROK_HOME: home })).toEqual({
        signedIn: true,
        email: null,
        plan: null,
        organization: null
    });
    expect(JSON.parse(await readFile(join(home, 'called.json'), 'utf8'))).toEqual(['--no-auto-update', 'models']);
    expect(provider.catalog.defaultModel).toBe('grok-4.7');
    expect(provider.catalog.list().map((model) => model.slug)).toEqual(['grok-4.7']);
});
