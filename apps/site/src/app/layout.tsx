import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Geist, JetBrains_Mono, Kalam } from 'next/font/google';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });
const kalam = Kalam({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-kalam', display: 'swap' });

export const metadata: Metadata = {
    metadataBase: new URL('https://ruimte.app'),
    title: 'Ruimte: Space for AI Engineering',
    description:
        'Terminals, coding agents and browsers on one canvas. Ruimte shows which agent is waiting on you, keeps sessions running when you close the window, and opens your projects on any machine.',
    openGraph: {
        title: 'Ruimte',
        description: 'Space for AI Engineering. Terminals, coding agents and browsers on one canvas.',
        url: 'https://ruimte.app',
        siteName: 'Ruimte',
        type: 'website'
    }
};

export const viewport: Viewport = {
    themeColor: '#0d0d10',
    colorScheme: 'dark'
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
    return (
        <html lang="en" className={`${geist.variable} ${jetbrains.variable} ${kalam.variable}`}>
            <body>{children}</body>
        </html>
    );
}
