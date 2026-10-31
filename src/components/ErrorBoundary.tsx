import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * "Appka nikdy nespadne" (Etapa 5 – spolehlivost): bez tohohle by jakákoliv
 * neošetřená chyba při renderu (např. neočekávaný tvar dat z výpadkového
 * připojení) shodila celou stránku na bílou obrazovku a host by u stolu
 * neměl vůbec nic k dispozici. Error boundary chybu zachytí, zaloguje do
 * konzole pro ladění a místo pádu ukáže přívětivou hlášku s tlačítkem na
 * obnovení – zbytek appky (ani ostatní stoly/hospody) tím není ovlivněný,
 * protože boundary obaluje jen strom pod sebou.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('StůlHraje – neošetřená chyba při renderu:', error, info.componentStack)
  }

  handleReload = () => {
    this.setState({ hasError: false })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      // ErrorBoundary obaluje i LanguageProvider (musí umět zachytit chybu
      // odkudkoliv), takže si jazyk čte přímo z localStorage, ne přes kontext.
      let lang: 'cs' | 'en' = 'cs'
      try {
        lang = localStorage.getItem('stulhraje_lang_v1') === 'en' ? 'en' : 'cs'
      } catch {
        // ignore
      }

      return (
        <div className="crash-fallback">
          <h1>{lang === 'en' ? 'Something went wrong' : 'Něco se pokazilo'}</h1>
          <p>
            {lang === 'en'
              ? 'The page hit an unexpected error. Please try reloading it – if the problem persists, call over the staff.'
              : 'Stránka narazila na neočekávanou chybu. Zkus ji prosím obnovit – pokud problém přetrvá, přivolej obsluhu.'}
          </p>
          <button type="button" onClick={this.handleReload}>
            {lang === 'en' ? 'Reload page' : 'Obnovit stránku'}
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
