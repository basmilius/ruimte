import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Geist, JetBrains_Mono } from 'next/font/google';
import { DocsHeader } from '@/components/DocsHeader';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
    metadataBase: new URL('https://docs.ruimte.app'),
    title: { default: 'Ruimte documentation', template: '%s · Ruimte documentation' },
    description: 'How to use Ruimte, and how to extend it.'
};

export const viewport: Viewport = {
    themeColor: '#0d0d10',
    colorScheme: 'dark'
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
    return (
        <html lang="en" className={`${geist.variable} ${jetbrains.variable}`}>
            <body>
                <DocsHeader />
                {children}
            </body>
        </html>
    );
}
