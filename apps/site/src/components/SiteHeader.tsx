'use client';

import { type ReactNode, useEffect, useState } from 'react';

/**
 * The bar over the page. At the top it is glass over the hero, so the stars run on behind it; once
 * the page scrolls it takes a ground and a line of its own.
 */
export function SiteHeader({ children }: { readonly children: ReactNode }) {
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const update = () => setScrolled(window.scrollY > 8);
        update();
        window.addEventListener('scroll', update, { passive: true });
        return () => window.removeEventListener('scroll', update);
    }, []);

    return (
        <header
            className={`fixed inset-x-0 top-0 z-30 border-b backdrop-blur-xl transition-colors duration-300 ${scrolled ? 'border-border bg-bg/70' : 'border-transparent bg-transparent'}`}
        >
            {children}
        </header>
    );
}
