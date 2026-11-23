// Every API call the Vue pages need, so pages never use fetch().

import { supabase } from './supabase';

const BASE = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/+$/, '');
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true';
const mockFiles = import.meta.glob('../mocks/*.json', { import: 'default' });
const mock = (name) => mockFiles[`../mocks/${name}.json`]();


export const MARKET = new URLSearchParams(window.location.search).get('market') ?? '';


export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message ?? 'Something went wrong.');
    this.status = status;
    this.code = body?.error ?? 'unknown';
    this.fields = body?.fields ?? {};
  }
}

async function request(method, path, body) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const url = MARKET ? `${BASE}${path}${path.includes('?') ? '&' : '?'}market=${encodeURIComponent(MARKET)}` : `${BASE}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(MARKET ? { 'X-Market': MARKET } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return null;
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, json);
  return json;
}

async function uploadTo(bucket, file) {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new ApiError(401, { error: 'not_authenticated', message: 'Log in first.' });
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
  const path = `${data.user.id}/${crypto.randomUUID().slice(0, 8)}-${safeName}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type });
  if (error) throw new ApiError(422, { error: 'upload_failed', message: error.message });
  return path; 
}

export const api = {
  // account (Supabase Auth)
  async signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw new ApiError(400, { error: 'signup_failed', message: error.message });
    return data; // data.session is null until the email address is confirmed
  },
  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new ApiError(401, { error: 'login_failed', message: error.message });
    return data.user;
  },
  signOut: () => supabase.auth.signOut(),
  async currentUser() {
    const { data } = await supabase.auth.getSession();
    return data.session?.user ?? null;
  },
  /** Only for showing or hiding admin pages. The server does the real check. */
  async isAdmin() {
    return (await api.currentUser())?.app_metadata?.role === 'admin';
  },
  /** Call once in App.vue to react to login and logout. */
  onAuthChange: (callback) => supabase.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null)),

  // public
  getMarket: () => (USE_MOCKS ? mock('market') : request('GET', '/market')),
  getMarketDays: () => (USE_MOCKS ? mock('market-days') : request('GET', '/market-days')),
  getTraders: (category) =>
    USE_MOCKS ? mock('traders') : request('GET', `/traders${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  getTrader: (id) => (USE_MOCKS ? mock('traders').then((all) => all.find((t) => t.id === Number(id))) : request('GET', `/traders/${id}`)),
  getStallMap: (day) => (USE_MOCKS ? mock('stall-map') : request('GET', `/stall-map${day ? `?day=${day}` : ''}`)),
  getAnnouncements: () => (USE_MOCKS ? mock('announcements') : request('GET', '/announcements')),

  sendEnquiry: (enquiry) => request('POST', '/enquiries', enquiry),

  // trader
  uploadDocument: (file) => uploadTo('trader-documents', file), // PDF, JPG or PNG, up to 5 MB
  uploadLogo: (file) => uploadTo('trader-logos', file), // JPG, PNG or WebP, up to 2 MB
  submitApplication: (form) => request('POST', '/applications', form),
  getMyApplications: () => (USE_MOCKS ? mock('my-applications') : request('GET', '/applications/me')),
  updateApplication: (id, form) => request('PATCH', `/applications/${id}`, form),
  withdrawApplication: (id) => request('POST', `/applications/${id}/withdrawal`),

 
  getMyData: () => (USE_MOCKS ? mock('my-data') : request('GET', '/me/data')),
  async downloadMyData() {
    const blob = new Blob([JSON.stringify(await api.getMyData(), null, 2)], { type: 'application/json' });
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'my-data.json' });
    link.click();
    URL.revokeObjectURL(link.href);
  },
  updateProfile: (profile) => request('PATCH', '/me', profile),
  setMarketingConsent: (granted) => request('PUT', '/me/consents/marketing', { granted }),
  async deleteAccount() {
    await request('DELETE', '/me', { confirm: 'DELETE' });
    await supabase.auth.signOut();
  },

  // administrator
  admin: {
    getApplications: (filters = {}) =>
      USE_MOCKS ? mock('admin-applications') : request('GET', `/admin/applications?${new URLSearchParams(filters)}`),
    getApplication: (id) => request('GET', `/admin/applications/${id}`),
   
    setStatus: (id, status, admin_note) => request('PATCH', `/admin/applications/${id}/status`, { status, admin_note }),
    allocateStall: (application_id, stall_id, market_day_id) =>
      request('POST', '/admin/allocations', { application_id, stall_id, market_day_id }),
    removeAllocation: (id) => request('DELETE', `/admin/allocations/${id}`),
    getStats: () => (USE_MOCKS ? mock('admin-stats') : request('GET', '/admin/stats')),
    getAuditLog: (limit = 50) => request('GET', `/admin/audit-log?limit=${limit}`),
    getEnquiries: (filters = {}) => request('GET', `/admin/enquiries?${new URLSearchParams(filters)}`),
    setEnquiryStatus: (id, status) => request('PATCH', `/admin/enquiries/${id}`, { status }),
    getAnnouncements: () => request('GET', '/admin/announcements'),
    addAnnouncement: (announcement) => request('POST', '/admin/announcements', announcement),
    updateAnnouncement: (id, changes) => request('PATCH', `/admin/announcements/${id}`, changes),
    deleteAnnouncement: (id) => request('DELETE', `/admin/announcements/${id}`),
    updateMarket: (changes) => request('PATCH', '/admin/market', changes),
  },
};
