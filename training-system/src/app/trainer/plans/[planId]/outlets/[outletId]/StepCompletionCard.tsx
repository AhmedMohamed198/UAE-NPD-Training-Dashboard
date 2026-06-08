'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { FileText, Video, Lock, CheckCircle, XCircle, Clock } from 'lucide-react'
import type { Step, StepCompletion } from '@/types'
import clsx from 'clsx'

const statusColor: Record<string, string> = {
  'Approved':    'border-green-200 bg-green-50',
  'Submitted':   'border-amber-200 bg-amber-50',
  'Rejected':    'border-red-200 bg-red-50',
  'Not Started': 'border-navy-200 bg-white',
}

export default function StepCompletionCard({
  step, completion, outletId, planId, isUnlocked,
}: {
  step: Step
  completion: StepCompletion | null
  outletId: string
  planId: string
  isUnlocked: boolean
}) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(completion?.status === 'Rejected')
  const [uploading, setUploading] = useState(false)
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofNotes, setProofNotes] = useState('')
  const [staffName, setStaffName] = useState('')
  const [error, setError] = useState('')

  const status = completion?.status ?? 'Not Started'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!staffName.trim()) { setError('Staff name is required for sign-off.'); return }
    setUploading(true)
    setError('')

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    let proofUrl = completion?.proof_url ?? null

    if (proofFile) {
      const ext = proofFile.name.split('.').pop()
      const path = `${planId}/${outletId}/${step.id}.${ext}`
      const { error: uploadErr } = await supabase.storage.from('proofs').upload(path, proofFile, { upsert: true })
      if (uploadErr) { setError('Upload failed: ' + uploadErr.message); setUploading(false); return }
      const { data: urlData } = supabase.storage.from('proofs').getPublicUrl(path)
      proofUrl = urlData.publicUrl
    }

    if (!proofUrl) { setError('Please upload a photo or file as proof.'); setUploading(false); return }

    const payload = {
      step_id: step.id,
      outlet_id: outletId,
      status: 'Submitted' as const,
      proof_url: proofUrl,
      proof_notes: proofNotes || null,
      staff_name: staffName,
      submitted_at: new Date().toISOString(),
      rejection_reason: null,
    }

    if (completion) {
      await supabase.from('step_completions').update(payload).eq('id', completion.id)
    } else {
      await supabase.from('step_completions').insert(payload)
    }

    setUploading(false)
    router.refresh()
  }

  return (
    <div className={clsx('border-2 rounded-2xl overflow-hidden transition-all', statusColor[status])}>
      {/* Header */}
      <button
        onClick={() => isUnlocked && setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-4 text-left"
        disabled={!isUnlocked}
      >
        <div className={clsx(
          'w-8 h-8 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0',
          status === 'Approved' ? 'bg-green-500 text-white' :
          status === 'Submitted' ? 'bg-amber-500 text-white' :
          status === 'Rejected' ? 'bg-red-500 text-white' :
          isUnlocked ? 'bg-brand text-white' : 'bg-navy-200 text-navy-400'
        )}>
          {status === 'Approved' ? <CheckCircle size={16} /> :
           status === 'Rejected' ? <XCircle size={16} /> :
           status === 'Submitted' ? <Clock size={16} /> :
           !isUnlocked ? <Lock size={14} /> :
           step.order_num}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-navy-800">{step.title}</div>
          {step.description && <div className="text-xs text-navy-500 mt-0.5">{step.description}</div>}
        </div>

        <span className={
          status === 'Approved' ? 'badge-green' :
          status === 'Submitted' ? 'badge-orange' :
          status === 'Rejected' ? 'badge-red' :
          !isUnlocked ? 'badge-gray' : 'badge-gray'
        }>
          {!isUnlocked ? 'Locked' : status}
        </span>
      </button>

      {/* Expanded Content */}
      {expanded && isUnlocked && (
        <div className="px-4 pb-4 border-t border-navy-100">

          {/* Rejection feedback */}
          {status === 'Rejected' && completion?.rejection_reason && (
            <div className="bg-red-100 border border-red-200 rounded-xl px-4 py-3 mt-4 mb-4">
              <div className="text-xs font-bold text-red-600 uppercase tracking-wide mb-1">CEO Feedback</div>
              <div className="text-sm text-red-700">{completion.rejection_reason}</div>
            </div>
          )}

          {/* Instructions */}
          {step.instructions && (
            <div className="mt-4 mb-4">
              <div className="text-xs font-bold text-navy-400 uppercase tracking-wide mb-2">Instructions</div>
              <div className="text-sm text-navy-700 leading-relaxed whitespace-pre-wrap">{step.instructions}</div>
            </div>
          )}

          {/* Attachments */}
          {step.attachment_url && (
            <div className="mb-4">
              <a href={step.attachment_url} target="_blank" rel="noopener noreferrer"
                className="btn-outline text-xs px-3 py-2 inline-flex items-center gap-2">
                {step.attachment_type === 'pdf' ? <><FileText size={13} /> View PDF</> :
                 step.attachment_type === 'video' ? <><Video size={13} /> Watch Video</> : '📎 View Attachment'}
              </a>
            </div>
          )}

          {/* Proof Upload form (only if not approved) */}
          {status !== 'Approved' && (
            <form onSubmit={handleSubmit} className="space-y-3 mt-2">
              <div className="text-xs font-bold text-navy-400 uppercase tracking-wide">Upload Proof</div>

              {completion?.proof_url && (
                <div className="flex items-center gap-2 text-xs text-brand">
                  <CheckCircle size={12} />
                  <a href={completion.proof_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    Previous proof uploaded
                  </a>
                </div>
              )}

              <div className="border-2 border-dashed border-navy-200 rounded-xl p-4 text-center hover:border-brand transition-colors">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={e => setProofFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-navy-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-brand file:text-white file:text-xs file:font-bold cursor-pointer"
                />
                <div className="text-xs text-navy-400 mt-2">Photo or PDF · max 10MB</div>
              </div>

              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input" rows={2} value={proofNotes} onChange={e => setProofNotes(e.target.value)} placeholder="Any notes about this step..." />
              </div>

              <div className="border-2 border-dashed border-navy-200 rounded-xl p-4">
                <div className="text-xs font-bold text-navy-400 uppercase tracking-wide mb-2">Outlet Staff Sign-off</div>
                <label className="label">Staff Name *</label>
                <input className="input" value={staffName} onChange={e => setStaffName(e.target.value)} placeholder="Kitchen staff full name" />
              </div>

              {error && <div className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}

              <button type="submit" disabled={uploading} className="btn-primary w-full justify-center">
                {uploading ? 'Uploading...' : status === 'Rejected' ? 'Re-submit for CEO Review' : 'Submit for CEO Review'}
              </button>
            </form>
          )}

          {status === 'Approved' && (
            <div className="flex items-center gap-2 text-green-700 text-sm font-semibold mt-4">
              <CheckCircle size={16} />
              Approved · Staff: {completion?.staff_name}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
