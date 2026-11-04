import type { ReactNode } from 'react';
import { SectionLayout } from '@/components/docs/SectionLayout';

export default function GuideLayout({ children }: { readonly children: ReactNode }) {
    return <SectionLayout href="/docs/guide">{children}</SectionLayout>;
}
