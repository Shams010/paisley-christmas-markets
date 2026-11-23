import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { analytics } from './lib/analytics'

analytics.load()
createApp(App).mount('#app')
