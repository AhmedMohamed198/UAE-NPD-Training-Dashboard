'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Outlet } from '@/types'

export default function AssignOutletForm({ planId, existingOutletIds }: {
  planId: string
  existingOutletIds: string[]
}) {
  const router = useRouter()
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.from('outlets').select('*').order('name')
      .then(({ data }) => setOutlets(data ?? []))
  }, [])

  const available = outlets.filter(o => !existingOutletIds.includes(o.id))

  async function handleAssign() {
    if (!selected) return
    setSaving(true)
    const supabase = createClient()

    await supabase.from('plan_outlets').insert({ plan_id: planId, outlet_id: selected })

    // Get plan info for notification
    const { data: plan } = await supabase.from('training_plans').select('title, trainer_id').eq('id', planId).single()
    const outlet = outlets.find(o => o.id === selected)

    // Notify admin + trainer
    const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'Admin')
    const notifyIds = [
      ...(admins?.map(a => a.id) ?? []),
      ...(plan?.trainer_id ? [plan.trainer_id] : []),
    ]

    if (notifyIds.length) {
      await supabase.from('notifications').insert(notifyIds.map(user_id => ({
        user_id,
        type: 'outlet_assigned',
        title: 'Outlet Assigned to Plan',
        message: `${outlet?.name} added to ${plan?.title}`,
        plan_id: planId,
        outlet_id: selected,
      })))
    }

    setSaving(false)
    setSelected('')
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {available.length === 0
        ? <p className="text-navy-400 text-xs">All outlets already assigned, or no outlets exist.</p>
        : (
          <>
            <select className="input" value={selected} onChange={e => setSelected(e.target.value)}>
              <option value="">Select outlet...</option>
              {available.map(o => (
                <option key={o.id} value={o.id}>{o.name}{o.location ? ` — ${o.location}` : ''}</option>
              ))}
            </select>
            <button onClick={handleAssign} disabled={!selected || saving} className="btn-primary w-full justify-center text-sm">
              {saving ? 'Assigning...' : 'Assign Outlet'}
            </button>
          </>
        )
      }
    </div>
  )
}
