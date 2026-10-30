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
      return (
        <div className="crash-fallback">
          <h1>Něco se pokazilo</h1>
          <p>
            Stránka narazila na neočekávanou chybu. Zkus ji prosím obnovit – pokud problém
            přetrvá, přivolej obsluhu.
          </p>
          <button type="button" onClick={this.handleReload}>
            Obnovit stránku
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
