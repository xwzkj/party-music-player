import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MeView, PublicConfig } from '@pmp/shared'
import { ApiError, get, post } from '../api/http'

export const useAuth = defineStore('auth', () => {
  const me = ref<MeView | null>(null)
  const config = ref<PublicConfig>({ emailVerificationEnabled: false, turnstileEnabled: false, turnstileSiteKey: null })
  const loaded = ref(false)

  async function load(): Promise<void> {
    try {
      config.value = await get<PublicConfig>('/config')
    } catch {
      /* ignore */
    }
    try {
      me.value = await get<MeView>('/me')
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e
      me.value = null
    } finally {
      loaded.value = true
    }
  }

  async function login(username: string, password: string): Promise<void> {
    me.value = await post<MeView>('/auth/login', { username, password })
  }

  async function logout(): Promise<void> {
    await post('/auth/logout')
    me.value = null
  }

  function set(m: MeView): void {
    me.value = m
  }

  /** 需要先完成首次设置 */
  const needsSetup = (): boolean => !!me.value && (!me.value.nickname || me.value.mustChangePassword)

  return { me, config, loaded, load, login, logout, set, needsSetup }
})
