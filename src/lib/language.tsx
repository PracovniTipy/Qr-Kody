import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

export type Lang = 'cs' | 'en'

const STORAGE_KEY = 'stulhraje_lang_v1'

interface LanguageContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  toggleLang: () => void
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'en' ? 'en' : 'cs'
  } catch {
    return 'cs'
  }
}

/**
 * Globální přepínač jazyka CS/EN pro celou appku (hlavní objednávkový systém
 * i všechny hry). Volba se ukládá do localStorage a platí napříč všemi
 * stránkami, dokud ji host znovu nezmění.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readStoredLang())

  const setLang = (next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // private browsing / storage disabled - není kritické
    }
  }

  const toggleLang = () => setLang(lang === 'cs' ? 'en' : 'cs')

  useEffect(() => {
    try {
      document.documentElement.lang = lang
    } catch {
      // ignore
    }
  }, [lang])

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggleLang }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) {
    // Fallback, kdyby komponenta byla vykreslená mimo LanguageProvider
    return { lang: 'cs', setLang: () => {}, toggleLang: () => {} }
  }
  return ctx
}

/**
 * Pomocná funkce pro komponenty s vlastním CS/EN slovníkem:
 * t(cs, en) vrátí text podle aktuálně zvoleného jazyka.
 */
export function pickText(lang: Lang, cs: string, en: string): string {
  return lang === 'en' ? en : cs
}
