import type { ReactNode } from 'react';
import { PageFooter } from '@/components/docs/PageFooter';
import { Sidebar, SidebarMenu } from '@/components/docs/Sidebar';
import { SECTIONS } from '@/lib/docs/navigation';

/* A section of the documentation: its pages in the sidebar, the page, and the links to the pages beside it. */
export function SectionLayout({ href, children }: { readonly href: string; readonly children: ReactNode }) {
    const section = SECTIONS.find((each) => each.href === href);

    return (
        <div className="mx-auto flex max-w-[1240px] gap-10 px-5 sm:px-8">
            {section !== undefined && <Sidebar section={section} />}
            <main className="min-w-0 grow pb-10 lg:pt-10">
                {section !== undefined && <SidebarMenu section={section} />}
                <article className="prose">{children}</article>
                <PageFooter />
            </main>
        </div>
    );
}
