'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AddUserForm() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'Trainer' | 'CEO' | 'Admin'>('Trainer')
  const [jobTitle, setJobTitle] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const res = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, role, jobTitle, password }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Failed to create user.')
    } else {
      setSuccess('User created successfully.')
      setFullName(''); setEmail(''); setJobTitle(''); setPassword('')
      router.refresh()
    }
    setSaving(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="label">Full Name *</label>
        <input className="input" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Noura Ali" required />
      </div>
      <div>
        <label className="label">Email *</label>
        <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="noura@calo.app" required />
      </div>
      <div>
        <label className="label">Password *</label>
        <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
      </div>
      <div>
        <label className="label">Role *</label>
        <select className="input" value={role} onChange={e => setRole(e.target.value as 'Trainer' | 'CEO' | 'Admin')}>
          <option value="Trainer">Trainer</option>
          <option value="CEO">CEO</option>
          <option value="Admin">Admin</option>
        </select>
      </div>
      <div>
        <label className="label">Job Title</label>
        <input className="input" value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="e.g. NPD Chef, Nutritionist" />
      </div>

      {error && <div className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
      {success && <div className="text-green-700 text-xs bg-green-50 border border-green-200 rounded-xl px-3 py-2">{success}</div>}

      <button type="submit" disabled={saving} className="btn-primary w-full justify-center">
        {saving ? 'Creating...' : 'Create User'}
      </button>
    </form>
  )
}
