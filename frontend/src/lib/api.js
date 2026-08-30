// Backend + WebAuthn helpers (ported from the vanilla app).
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { getLang } from './i18n.js'

const API_ROOT = String(import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')
const MOBILE_API = import.meta.env.VITE_MOBILE === '1' && API_ROOT

const USER_AGENT = globalThis.navigator?.userAgent || ''
export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(USER_AGENT)
export const IS_ANDROID = /Android/.test(USER_AGENT)
export const bioLabel = (language = getLang()) => language === 'pt'
  ? (IS_APPLE ? 'Face ID / Touch ID' : IS_ANDROID ? 'impressão digital ou desbloqueio facial' : 'sua biometria, rosto ou PIN')
  : (IS_APPLE ? 'Face ID / Touch ID' : IS_ANDROID ? 'fingerprint or face unlock' : 'your fingerprint, face or PIN')
export const VAULT = IS_APPLE ? 'iCloud Keychain' : IS_ANDROID ? 'Google Password Manager' : 'your password manager'
export const webauthnOK = () => !!(window.PublicKeyCredential && navigator.credentials)

const responseError = (data, status) => {
  const error = new Error(data?.error || ('HTTP ' + status))
  error.status = status
  return error
}

async function nativeApi(path, opts, headers) {
  const body = opts?.body
  const response = await CapacitorHttp.request({
    url: API_ROOT + path,
    method: String(opts?.method || 'GET').toUpperCase(),
    headers,
    ...(body == null ? {} : { data: body }),
  })
  let data = response.data ?? {}
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch { data = {} }
  }
  if (response.status < 200 || response.status >= 300) throw responseError(data, response.status)
  return data
}

export async function api(path, opts) {
  const headers = { 'Content-Type': 'application/json', ...(opts?.headers || {}) }
  if (MOBILE_API) headers['X-First-Client'] = 'capacitor'
  if (MOBILE_API && Capacitor.isNativePlatform()) return nativeApi(path, opts, headers)
  const r = await fetch(API_ROOT + path, { credentials: 'include', ...opts, headers })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw responseError(data, r.status)
  return data
}

const bufToB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uToBuf = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer

function toCreationOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  o.user.id = b64uToBuf(o.user.id)
  ;(o.excludeCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}
function toRequestOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  ;(o.allowCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}
function credToJSON(cred) {
  const r = cred.response
  const out = {
    id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    authenticatorAttachment: cred.authenticatorAttachment || null,
    response: { clientDataJSON: bufToB64u(r.clientDataJSON) }
  }
  if (r.attestationObject) {
    out.response.attestationObject = bufToB64u(r.attestationObject)
    out.response.transports = r.getTransports ? r.getTransports() : ['internal']
  }
  if (r.authenticatorData) {
    out.response.authenticatorData = bufToB64u(r.authenticatorData)
    out.response.signature = bufToB64u(r.signature)
    out.response.userHandle = r.userHandle ? bufToB64u(r.userHandle) : null
  }
  return out
}
export async function passkeyRegister(name, code) {
  const { cid, options } = await api('/api/register/options', { method: 'POST', body: JSON.stringify({ name, code: code || '' }) })
  const cred = await navigator.credentials.create({ publicKey: toCreationOptions(options) })
  const res = await api('/api/register/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
export async function passkeyLogin() {
  const { cid, options } = await api('/api/login/options', { method: 'POST', body: '{}' })
  const cred = await navigator.credentials.get({ publicKey: toRequestOptions(options) })
  const res = await api('/api/login/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
