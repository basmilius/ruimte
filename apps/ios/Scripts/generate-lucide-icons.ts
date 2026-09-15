import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PROJECT_ICON_NAMES } from '../../../packages/contracts/src/project';

const root = resolve(import.meta.dir, '../../..');
const packageRoot = dirname(Bun.resolveSync('lucide-react/package.json', resolve(root, 'apps/client')));
const assets = resolve(root, 'apps/ios/App/Assets.xcassets');
const extra = ['frame', 'message-square', 'pen-tool', 'workflow', 'circle-question-mark', 'sticky-note', 'layout-grid'];
const names = [...new Set([...PROJECT_ICON_NAMES, ...extra])].sort();
const escape = (value: unknown) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

for (const name of names) {
    const { __iconData } = await import(resolve(packageRoot, `dist/esm/icons/${name}.mjs`));
    const nodes = __iconData.node.map(([tag, attributes]: [string, Record<string, unknown>]) => {
        const serialized = Object.entries(attributes)
            .filter(([key]) => key !== 'key')
            .map(([key, value]) => `${key}="${escape(value)}"`)
            .join(' ');
        return `    <${tag} ${serialized} />`;
    });
    const directory = resolve(assets, `Lucide-${name}.imageset`);
    await mkdir(directory, { recursive: true });
    await writeFile(
        resolve(directory, 'icon.svg'),
        [
            '<!-- Lucide Icons, ISC license. See App/Design/Lucide-LICENSE.txt. -->',
            `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 ${__iconData.size} ${__iconData.size}" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`,
            ...nodes,
            '</svg>',
            ''
        ].join('\n')
    );
    await writeFile(
        resolve(directory, 'Contents.json'),
        JSON.stringify(
            {
                images: [{ filename: 'icon.svg', idiom: 'universal' }],
                info: { author: 'xcode', version: 1 },
                properties: { 'preserves-vector-representation': true, 'template-rendering-intent': 'template' }
            },
            null,
            4
        ) + '\n'
    );
}
await writeFile(resolve(root, 'apps/ios/App/Design/Lucide-LICENSE.txt'), await readFile(resolve(packageRoot, 'LICENSE')));
console.log(`Updated ${names.length} Lucide vector assets from the installed lucide-react package.`);
