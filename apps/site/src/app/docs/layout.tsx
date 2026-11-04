import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import './docs.css';

export const metadata: Metadata = {
    title: { default: 'Ruimte documentation', template: '%s · Ruimte documentation' },
    description: 'How Ruimte works, how to use it, and how to extend it.'
};

export default function DocsLayout({ children }: { readonly children: ReactNode }) {
    return (
        <>
            <SiteHeader />
            {children}
            <SiteFooter />
        </>
    );
}
