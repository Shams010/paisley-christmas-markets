/**
 * Visitor statistics with Umami 
 *
 * 
 *
 *   import { analytics } from '@/lib/analytics'
 * 
 */
const WEBSITE_ID = import.meta.env.VITE_UMAMI_WEBSITE_ID
const SCRIPT_URL = import.meta.env.VITE_UMAMI_SCRIPT_URL || 'https://cloud.umami.is/script.js'
const OPT_OUT_KEY = 'umami.disabled'

function optedOut() {
  try {
    return Boolean(localStorage.getItem(OPT_OUT_KEY))
  } catch {
    return false
  }
}

export const analytics = {
  
  configured: Boolean(WEBSITE_ID),

  /** Adds the Umami script once. Called from main.js. */
  load() {
    if (!WEBSITE_ID || optedOut() || document.getElementById('umami-script')) return
    const script = document.createElement('script')
    script.id = 'umami-script'
    script.defer = true
    script.src = SCRIPT_URL
    script.dataset.websiteId = WEBSITE_ID
    script.dataset.doNotTrack = 'true' 
    document.head.appendChild(script)
  },

  /** Records a named event  */
  track(name, data) {
    if (optedOut()) return
    window.umami?.track(name, data)
  },

  /** Records a page view for a tab*/
  view(path, title) {
    if (optedOut()) return
    window.umami?.track((props) => ({ ...props, url: path, title }))
  },

  isOptedOut: optedOut,

  /** Turns statistics off (true) or back on (false)  */
  setOptOut(value) {
    try {
      if (value) localStorage.setItem(OPT_OUT_KEY, '1')
      else localStorage.removeItem(OPT_OUT_KEY)
    } catch {
      
    }
    if (!value) analytics.load()
  },
}
