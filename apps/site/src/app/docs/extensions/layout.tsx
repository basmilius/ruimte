import type { ReactNode } from 'react';
import { SectionLayout } from '@/components/docs/SectionLayout';

export default function ExtensionsLayout({ children }: { readonly children: ReactNode }) {
    return <SectionLayout href="/docs/extensions">{children}</SectionLayout>;
}
