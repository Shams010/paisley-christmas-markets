<script setup>

import { computed, onMounted, ref, watch } from 'vue'
import { api, ApiError, MARKET } from '@/lib/api'
import { analytics } from '@/lib/analytics'

const API = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/+$/, '')
const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY

const tab = ref('home')
const tabs = [
  ['home', 'Home'],
  ['traders', 'Traders'],
  ['map', 'Stall map'],
  ['apply', 'Apply'],
  ['contact', 'Contact'],
  ['account', 'My account'],
  ['admin', 'Admin'],
  ['privacy', 'Privacy'],
]

const health = ref(null)
const market = ref(null)
const announcements = ref([])
const traders = ref([])
const category = ref('')
const stallMap = ref(null)
const day = ref('')
const log = ref('Ready.')


function show(label, value) {
  log.value = `${label}\n${JSON.stringify(value, null, 2)}`
}

// Calls the API, shows the result in the log and returns it. 
async function run(label, fn, errorsRef) {
  if (errorsRef) errorsRef.value = {}
  try {
    const result = await fn()
    show(`${label} -> OK`, result ?? null)
    return result ?? true
  } catch (e) {
    if (e instanceof ApiError) {
      show(`${label} -> ${e.status} ${e.code}`, { message: e.message, fields: e.fields })
      if (errorsRef) errorsRef.value = e.fields
    } else {
      show(`${label} -> failed`, { message: String(e?.message ?? e) })
    }
    return undefined
  }
}

// ---- Public -----------------------------------------------------------------
async function loadPublic() {
  try {
    health.value = await (await fetch(`${API}/health`)).json()
  } catch {
    health.value = { status: 'offline' }
  }
  market.value = await run('GET /market', () => api.getMarket())
  if (!market.value) return
  settings.value = { applications_open: market.value.applications_open, primary_colour: market.value.primary_colour }
  announcements.value = (await run('GET /announcements', () => api.getAnnouncements())) ?? []
  day.value = market.value.market_days[0]?.date ?? ''
  resetForm()
}

async function loadTraders() {
  traders.value = (await run('GET /traders', () => api.getTraders(category.value || undefined))) ?? []
}

const trader = ref(null)
async function openTrader(id) {
  trader.value = (await run(`GET /traders/${id}`, () => api.getTrader(id))) ?? null
}

async function loadStallMap() {
  stallMap.value = (await run('GET /stall-map', () => api.getStallMap(day.value))) ?? null
}

