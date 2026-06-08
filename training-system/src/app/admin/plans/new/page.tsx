'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'

interface StepForm {
  order_num: number
  title: string
  description: string
  instructions: string
  attachment_url: string
  attachment_type: '' | 'pdf' | 'video' | 'image'
}

export default function NewPlanPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [trainerId, setTrainerId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [deadline, setDeadline] = useState('')
  const [status, setStatus] = useState<'Draft' | 'Active'>('Draft')
  const [trainers, setTrainers] = useState<{ id: string; full_name: string; job_title?: string }[]>([])
  const [loadedTrainers, setLoadedTrainers] = useState(false)

  const [steps, setSteps] = useState<StepForm[]>([
    { order_num: 1, title: '', description: '', instructions: '', attachment_url: '', attachment_type: '' },
  ])

  async function loadTrainers() {
    if (loadedTrainers) return
    const supabase = createClient()
    const { data } = await supabase.from('profiles').select('id, full_name, job_title').eq('role', 'Trainer')
    setTrainers(data ?? [])
    setLoadedTrainers(true)
  }

  function addStep() {
    setSteps(prev => [...prev, {
      order_num: prev.length + 1,
      title: '', description: '', instructions: '', attachment_url: '', attachment_type: '',
    }])
  }

  function removeStep(index: number) {
    setSteps(prev => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, order_num: i + 1 })))
  }

  function updateStep(index: number, field: keyof StepForm, value: string) {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Plan title is required.'); return }
    setSaving(true)
    setError('')

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: plan, error: planErr } = await supabase
      .from('training_plans')
      .insert({
        title,
        description: description || null,
        trainer_id: trainerId || null,
        start_date: startDate || null,
        deadline: deadline || null,
        status,
        created_by: user?.id,
      })
      .select()
      .single()

    if (planErr || !plan) { setError('Failed to create plan.'); setSaving(false); return }

    const validSteps = steps.filter(s => s.title.trim())
    if (validSteps.length > 0) {
      await supabase.from('steps').insert(validSteps.map(s => ({
        plan_id: plan.id,
        order_num: s.order_num,
        title: s.title,
        description: s.description || null,
        instructions: s.instructions || null,
        attachment_url: s.attachment_url || null,
        attachment_type: s.attachment_type || null,
      })))
    }

    // Notify all roles
    const { data: admins } = await supabase.from('profiles').select('id').in('role', ['Admin', 'CEO'])
    const trainer = trainerId ? [{ id: trainerId }] : []
    const allIds = [...(admins ?? []), ...trainer].map(u => u.id).filter(Boolean)
    if (allIds.length) {
      await supabase.from('notifications').insert(allIds.map(user_id => ({
        user_id,
        type: 'plan_created',
        title: 'New Training Plan Created',
        message: title,
        plan_id: plan.id,
      })))
    }

    router.push(`/admin/plans/${plan.id}`)
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-8">
        <Link href="/admin/plans" className="btn-ghost px-2"><ArrowLeft size={18} /></Link>
        <div>
          <h1 className="text-2xl font-black text-navy">New Training Plan</h1>
          <p className="text-navy-400 text-sm mt-0.5">Fill in the details and add steps</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="card space-y-4">
          <h2 className="font-bold text-navy-800">Plan Details</h2>

          <div>
            <label className="label">Plan Title *</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Butchery Training" required />
          </div>

          <div>
            <label className="label">Description</label>
            <textarea className="input" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief overview of this training plan..." />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Assign Trainer</label>
              <select className="input" value={trainerId} onFocus={loadTrainers} onChange={e => setTrainerId(e.target.value)}>
                <option value="">Select trainer...</option>
                {trainers.map(t => (
                  <option key={t.id} value={t.id}>{t.full_name} {t.job_title ? `(${t.job_title})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={status} onChange={e => setStatus(e.target.value as 'Draft' | 'Active')}>
                <option value="Draft">Draft</option>
                <option value="Active">Active</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Start Date</label>
              <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Deadline</label>
              <input className="input" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-navy-800">Training Steps</h2>
            <button type="button" onClick={addStep} className="btn-outline text-xs px-3 py-1.5">
              <Plus size={14} /> Add Step
            </button>
          </div>

          <div className="space-y-4">
            {steps.map((step, i) => (
              <div key={i} className="border-2 border-navy-100 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-navy-400 uppercase tracking-wide">Step {step.order_num}</span>
                  {steps.length > 1 && (
                    <button type="button" onClick={() => removeStep(i)} className="text-red-400 hover:text-red-600">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
                <div>
                  <label className="label">Title *</label>
                  <input className="input" value={step.title} onChange={e => updateStep(i, 'title', e.target.value)} placeholder="Step title..." />
                </div>
                <div>
                  <label className="label">Description</label>
                  <input className="input" value={step.description} onChange={e => updateStep(i, 'description', e.target.value)} placeholder="Brief description..." />
                </div>
                <div>
                  <label className="label">Instructions</label>
                  <textarea className="input" rows={2} value={step.instructions} onChange={e => updateStep(i, 'instructions', e.target.value)} placeholder="Detailed instructions for the trainer..." />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Attachment URL</label>
                    <input className="input" value={step.attachment_url} onChange={e => updateStep(i, 'attachment_url', e.target.value)} placeholder="https://..." />
                  </div>
                  <div>
                    <label className="label">Attachment Type</label>
                    <select className="input" value={step.attachment_type} onChange={e => updateStep(i, 'attachment_type', e.target.value)}>
                      <option value="">None</option>
                      <option value="pdf">PDF</option>
                      <option value="video">Video</option>
                      <option value="image">Image</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>}

        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="btn-primary px-8">
            {saving ? 'Creating...' : 'Create Plan'}
          </button>
          <Link href="/admin/plans" className="btn-ghost">Cancel</Link>
        </div>
      </form>
    </div>
  )
}
