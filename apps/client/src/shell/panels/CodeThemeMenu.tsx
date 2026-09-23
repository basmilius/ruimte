import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import { Check, ChevronRight, Palette } from 'lucide-react';
import { bundledThemesInfo } from 'shiki/themes';
import { useCodeThemes } from '@/state/code-theme';
import { useTheme } from '@/state/theme';
import { Icon } from '@/ui/Icon';
import { MenuPopup } from '@/ui/MenuPopup';

// TODO(Bas): temporary, goes together with the store in `state/code-theme.ts` once the colors are picked.
/* Only the themes of the app's current mode, so each is judged against the ground it would be drawn on. */
export function CodeThemeMenu() {
    const { t } = useTranslation('panels');
    const mode = useTheme((s) => s.resolved);
    const current = useCodeThemes((s) => s[mode]);
    const themes = bundledThemesInfo.filter((info) => info.type === mode);

    return (
        <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className="menu-item">
                <Icon icon={Palette} size={14} />
                {t('file.codeTheme')}
                <Icon icon={ChevronRight} size={14} className="ml-auto" />
            </Menu.SubmenuTrigger>
            <MenuPopup side="right" sideOffset={4} className="max-h-96 min-w-52 overflow-y-auto">
                <Menu.RadioGroup value={current} onValueChange={(value: string) => useCodeThemes.getState().setCodeTheme(mode, value)}>
                    {themes.map((info) => (
                        <Menu.RadioItem key={info.id} value={info.id} className="menu-item" closeOnClick={false}>
                            <span className="grid h-4 w-4 place-items-center">
                                <Menu.RadioItemIndicator>
                                    <Icon icon={Check} size={14} />
                                </Menu.RadioItemIndicator>
                            </span>
                            {info.displayName}
                        </Menu.RadioItem>
                    ))}
                </Menu.RadioGroup>
            </MenuPopup>
        </Menu.SubmenuRoot>
    );
}
