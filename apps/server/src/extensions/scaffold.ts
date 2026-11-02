import { EXTENSION_API_VERSION } from '@ruimte/contracts';

export interface ScaffoldAnswers {
    name: string;
    id: string;
    description: string;
    parts: 'client' | 'server' | 'both';
    surface: 'panel' | 'node' | 'view' | 'card' | 'none';
    git: boolean;
}

const GITIGNORE = 'node_modules\ndist\n';

const TSCONFIG = `${JSON.stringify(
    {
        compilerOptions: {
            target: 'ES2023',
            module: 'ESNext',
            moduleResolution: 'bundler',
            jsx: 'react-jsx',
            lib: ['ES2023', 'DOM'],
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            types: ['bun']
        },
        include: ['client', 'server']
    },
    null,
    4
)}\n`;

const DEFINE: Readonly<Record<'panel' | 'node' | 'view' | 'card', (title: string) => string>> = {
    panel: (title) => `definePanel({ id: 'main', title: ${JSON.stringify(title)}, icon: 'package', component: () => import('./Main') });`,
    node: (title) => `defineNode({ id: 'main', title: ${JSON.stringify(title)}, icon: 'package', component: () => import('./Main') });`,
    view: (title) => `defineView({ id: 'main', title: ${JSON.stringify(title)}, component: () => import('./Main') });`,
    card: (title) => `defineSidebarCard({ id: 'main', title: ${JSON.stringify(title)}, component: () => import('./Main') });`
};

const FUNCTION_OF: Readonly<Record<'panel' | 'node' | 'view' | 'card', string>> = {
    panel: 'definePanel',
    node: 'defineNode',
    view: 'defineView',
    card: 'defineSidebarCard'
};

function mainComponent(withServer: boolean, name: string): string {
    if (withServer) {
        return `import { useServer } from '@ruimte/extension/client';
import type server from '../server';

export default function Main() {
    const greeting = useServer<typeof server>().greeting.use();

    return <p>{greeting.ok ? greeting.value : greeting.error.message}</p>;
}
`;
    }

    return `export default function Main() {
    return <p>Hello from ${name}</p>;
}
`;
}

/* A project that builds and runs as it is, with an example of what was asked for. */
export function scaffoldFiles(answers: ScaffoldAnswers): Record<string, string> {
    const withClient = answers.parts !== 'server' && answers.surface !== 'none';
    const withServer = answers.parts !== 'client';
    const files: Record<string, string> = {
        '.gitignore': GITIGNORE,
        'tsconfig.json': TSCONFIG,
        'assets/icon.svg':
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="4"/></svg>\n',
        'manifest.json': `${JSON.stringify({ id: answers.id, name: answers.name, version: '0.1.0', api: EXTENSION_API_VERSION, ...(answers.description === '' ? {} : { description: answers.description }), permissions: {} }, null, 4)}\n`,
        'package.json': `${JSON.stringify(
            {
                name: answers.id.replace('.', '-'),
                private: true,
                scripts: { dev: 'bunx ruimte extension dev', test: 'bunx ruimte extension test', pack: 'bunx ruimte extension pack' },
                devDependencies: {
                    '@ruimte/extension': `^${EXTENSION_API_VERSION}.0.0`,
                    '@types/bun': 'latest',
                    '@types/react': '^19.0.0',
                    react: '^19.0.0',
                    'react-dom': '^19.0.0',
                    typescript: '^5.0.0'
                }
            },
            null,
            4
        )}\n`
    };

    if (withClient && answers.surface !== 'none') {
        const surface = answers.surface;

        files['client/index.ts'] = `import { ${FUNCTION_OF[surface]} } from '@ruimte/extension/client';\n\n${DEFINE[surface](answers.name)}\n`;
        files['client/Main.tsx'] = mainComponent(withServer, answers.name);
    }

    if (withServer) {
        files['server/index.ts'] = `import { defineServer } from '@ruimte/extension/server';

export default defineServer({
    async greeting() {
        return 'Hello from ${answers.name.replaceAll("'", "\\'")}';
    }
});
`;
    }

    return files;
}
