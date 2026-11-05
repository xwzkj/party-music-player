import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { setTheme } from 'mdui'

export type ThemeMode = 'light' | 'dark' | 'auto'

function load<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem(key)
    return v === null ? def : (JSON.parse(v) as T)
  } catch {
    return def
  }
}

function save(key: string, v: unknown): void {
  localStorage.setItem(key, JSON.stringify(v))
}

export const usePrefs = defineStore('prefs', () => {
  const theme = ref<ThemeMode>(load('pmp.theme', 'auto'))
  const volume = ref<number>(load('pmp.volume', 0.8))
  const showTranslation = ref<boolean>(load('pmp.translation', true))

  watch(theme, (v) => {
    save('pmp.theme', v)
    setTheme(v)
  })
  watch(volume, (v) => save('pmp.volume', v))
  watch(showTranslation, (v) => save('pmp.translation', v))

  /** 每台设备自己选择的"本机出声"，按房间保存；null 表示用默认值 */
  function listeningChoice(code: string): boolean | null {
    return load<boolean | null>(`pmp.listen.${code}`, null)
  }
  function setListeningChoice(code: string, on: boolean): void {
    save(`pmp.listen.${code}`, on)
  }

  function applyTheme(): void {
    setTheme(theme.value)
  }

  return { theme, volume, showTranslation, listeningChoice, setListeningChoice, applyTheme }
})
