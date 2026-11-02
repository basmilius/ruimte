import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DocsHeader } from '@/components/docs/DocsHeader';
import './docs.css';

export const metadata: Metadata = {
    title: { default: 'Ruimte documentation', template: '%s · Ruimte documentation' },
    description: 'How Ruimte works, how to use it, and how to extend it.'
};

export default function DocsLayout({ children }: { readonly children: ReactNode }) {
    return (
        <>
            <DocsHeader />
            {children}
        </>
    );
}
