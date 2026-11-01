import { defineSidebarCard } from '@ruimte/extension/client';

defineSidebarCard({
    id: 'limits',
    title: 'Limits',
    component: () => import('./LimitsCard')
});
