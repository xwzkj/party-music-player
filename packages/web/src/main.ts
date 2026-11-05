import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'mdui/mdui.css'
import 'mdui'
import './icons'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { usePrefs } from './stores/prefs'
import { applySeed, DEFAULT_SEED } from './theme'

const app = createApp(App)
app.use(createPinia())
app.use(router)
usePrefs().applyTheme()
applySeed(DEFAULT_SEED)
app.mount('#app')
