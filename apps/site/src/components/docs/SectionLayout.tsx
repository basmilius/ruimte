import type { ReactNode } from 'react';
import { PageFooter } from '@/components/docs/PageFooter';
import { Sidebar } from '@/components/docs/Sidebar';
import { SECTIONS } from '@/lib/docs/navigation';

export function SectionLayout({ href, children }: { readonly href: string; readonly children: ReactNode }) {
    const section = SECTIONS.find((each) => each.href === href);

    return (
        <div className="mx-auto flex max-w-[1240px] gap-10 px-5 sm:px-8">
            {section !== undefined && <Sidebar section={section} />}
            <main className="min-w-0 grow pt-8 pb-10 lg:pt-10">
                <article className="prose">{children}</article>
                <PageFooter />
            </main>
        </div>
    );
}
