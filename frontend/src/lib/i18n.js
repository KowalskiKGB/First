// Tiny dependency-free i18n. English source strings are the keys; locale files in
// src/locales/ map them to translations and are lazy-loaded (Vite code-splits each
// import.meta.glob entry), so the initial bundle stays English-only.
// Exercise instructions live in generated lazy-loaded packs. The pt-BR exercise name
// catalogue is bundled because pt-BR is the default UI and import/search use those names.
import { useSyncExternalStore } from 'react'
import ptNames from '../exercise-names/pt.js'

// UI languages. German has no instruction pack — instructions fall back to English.
export const LANGS = {
  en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano',
  pt: 'Português (Brasil)', pl: 'Polski', tr: 'Türkçe', ru: 'Русский', zh: '中文',
  ko: '한국어', hi: 'हिन्दी'
}
export const INSTR_LANGS = ['en', 'es', 'fr', 'it', 'pt', 'tr', 'ru', 'zh', 'hi', 'pl', 'ko']
export const DEFAULT_LANG = 'pt'
export const DATE_LOCALES = {
  en: 'en-GB', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-BR',
  pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN'
}

const localePacks = import.meta.glob('../locales/*.js')
const instrPacks = import.meta.glob('../instr/*.js')

let lang = DEFAULT_LANG
let dict = {}
let instr = null            // { exId: [steps] } for the current language, null = English
let version = 0
const subs = new Set()
const notify = () => { version++; subs.forEach(f => f()) }

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || 'en-GB'

// Translate a source string; {0},{1}… are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
  return v
}
// Instructions for an exercise in the current language (English steps as fallback).
export const instrFor = ex => (instr && instr[ex.id]) || ex.st || []
export const ptExerciseName = ex => ptNames[ex?.id] || ''
export const exerciseName = ex => (lang === 'pt' && ptExerciseName(ex)) || ex?.n || ''

export async function setLang(l) {
  if (!LANGS[l]) l = 'en'
  if (l === lang && version > 0) return
  lang = l
  try {
    const localeLoader = l === 'en' ? null : localePacks['../locales/' + l + '.js']
    const instrLoader = l === 'en' || !INSTR_LANGS.includes(l) ? null : instrPacks['../instr/' + l + '.js']
    const [localeMod, instrMod] = await Promise.all([
      localeLoader ? localeLoader() : null,
      instrLoader ? instrLoader() : null,
    ])
    dict = localeMod?.default || {}
    instr = instrMod?.default || null
  } catch (e) { dict = {}; instr = null }
  notify()
}

// Re-renders the subscribing component (and its children) whenever the language changes.
export function useLang() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, () => version)
}
