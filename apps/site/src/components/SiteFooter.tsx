import { AppIcon } from '@/components/AppIcon.tsx';
import { REPOSITORY_URL, SPONSOR_URL } from '@/lib/release.ts';

const LINKS = [
    { title: 'Source', href: REPOSITORY_URL },
    { title: 'License', href: `${REPOSITORY_URL}/blob/main/LICENSE` },
    { title: 'Releases', href: `${REPOSITORY_URL}/releases` },
    { title: 'Privacy', href: '/privacy' },
    { title: 'Sponsor', href: SPONSOR_URL }
] as const;

export function SiteFooter() {
    return (
        <footer className="border-t border-border">
            <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-10 text-sm text-text-muted sm:px-8">
                <AppIcon size={22} />
                <span>
                    Made by{' '}
                    <a href="https://bas.dev" className="text-text hover:underline">
                        Bas Milius
                    </a>
                    . Ruimte is Dutch for space, and room.
                </span>
                <span className="ml-auto flex gap-6">
                    {LINKS.map((link) => (
                        <a key={link.title} href={link.href} className="hover:text-text">
                            {link.title}
                        </a>
                    ))}
                </span>
            </div>
        </footer>
    );
}
