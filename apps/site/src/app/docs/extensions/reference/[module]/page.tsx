import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import reference from '@/generated/reference.json';
import { CodeBlock } from '@/components/docs/CodeBlock';
import { InlineDoc } from '@/components/docs/InlineDoc';
import { Heading3 } from '@/components/docs/MdxElements';
import type { ReferenceModule } from '@/lib/docs/reference';

const MODULES = reference as ReferenceModule[];

const INTROS: Readonly<Record<string, string>> = {
    client: 'What `client/` imports. It runs in the page of every client that loads the extension.',
    server: 'What `server/` imports. It runs as one process on the machine, started on the first call.',
    ui: 'The components of Ruimte, from ADE CORE. Optional: any other React library works too.',
    charts: 'The charts of Ruimte, from ADE CORE. They follow the ADE CORE version of the Ruimte that loads the extension.',
    'agents-ui':
        'The pieces of a chat as Ruimte draws them, from ADE CORE: markdown, messages, tool rows and diffs. They draw what you hand them; `Chat` in `@ruimte/extension/client` is a chat that talks to an agent.',
    testing: 'What a test imports under `ruimte extension test`: a test host for the client, a test server and a page to draw in.'
};

export const dynamicParams = false;

export function generateStaticParams() {
    return MODULES.map(({ module }) => ({ module }));
}

export async function generateMetadata({ params }: { params: Promise<{ module: string }> }): Promise<Metadata> {
    return { title: `@ruimte/extension/${(await params).module}` };
}

export default async function ReferencePage({ params }: { params: Promise<{ module: string }> }) {
    const { module } = await params;
    const found = MODULES.find((each) => each.module === module);

    if (found === undefined) {
        notFound();
    }

    return (
        <>
            <h1>@ruimte/extension/{module}</h1>
            <p className="lead">
                <InlineDoc text={INTROS[module] ?? ''} />
            </p>
            <p>Generated from the type declarations your editor reads, so a name here is a name you can import.</p>
            {found.entries.map((entry) => (
                <section key={`${entry.kind}-${entry.name}`}>
                    <Heading3 id={entry.name}>
                        <code>{entry.name}</code>
                    </Heading3>
                    {entry.doc !== null && (
                        <p>
                            <InlineDoc text={entry.doc} />
                        </p>
                    )}
                    <CodeBlock code={entry.code} language="ts" />
                </section>
            ))}
        </>
    );
}
