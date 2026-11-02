import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Geist, JetBrains_Mono } from 'next/font/google';
import { SECTIONS } from '@/lib/navigation';
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
                <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur-xl">
                    <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-5">
                        <Link href="/" className="flex items-center gap-2.5 font-medium text-text">
                            <img src="/app-icon-128.png" alt="" width={24} height={24} className="rounded-md" />
                            Ruimte <span className="text-text-muted">docs</span>
                        </Link>
                        <nav className="flex grow items-center gap-5 text-sm text-text-muted">
                            {SECTIONS.map((section) => (
                                <Link key={section.href} href={section.href} className="hover:text-text">
                                    {section.title}
                                </Link>
                            ))}
                        </nav>
                        <a href="https://ruimte.app" className="text-sm text-text-muted hover:text-text">
                            ruimte.app
                        </a>
                    </div>
                </header>
                {children}
            </body>
        </html>
    );
}
