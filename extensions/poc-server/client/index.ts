import { defineNode, definePanel } from '@ruimte/extension/client';

definePanel({ id: 'panel', title: 'POC server', icon: 'server', component: () => import('./ServerPanel') });
defineNode({ id: 'fact', title: 'POC fact', icon: 'server', initialData: { fact: 'The answer is 42' }, component: () => import('./FactNode') });
