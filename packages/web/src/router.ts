import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from './stores/auth'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/register', component: () => import('./views/RegisterView.vue'), meta: { public: true } },
    { path: '/forgot-password', component: () => import('./views/ForgotPasswordView.vue'), meta: { public: true } },
    { path: '/setup', component: () => import('./views/SetupView.vue'), meta: { setup: true } },
    { path: '/', component: () => import('./views/HomeView.vue') },
    { path: '/r/:code', component: () => import('./views/JoinView.vue'), props: true },
    { path: '/r/:code/room', component: () => import('./views/RoomView.vue'), props: true },
    { path: '/settings', component: () => import('./views/SettingsView.vue') },
    { path: '/admin', component: () => import('./views/AdminView.vue'), meta: { admin: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuth()
  if (!auth.loaded) await auth.load()
  if (to.meta.public) return auth.me ? '/' : true
  if (!auth.me) return { path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} }
  if (auth.needsSetup() && !to.meta.setup) return { path: '/setup', query: { next: to.fullPath } }
  if (!auth.needsSetup() && to.meta.setup) return '/'
  if (to.meta.admin && auth.me.role !== 'admin') return '/'
  return true
})
