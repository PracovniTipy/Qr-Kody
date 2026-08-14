import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Etapa 1.1: průvodce založením hospody. Jednoduchý formulář (název + adresa) –
 * žádná vícekroková obrazovka zatím není potřeba, viz pravidlo "nejdřív jednoduše
 * funkční" použité i v ostatních admin komponentách. Založení běží přes RPC
 * create_venue_for_current_user (migrace 0004), která atomicky vytvoří hospodu
 * a přihlášeného uživatele v ní rovnou udělá MAJITELEM.
 */
export function CreateVenueForm() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleNameChange(value: string) {
    setName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !slug) return
    setSaving(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('create_venue_for_current_user', {
      p_name: name.trim(),
      p_slug: slug,
    })

    setSaving(false)

    if (rpcError) {
      setError(
        rpcError.code === '23505'
          ? 'Tahle adresa (slug) už je obsazená, zkus jinou.'
          : rpcError.message
      )
      return
    }

    if (data?.id) {
      navigate(`/admin/hospoda/${data.id}`)
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h2>Založit hospodu</h2>

      <label>
        Název
        <input
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="např. Hospoda U lípy"
          required
        />
      </label>

      <label>
        Adresa (slug)
        <input
          value={slug}
          onChange={(e) => {
            setSlugTouched(true)
            setSlug(slugify(e.target.value))
          }}
          placeholder="hospoda-u-lipy"
          required
        />
      </label>
      <p className="menu-item-desc">
        Veřejná stránka stolu poběží na /v/{slug || '…'}/t/&lt;token&gt;.
      </p>

      <button type="submit" disabled={saving || !name.trim() || !slug}>
        {saving ? 'Zakládám…' : 'Založit hospodu'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