const mapSrc = computed(() => {
  const m = market.value
  if (!m?.latitude) return ''
  if (MAPS_KEY) {
    return `https://www.google.com/maps/embed/v1/place?key=${MAPS_KEY}&q=${m.latitude},${m.longitude}&zoom=16`
  }
  const d = 0.004
  const bbox = [m.longitude - d, m.latitude - d / 2, m.longitude + d, m.latitude + d / 2].join(',')
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${m.latitude},${m.longitude}`
})

// ---- Contact ----------------------------------------------------------------
const enquiry = ref({ type: 'general', name: '', email: '', message: '' })
const enquiryErrors = ref({})
async function sendEnquiry() {
  if (await run('POST /enquiries', () => api.sendEnquiry(enquiry.value), enquiryErrors)) enquiry.value.message = ''
}

// ---- Login ------------------------------------------------------------------
const user = ref(null)
const isAdmin = ref(false)
const email = ref('trader1@demo.example')
const password = ref('')

async function refreshUser(u) {
  user.value = u
  isAdmin.value = u?.app_metadata?.role === 'admin'
}

async function signIn() {
  await run('Sign in', () => api.signIn(email.value, password.value))
}
async function signUp() {
  await run('Sign up (check your email to confirm)', () => api.signUp(email.value, password.value))
}
async function signOut() {
  await api.signOut()
  myApps.value = []
  myData.value = null
  queue.value = []
  stats.value = null
}

// ---- Apply ------------------------------------------------------------------
const form = ref({})
const formErrors = ref({})
const isFood = computed(
  () => market.value?.categories.find((c) => c.code === form.value.category)?.requires_food_registration ?? false,
)

function resetForm() {
  const m = market.value
  form.value = {
    business_name: 'Gleniffer Candle Co.',
    contact_name: 'Aisha Rahman',
    phone: '07700 900123',
    postcode: 'PA2 8AB',
    // Each market has its own categories
    category: m?.categories.find((c) => !c.requires_food_registration)?.code ?? m?.categories[0]?.code ?? '',
    description: 'Hand-poured soy candles and wax melts in winter scents, made in Paisley.',
    stall_type: m?.stall_types[0]?.code ?? '',
    needs_power: false,
    power_requirement: 'none',
    market_days: m?.market_days.slice(0, 2).map((d) => d.date) ?? [],
    insurance_expiry: m ? `${Number(m.end_date.slice(0, 4)) + 1}-03-31` : '',
    website_url: '',
    social_link: '',
    additional_requirements: '',
    food_registration: '',
    uses_lpg: false,
    gas_safety_certificate: '',
    logo: '',
    is_over_18: false,
    accept_privacy_policy: false,
    marketing_opt_in: false,
  }
}

function setNeedsPower(value) {
  form.value.needs_power = value
  form.value.power_requirement = value ? 'one_socket' : 'none'
}

async function upload(field, event) {
  const file = event.target.files?.[0]
  if (!file) return
  const fn = field === 'logo' ? api.uploadLogo : api.uploadDocument
  const path = await run(`Upload ${field}`, () => fn(file))
  if (path) {
    form.value[field] = path
    analytics.track('document-uploaded', { document: field }) 
  }
}

// The Apply form edits this application instead of creating a new one.
const editingId = ref(null)

function editApplication(a) {
  resetForm()
  for (const key of Object.keys(form.value)) {
    if (a[key] !== undefined && a[key] !== null) form.value[key] = a[key]
  }
  form.value.food_registration = a.food_registration_path ?? ''
  form.value.gas_safety_certificate = a.gas_safety_certificate_path ?? ''
  form.value.logo = a.logo_path ?? ''
  form.value.is_over_18 = true
  form.value.accept_privacy_policy = true
  editingId.value = a.id
  tab.value = 'apply'
}

async function submitApplication() {
  const id = editingId.value
  const ok = id
    ? await run(`PATCH /applications/${id}`, () => api.updateApplication(id, form.value), formErrors)
    : await run('POST /applications', () => api.submitApplication(form.value), formErrors)
  
  if (!id) analytics.track(ok ? 'application-submitted' : 'application-errors', { category: form.value.category })
  if (ok) {
    editingId.value = null
    tab.value = 'account'
    await loadMine()
  }
}

// ---- My account -------------------------------------------------------------
const myApps = ref([])
const myData = ref(null)
async function loadMine() {
  myApps.value = (await run('GET /applications/me', () => api.getMyApplications())) ?? []
}
async function withdraw(id) {
  await run('POST /applications/:id/withdrawal', () => api.withdrawApplication(id))
  await loadMine()
}
const profile = ref({ contact_name: '', phone: '' })
const profileErrors = ref({})
async function saveProfile() {
  await run('PATCH /me', () => api.updateProfile(profile.value), profileErrors)
}

async function loadMyData() {
  myData.value = (await run('GET /me/data', () => api.getMyData())) ?? null
  if (myData.value?.profile) profile.value = { contact_name: myData.value.profile.contact_name, phone: myData.value.profile.phone }
}
async function setMarketing(granted) {
  await run('PUT /me/consents/marketing', () => api.setMarketingConsent(granted))
}
async function deleteAccount() {
  if (!confirm('Permanently delete your account, applications and files? This cannot be undone.')) return
  if (await run('DELETE /me', () => api.deleteAccount())) await signOut()
}

// ---- Admin ------------------------------------------------------------------
const adminTab = ref('applications')
const queue = ref([])
const detail = ref(null)
const allocDay = ref('')
const freeStalls = ref([])
const allocStall = ref('')
const enquiries = ref([])
const enquiryType = ref('')
const adminNews = ref([])
const newsForm = ref({ title: '', body: '', published: true })
const newsErrors = ref({})
const auditLog = ref([])
const settings = ref({ applications_open: true, primary_colour: '#7a1f2b' })
const stats = ref(null)
const statusFilter = ref('')
const note = ref('')
async function loadQueue() {
  const filters = statusFilter.value ? { status: statusFilter.value } : {}
  queue.value = (await run('GET /admin/applications', () => api.admin.getApplications(filters))) ?? []
}
async function openApplication(id) {
  detail.value = (await run(`GET /admin/applications/${id}`, () => api.admin.getApplication(id))) ?? null
  allocDay.value = unallocatedDays.value[0] ?? ''
  freeStalls.value = []
  if (allocDay.value) await loadFreeStalls()
}

// A trader holds one stall per day, so only days without a stall are offered.
const unallocatedDays = computed(() =>
  (detail.value?.market_days ?? []).filter((d) => !detail.value.allocations.some((al) => al.date === d)),
)

// Free stalls on the chosen day, from the public stall map.
async function loadFreeStalls() {
  const map = await api.getStallMap(allocDay.value)
  freeStalls.value = map.stalls.filter((s) => !s.trader)
  allocStall.value = freeStalls.value[0]?.stall_id ?? ''
}

async function allocate() {
  const map = await api.getStallMap(allocDay.value)
  const dayId = map.stalls[0]?.market_day_id
  const ok = await run('POST /admin/allocations', () => api.admin.allocateStall(detail.value.id, Number(allocStall.value), dayId))
  if (ok) await openApplication(detail.value.id)
}

async function unallocate(allocationId) {
  if (await run(`DELETE /admin/allocations/${allocationId}`, () => api.admin.removeAllocation(allocationId))) {
    await openApplication(detail.value.id)
  }
}

async function loadEnquiries() {
  const filters = enquiryType.value ? { type: enquiryType.value } : {}
  enquiries.value = (await run('GET /admin/enquiries', () => api.admin.getEnquiries(filters))) ?? []
}
async function setEnquiryStatus(id, status) {
  if (await run(`PATCH /admin/enquiries/${id}`, () => api.admin.setEnquiryStatus(id, status))) await loadEnquiries()
}

async function loadAdminNews() {
  adminNews.value = (await run('GET /admin/announcements', () => api.admin.getAnnouncements())) ?? []
}
async function addNews() {
  if (await run('POST /admin/announcements', () => api.admin.addAnnouncement(newsForm.value), newsErrors)) {
    newsForm.value = { title: '', body: '', published: true }
    await loadAdminNews()
  }
}
async function togglePublished(a) {
  if (await run(`PATCH /admin/announcements/${a.id}`, () => api.admin.updateAnnouncement(a.id, { published: !a.published }))) {
    await loadAdminNews()
  }
}
async function deleteNews(id) {
  if (await run(`DELETE /admin/announcements/${id}`, () => api.admin.deleteAnnouncement(id))) await loadAdminNews()
}

async function loadAudit() {
  auditLog.value = (await run('GET /admin/audit-log', () => api.admin.getAuditLog(50))) ?? []
}

async function saveSettings() {
  if (await run('PATCH /admin/market', () => api.admin.updateMarket(settings.value))) await loadPublic()
}

async function loadStats() {
  stats.value = (await run('GET /admin/stats', () => api.admin.getStats())) ?? null
}
async function setStatus(id, status) {
  const done = await run(`PATCH /admin/applications/${id}/status`, () => api.admin.setStatus(id, status, note.value || undefined))
  if (!done) return
  note.value = ''
  if (detail.value?.id === id) await openApplication(id)
  const filters = statusFilter.value ? { status: statusFilter.value } : {}
  queue.value = (await api.admin.getApplications(filters)) ?? []
}

// ---- Statistics ------------------------------------------------

watch(tab, (key) => analytics.view(`/${key}`, tabs.find(([k]) => k === key)?.[1]))
const statsOff = ref(analytics.isOptedOut())
function toggleStats() {
  statsOff.value = !statsOff.value
  analytics.setOptOut(statsOff.value)
}
// The same deployment can serve other clients
const demoMarkets = [
  ['', 'Paisley Christmas Markets (default)'],
  ['clyde-coast-food-festival', 'Clyde Coast Food Festival'],
]

onMounted(async () => {
  api.onAuthChange(refreshUser)
  await refreshUser(await api.currentUser())
  await loadPublic()
})

const field = 'w-full rounded border border-slate-300 px-3 py-2 text-sm'
const button = 'rounded bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50'
const ghost = 'rounded bg-slate-200 px-3 py-1.5 text-sm hover:bg-slate-300'
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <header class="px-6 py-4 text-white" :style="{ background: market?.primary_colour ?? '#14532d' }">
      <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-xl font-bold">{{ market?.name ?? 'Loading…' }}</h1>
          <p class="text-xs opacity-80">
            API: {{ health?.status ?? '…' }} · {{ user ? user.email + (isAdmin ? ' (admin)' : '') : 'not logged in' }}
          </p>
        </div>
        <nav class="flex flex-wrap gap-1 text-sm">
          <button
            v-for="[key, label] in tabs"
            :key="key"
            class="rounded px-3 py-1.5"
            :class="tab === key ? 'bg-white text-slate-900' : 'bg-white/10 hover:bg-white/20'"
            @click="tab = key"
          >
            {{ label }}
          </button>
        </nav>
      </div>
    </header>

    <main class="mx-auto max-w-5xl space-y-6 p-6">
      <!-- HOME -->
      <section v-if="tab === 'home' && market" class="space-y-4 rounded-lg border bg-white p-6">
        <h2 class="text-lg font-bold">{{ market.tagline }}</h2>
        <p class="text-sm text-slate-600">{{ market.description }}</p>
        <p class="text-sm">
          <strong>{{ market.location_name }}</strong>, {{ market.location_postcode }} ·
          {{ market.start_date }} to {{ market.end_date }} ·
          Applications {{ market.applications_open ? 'open' : 'closed' }}
        </p>
        <ul class="grid gap-1 text-sm sm:grid-cols-2">
          <li v-for="d in market.market_days" :key="d.id">{{ d.date }}: {{ d.opens_at }}–{{ d.closes_at }}</li>
        </ul>
        <iframe v-if="mapSrc" :src="mapSrc" title="Market location" class="h-72 w-full rounded border" loading="lazy" />
        <div v-for="a in announcements" :key="a.id" class="rounded bg-slate-100 p-3 text-sm">
          <strong>{{ a.title }}</strong>
          <p>{{ a.body }}</p>
        </div>
      </section>

      <!-- TRADERS -->
      <section v-if="tab === 'traders'" class="space-y-4 rounded-lg border bg-white p-6">
        <div class="flex flex-wrap gap-2">
          <select v-model="category" :class="field" class="max-w-xs">
            <option value="">All categories</option>
            <option v-for="c in market?.categories" :key="c.code" :value="c.code">{{ c.label }}</option>
          </select>
          <button :class="button" @click="loadTraders">Load traders</button>
        </div>
        <p v-if="!traders.length" class="text-sm text-slate-500">Only approved traders are listed.</p>
        <div class="grid gap-3 sm:grid-cols-2">
          <article v-for="t in traders" :key="t.id" class="cursor-pointer rounded border p-3 text-sm hover:bg-slate-50" @click="openTrader(t.id)">
            <h3 class="font-semibold">{{ t.business_name }}</h3>
            <p class="text-xs text-slate-500">{{ t.category_label }}</p>
            <p>{{ t.description }}</p>
            <p v-if="t.stalls.length" class="mt-1 text-xs">
              Stall {{ t.stalls.map((s) => `${s.stall} (${s.date})`).join(', ') }}
            </p>
          </article>
        </div>
      </section>

      <div v-if="tab === 'traders' && trader" class="rounded-lg border bg-white p-6 text-sm">
        <img v-if="trader.logo_url" :src="trader.logo_url" alt="" class="mb-2 h-16" />
        <h3 class="text-lg font-bold">{{ trader.business_name }}</h3>
        <p class="text-slate-500">{{ trader.category_label }}</p>
        <p class="my-2">{{ trader.description }}</p>
        <a v-if="trader.website_url" :href="trader.website_url" class="mr-3 underline" target="_blank" rel="noopener">Website</a>
        <a v-if="trader.social_link" :href="trader.social_link" class="underline" target="_blank" rel="noopener">Social</a>
      </div>

      <!-- STALL MAP -->
      <section v-if="tab === 'map'" class="space-y-4 rounded-lg border bg-white p-6">
        <div class="flex flex-wrap gap-2">
          <select v-model="day" :class="field" class="max-w-xs">
            <option v-for="d in market?.market_days" :key="d.id" :value="d.date">{{ d.date }}</option>
          </select>
          <button :class="button" @click="loadStallMap">Show stalls</button>
        </div>
        <div v-if="stallMap" class="relative h-96 rounded border bg-emerald-50">
          <div
            v-for="s in stallMap.stalls"
            :key="s.stall_id"
            class="absolute -translate-x-1/2 -translate-y-1/2 rounded px-1 text-[10px]"
            :class="s.trader ? 'bg-amber-400 font-semibold' : 'bg-white border'"
            :style="{ left: s.map_x + '%', top: s.map_y + '%' }"
            :title="s.trader ? s.trader.business_name : 'Free'"
          >
            {{ s.code }}
          </div>
        </div>
      </section>

      <!-- APPLY -->
      <section v-if="tab === 'apply'" class="space-y-3 rounded-lg border bg-white p-6" @input.once="analytics.track('application-started')">
        <h2 class="text-lg font-bold">{{ editingId ? `Edit application #${editingId}` : 'Apply for a stall' }}</h2>
        <p v-if="!user" class="rounded bg-amber-100 p-3 text-sm">Log in on the “My account” tab first.</p>
        <template v-else-if="market">
          <div class="grid gap-3 sm:grid-cols-2">
            <label v-for="[key, label] in [['business_name', 'Business name'], ['contact_name', 'Contact name'], ['phone', 'Phone'], ['postcode', 'Postcode'], ['website_url', 'Website (optional)'], ['social_link', 'Social media link (optional)']]" :key="key" class="text-sm">
              {{ label }}
              <input v-model="form[key]" :class="field" />
              <span v-if="formErrors[key]" class="text-xs text-red-700">{{ formErrors[key] }}</span>
            </label>
            <label class="text-sm">
              Category
              <select v-model="form.category" :class="field">
                <option v-for="c in market.categories" :key="c.code" :value="c.code">{{ c.label }}</option>
              </select>
              <span v-if="formErrors.category" class="text-xs text-red-700">{{ formErrors.category }}</span>
            </label>
            <label class="text-sm">
              Stall type
              <select v-model="form.stall_type" :class="field">
                <option v-for="s in market.stall_types" :key="s.code" :value="s.code">{{ s.label }}</option>
              </select>
            </label>
            <label class="text-sm">
              Insurance expiry
              <input v-model="form.insurance_expiry" type="date" :class="field" />
              <span v-if="formErrors.insurance_expiry" class="text-xs text-red-700">{{ formErrors.insurance_expiry }}</span>
            </label>
            <label class="text-sm">
              Power
              <select :value="form.needs_power" :class="field" @change="setNeedsPower($event.target.value === 'true')">
                <option :value="false">No power needed</option>
                <option :value="true">Needs power</option>
              </select>
            </label>
            <label v-if="form.needs_power" class="text-sm">
              How much power
              <select v-model="form.power_requirement" :class="field">
                <option value="one_socket">One socket</option>
                <option value="two_plus_sockets">Two or more sockets</option>
                <option value="high_load">High load</option>
              </select>
              <span v-if="formErrors.power_requirement" class="text-xs text-red-700">{{ formErrors.power_requirement }}</span>
            </label>
          </div>

          <label class="block text-sm">
            Description (20–500 characters)
            <textarea v-model="form.description" rows="3" :class="field" />
            <span v-if="formErrors.description" class="text-xs text-red-700">{{ formErrors.description }}</span>
          </label>

          <fieldset class="text-sm">
            <legend>Market days</legend>
            <label v-for="d in market.market_days" :key="d.id" class="mr-3 inline-flex items-center gap-1">
              <input v-model="form.market_days" type="checkbox" :value="d.date" /> {{ d.date }}
            </label>
            <p v-if="formErrors.market_days" class="text-xs text-red-700">{{ formErrors.market_days }}</p>
          </fieldset>

          <div v-if="isFood" class="space-y-2 rounded bg-slate-100 p-3 text-sm">
            <label class="block">
              Food business registration (PDF/JPG/PNG)
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" @change="upload('food_registration', $event)" />
            </label>
            <p v-if="formErrors.food_registration" class="text-xs text-red-700">{{ formErrors.food_registration }}</p>
            <label class="flex items-center gap-2"><input v-model="form.uses_lpg" type="checkbox" /> Uses LPG (gas)</label>
            <label v-if="form.uses_lpg" class="block">
              Gas safety certificate
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" @change="upload('gas_safety_certificate', $event)" />
            </label>
            <p v-if="formErrors.gas_safety_certificate" class="text-xs text-red-700">{{ formErrors.gas_safety_certificate }}</p>
          </div>

          <label class="block text-sm">
            Logo (optional)
            <input type="file" accept=".jpg,.jpeg,.png,.webp" @change="upload('logo', $event)" />
          </label>

          <div class="space-y-1 text-sm">
            <label class="flex items-center gap-2"><input v-model="form.is_over_18" type="checkbox" /> I am 18 or over</label>
            <p v-if="formErrors.is_over_18" class="text-xs text-red-700">{{ formErrors.is_over_18 }}</p>
            <label class="flex items-center gap-2">
              <input v-model="form.accept_privacy_policy" type="checkbox" /> I have read the <a href="#" class="underline" @click.prevent="tab = 'privacy'">privacy notice</a>
            </label>
            <p v-if="formErrors.accept_privacy_policy" class="text-xs text-red-700">{{ formErrors.accept_privacy_policy }}</p>
            <label class="flex items-center gap-2">
              <input v-model="form.marketing_opt_in" type="checkbox" /> {{ market.marketing_wording ?? 'Send me news about future markets' }} (optional)
            </label>
          </div>

          <div class="flex gap-2">
            <button :class="button" @click="submitApplication">{{ editingId ? 'Save changes' : 'Submit application' }}</button>
            <button v-if="editingId" :class="ghost" @click="editingId = null; resetForm()">Cancel edit</button>
          </div>
        </template>
      </section>

      <!-- CONTACT -->
      <section v-if="tab === 'contact'" class="max-w-xl space-y-3 rounded-lg border bg-white p-6">
        <h2 class="text-lg font-bold">Contact us</h2>
        <select v-model="enquiry.type" :class="field">
          <option value="general">General enquiry</option>
          <option value="feedback">Feedback</option>
          <option value="data_protection">Data protection concern</option>
        </select>
        <input v-model="enquiry.name" placeholder="Name (optional)" :class="field" />
        <input v-model="enquiry.email" placeholder="Email (optional, for a reply)" :class="field" />
        <span v-if="enquiryErrors.email" class="text-xs text-red-700">{{ enquiryErrors.email }}</span>
        <textarea v-model="enquiry.message" rows="4" placeholder="Message" :class="field" />
        <span v-if="enquiryErrors.message" class="text-xs text-red-700">{{ enquiryErrors.message }}</span>
        <button :class="button" @click="sendEnquiry">Send</button>
      </section>

      <!-- ACCOUNT -->
      <section v-if="tab === 'account'" class="space-y-4 rounded-lg border bg-white p-6">
        <div v-if="!user" class="max-w-md space-y-2">
          <h2 class="text-lg font-bold">Log in</h2>
          <input v-model="email" placeholder="Email" :class="field" />
          <input v-model="password" type="password" placeholder="Password" :class="field" />
          <div class="flex gap-2">
            <button :class="button" @click="signIn">Log in</button>
            <button :class="ghost" @click="signUp">Sign up</button>
          </div>
        </div>
        <template v-else>
          <div class="flex flex-wrap gap-2">
            <button :class="button" @click="loadMine">My applications</button>
            <button :class="ghost" @click="loadMyData">My data</button>
            <button :class="ghost" @click="api.downloadMyData()">Download my data</button>
            <button :class="ghost" @click="setMarketing(true)">Marketing on</button>
            <button :class="ghost" @click="setMarketing(false)">Marketing off</button>
            <button :class="ghost" @click="signOut">Log out</button>
            <button class="rounded bg-red-700 px-3 py-1.5 text-sm text-white" @click="deleteAccount">Delete account</button>
          </div>
          <div v-for="a in myApps" :key="a.id" class="rounded border p-3 text-sm">
            <strong>{{ a.business_name }}</strong> · <span class="font-mono">{{ a.status }}</span>
            <p v-if="a.admin_note" class="text-amber-800">Note from organisers: {{ a.admin_note }}</p>
            <p v-if="a.allocations?.length">Stall: {{ a.allocations.map((s) => `${s.stall} (${s.date})`).join(', ') }}</p>
            <button
              v-if="['submitted', 'changes_requested'].includes(a.status)"
              :class="ghost"
              class="mr-2 mt-2"
              @click="editApplication(a)"
            >
              Edit
            </button>
            <button
              v-if="['submitted', 'under_review', 'changes_requested'].includes(a.status)"
              :class="ghost"
              class="mt-2 block"
              @click="withdraw(a.id)"
            >
              Withdraw
            </button>
          </div>
          <div class="flex max-w-xl flex-wrap items-end gap-2 text-sm">
            <label class="flex-1">Contact name <input v-model="profile.contact_name" :class="field" /></label>
            <label class="flex-1">Phone <input v-model="profile.phone" :class="field" /></label>
            <button :class="ghost" @click="saveProfile">Correct my details</button>
          </div>
          <p v-for="(msg, key) in profileErrors" :key="key" class="text-xs text-red-700">{{ msg }}</p>
          <pre v-if="myData" class="max-h-80 overflow-auto rounded bg-slate-900 p-3 text-xs text-emerald-300">{{ JSON.stringify(myData, null, 2) }}</pre>
        </template>
      </section>

      <!-- ADMIN -->
      <section v-if="tab === 'admin'" class="space-y-4 rounded-lg border bg-white p-6">
        <p v-if="!isAdmin" class="rounded bg-amber-100 p-3 text-sm">
          Log in as an administrator (e.g. admin@demo.example) to use this tab.
        </p>
        <template v-else>
          <nav class="flex flex-wrap gap-1 border-b pb-2 text-sm">
            <button
              v-for="[key, label] in [['applications', 'Applications'], ['enquiries', 'Enquiries'], ['news', 'Announcements'], ['settings', 'Market settings'], ['audit', 'Audit log & totals']]"
              :key="key"
              class="rounded px-3 py-1"
              :class="adminTab === key ? 'bg-slate-800 text-white' : 'bg-slate-100'"
              @click="adminTab = key"
            >
              {{ label }}
            </button>
          </nav>

          <!-- Applications: queue, detail, decisions, stall allocation -->
          <div v-if="adminTab === 'applications'" class="space-y-3">
            <div class="flex flex-wrap gap-2">
              <select v-model="statusFilter" :class="field" class="max-w-xs">
                <option value="">All statuses</option>
                <option v-for="s in ['submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'withdrawn']" :key="s">{{ s }}</option>
              </select>
              <button :class="button" @click="loadQueue">Load queue</button>
            </div>
            <input v-model="note" placeholder="Note to trader (required to reject or request changes)" :class="field" />
            <div v-for="a in queue" :key="a.id" class="rounded border p-3 text-sm">
              <strong>{{ a.business_name }}</strong> ({{ a.category_label }}) · <span class="font-mono">{{ a.status }}</span>
              <div class="mt-2 flex flex-wrap gap-2">
                <button :class="ghost" @click="openApplication(a.id)">Details</button>
                <button v-if="a.status === 'submitted'" :class="ghost" @click="setStatus(a.id, 'under_review')">Start review</button>
                <template v-if="a.status === 'under_review'">
                  <button :class="ghost" @click="setStatus(a.id, 'approved')">Approve</button>
                  <button :class="ghost" @click="setStatus(a.id, 'changes_requested')">Request changes</button>
                  <button :class="ghost" @click="setStatus(a.id, 'rejected')">Reject</button>
                </template>
              </div>
            </div>

            <div v-if="detail" class="space-y-2 rounded border-2 border-slate-800 p-4 text-sm">
              <h3 class="text-base font-bold">#{{ detail.id }} {{ detail.business_name }} · {{ detail.status }}</h3>
              <p>{{ detail.contact_name }} · {{ detail.email }} · {{ detail.phone }} · {{ detail.postcode }}</p>
              <p>{{ detail.stall_type }} · power: {{ detail.power_requirement }} · LPG: {{ detail.uses_lpg ? 'yes' : 'no' }} · insurance to {{ detail.insurance_expiry }}</p>
              <p>Days: {{ detail.market_days.join(', ') }}</p>
              <p v-if="detail.additional_requirements">Requirements: {{ detail.additional_requirements }}</p>
              <p>
                Documents (links expire in {{ detail.documents_expire_in_seconds / 60 }} min):
                <a v-if="detail.documents.food_registration" :href="detail.documents.food_registration" target="_blank" class="underline">food registration</a>
                <a v-if="detail.documents.gas_safety_certificate" :href="detail.documents.gas_safety_certificate" target="_blank" class="ml-2 underline">gas safety</a>
                <span v-if="!detail.documents.food_registration && !detail.documents.gas_safety_certificate">none</span>
              </p>
              <div v-if="detail.status === 'approved'" class="space-y-2 rounded bg-slate-100 p-3">
                <strong>Stalls</strong>
                <p v-for="al in detail.allocations" :key="al.id">
                  {{ al.date }}: {{ al.stall }}
                  <button class="ml-2 text-red-700 underline" @click="unallocate(al.id)">remove</button>
                </p>
                <div v-if="unallocatedDays.length" class="flex flex-wrap gap-2">
                  <select v-model="allocDay" :class="field" class="max-w-40" @change="loadFreeStalls">
                    <option v-for="d in unallocatedDays" :key="d" :value="d">{{ d }}</option>
                  </select>
                  <select v-model="allocStall" :class="field" class="max-w-40">
                    <option v-for="st in freeStalls" :key="st.stall_id" :value="st.stall_id">{{ st.code }} ({{ st.stall_type_label }})</option>
                  </select>
                  <button :class="ghost" @click="allocate">Allocate stall</button>
                </div>
              </div>
              <details>
                <summary class="cursor-pointer">History</summary>
                <p v-for="h in detail.history" :key="h.created_at + h.action" class="font-mono text-xs">{{ h.created_at }} {{ h.action }}</p>
              </details>
            </div>
          </div>

          <!-- Enquiries, including data protection concerns -->
          <div v-if="adminTab === 'enquiries'" class="space-y-3">
            <div class="flex gap-2">
              <select v-model="enquiryType" :class="field" class="max-w-xs">
                <option value="">All types</option>
                <option value="general">General</option>
                <option value="feedback">Feedback</option>
                <option value="data_protection">Data protection</option>
              </select>
              <button :class="button" @click="loadEnquiries">Load enquiries</button>
            </div>
            <div v-for="e in enquiries" :key="e.id" class="rounded border p-3 text-sm">
              <strong>{{ e.type }}</strong> · {{ e.status }} · {{ e.name || 'anonymous' }} {{ e.email }}
              <p>{{ e.message }}</p>
              <button v-if="e.status === 'new'" :class="ghost" class="mt-2 mr-2" @click="setEnquiryStatus(e.id, 'acknowledged')">Acknowledge</button>
              <button v-if="e.status !== 'closed'" :class="ghost" class="mt-2" @click="setEnquiryStatus(e.id, 'closed')">Close</button>
            </div>
          </div>

          <!-- Announcements -->
          <div v-if="adminTab === 'news'" class="space-y-3">
            <div class="max-w-xl space-y-2">
              <input v-model="newsForm.title" placeholder="Title" :class="field" />
              <textarea v-model="newsForm.body" rows="2" placeholder="Text" :class="field" />
              <label class="flex items-center gap-2 text-sm"><input v-model="newsForm.published" type="checkbox" /> Publish now</label>
              <p v-for="(msg, key) in newsErrors" :key="key" class="text-xs text-red-700">{{ msg }}</p>
              <div class="flex gap-2">
                <button :class="button" @click="addNews">Add announcement</button>
                <button :class="ghost" @click="loadAdminNews">Load all</button>
              </div>
            </div>
            <div v-for="a in adminNews" :key="a.id" class="rounded border p-3 text-sm">
              <strong>{{ a.title }}</strong> · {{ a.published ? 'published' : 'draft' }}
              <p>{{ a.body }}</p>
              <button :class="ghost" class="mt-2 mr-2" @click="togglePublished(a)">{{ a.published ? 'Unpublish' : 'Publish' }}</button>
              <button :class="ghost" class="mt-2" @click="deleteNews(a.id)">Delete</button>
            </div>
          </div>

         
          <div v-if="adminTab === 'settings'" class="max-w-md space-y-3 text-sm">
            <label class="flex items-center gap-2"><input v-model="settings.applications_open" type="checkbox" /> Applications open</label>
            <label class="flex items-center gap-2">Main colour <input v-model="settings.primary_colour" type="color" /></label>
            <button :class="button" @click="saveSettings">Save settings</button>
          </div>

          <!-- Audit log and dashboard totals -->
          <div v-if="adminTab === 'audit'" class="space-y-3">
            <div class="flex gap-2">
              <button :class="button" @click="loadStats">Dashboard totals</button>
              <button :class="ghost" @click="loadAudit">Audit log</button>
            </div>
            <pre v-if="stats" class="max-h-80 overflow-auto rounded bg-slate-900 p-3 text-xs text-emerald-300">{{ JSON.stringify(stats, null, 2) }}</pre>
            <p v-for="l in auditLog" :key="l.id" class="font-mono text-xs">{{ l.created_at }} {{ l.action }} #{{ l.entity_id }}</p>
          </div>
        </template>
      </section>

      
      <section v-if="tab === 'privacy' && market" class="max-w-3xl space-y-3 rounded-lg border bg-white p-6 text-sm leading-relaxed">
        <h2 class="text-lg font-bold">Privacy notice</h2>
        <p class="text-xs text-slate-500">Version {{ market.privacy_policy_version }}</p>
        <p>
          {{ market.name }} is responsible for the personal data collected on this site. Questions or concerns go to
          <a :href="`mailto:${market.contact_email}`" class="underline">{{ market.contact_email }}</a>
          or the <a href="#" class="underline" @click.prevent="tab = 'contact'; enquiry.type = 'data_protection'">contact form</a>
          (choose "Data protection concern"). You can also complain to the Information Commissioner's Office (ico.org.uk).
        </p>
        <h3 class="font-semibold">What is collected and why</h3>
        <ul class="list-disc space-y-1 pl-5">
          <li>Account email and password, to let you log in (contract).</li>
          <li>Application details: business and contact name, phone, postcode, stall needs, to assess and run your stall (contract).</li>
          <li>Food registration and gas safety certificates, because the organiser must check them (legal obligation).</li>
          <li>Marketing emails only if you ticked the box (consent, which you can withdraw in My account).</li>
          <li>Contact form messages, to reply to you (legitimate interests).</li>
        </ul>
        <h3 class="font-semibold">How long it is kept</h3>
        <ul class="list-disc space-y-1 pl-5">
          <li>Unsuccessful or withdrawn applications: {{ market.retention_unsuccessful_months }} months after the market closes.</li>
          <li>Contact messages: {{ market.retention_enquiry_months }} months.</li>
          <li>Records of administrator actions: {{ market.retention_audit_months }} months.</li>
        </ul>
        <p>
          Approved traders' business name, category, description, website, social link, logo and stall appear in the public
          trader directory. Contact name, phone, email, postcode and documents are never shown publicly.
        </p>
        <p>
          Data is stored in the United Kingdom (London) by Supabase and the site is served from London by Vercel, who act as
          processors. Deleted records can remain in their backups until those backups expire.
        </p>
        <h3 class="font-semibold">Your rights</h3>
        <p>
          In My account you can download a copy of your data, correct your details, withdraw marketing consent and delete your
          account. For anything else, use the contact form.
        </p>
        <h3 class="font-semibold">Visitor statistics</h3>
        <p>
          The site counts visits with Umami, which sets no cookies and does not store IP addresses or anything that identifies you.
          It is used only to see which pages are used and how many people finish the application form.
          <template v-if="analytics.configured">
            Statistics are currently <strong>{{ statsOff ? 'off' : 'on' }}</strong> in this browser.
            <button :class="ghost" class="ml-1" @click="toggleStats">{{ statsOff ? 'Turn statistics on' : 'Turn statistics off' }}</button>
          </template>
          <template v-else>Statistics are not switched on for this copy of the site.</template>
        </p>
      </section>

      <!-- RESPONSE LOG -->
      <section class="rounded-lg bg-slate-900 p-4 font-mono text-xs text-slate-100">
        <div class="mb-1 text-slate-400">Last API response</div>
        <pre class="max-h-60 overflow-auto whitespace-pre-wrap">{{ log }}</pre>
      </section>
    </main>

    <footer class="border-t bg-white px-6 py-4 text-xs text-slate-600">
      <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap gap-3">
          <a href="#" class="underline" @click.prevent="tab = 'privacy'">Privacy notice</a>
          <button v-if="analytics.configured" class="underline" @click="toggleStats">
            {{ statsOff ? 'Turn statistics on' : 'Opt out of statistics' }}
          </button>
        </div>
        
        <div class="flex flex-wrap items-center gap-2">
          <span>Demo markets:</span>
          <a
            v-for="[slug, label] in demoMarkets"
            :key="slug"
            :href="slug ? `?market=${slug}` : '?'"
            class="rounded px-2 py-1"
            :class="slug === MARKET ? 'bg-slate-800 text-white' : 'bg-slate-100 hover:bg-slate-200'"
          >{{ label }}</a>
        </div>
      </div>
    </footer>
  </div>
</template>
