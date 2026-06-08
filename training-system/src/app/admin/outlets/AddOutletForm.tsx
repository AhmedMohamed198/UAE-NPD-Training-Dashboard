'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AddOutletForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    const supabase = createClient()
    await supabase.from('outlets').insert({ name, location: location || null })
    setName('')
    setLocation('')
    setSaving(false)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="label">Outlet Name *</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Golden Cafe" required />
      </div>
      <div>
        <label className="label">Location</label>
        <input className="input" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Dubai Marina" />
      </div>
      <button type="submit" disabled={saving} className="btn-primary w-full justify-center">
        {saving ? 'Adding...' : 'Add Outlet'}
      </button>
    </form>
  )
}
