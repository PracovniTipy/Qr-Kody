import { useLanguage } from '../lib/language'

interface Props {
  className?: string
}

/**
 * Globální přepínač jazyka CS/EN. Vykresluje se na všech veřejných
 * stránkách (objednávkový systém i hry) a mění jazyk pro celou appku.
 */
export function LanguageSwitcher({ className }: Props) {
  const { lang, setLang } = useLanguage()

  return (
    <div className={`lang-toggle${className ? ` ${className}` : ''}`} role="group" aria-label="Jazyk / Language">
      <button
        type="button"
        className={lang === 'cs' ? 'active' : ''}
        onClick={() => setLang('cs')}
      >
        CS
      </button>
      <button
        type="button"
        className={lang === 'en' ? 'active' : ''}
        onClick={() => setLang('en')}
      >
        EN
      </button>
    </div>
  )
}
