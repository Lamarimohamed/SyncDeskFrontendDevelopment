import { createPersistedStore } from '@/lib/store'

export const uiStore = createPersistedStore<{ sidebarCollapsed: boolean }>('syncdesk.ui.v1', { sidebarCollapsed: false })
