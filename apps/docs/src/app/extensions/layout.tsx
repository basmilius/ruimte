import type { ReactNode } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { PageFooter } from '@/components/PageFooter';
import { SECTIONS } from '@/lib/navigation';

export default function ExtensionsLayout({ children }: { readonly children: ReactNode }) {
    const section = SECTIONS.find((each) => each.href === '/extensions');

    return (
        <div className="mx-auto flex max-w-7xl gap-10 px-5 sm:px-8">
            {section !== undefined && <Sidebar section={section} />}
            <main className="min-w-0 grow py-10">
                <article className="prose">{children}</article>
                <PageFooter />
            </main>
        </div>
    );
}
