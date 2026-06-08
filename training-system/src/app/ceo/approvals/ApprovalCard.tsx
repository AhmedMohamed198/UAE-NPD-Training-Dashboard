'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle, XCircle, FileText, Video } from 'lucide-react'

interface Props {
  proof: {
    id: string
    proof_url?: string
    proof_notes?: string
    staff_name?: string
    submitted_at?: string
    step?: {
      id: string
      title: string
      order_num: number
      plan_id: string
      attachment_url?: string
      attachment_type?: string
      instructions?: string
    }
    outlet?: { id: string; name: string; location?: string }
  }
  planTitle?: string
  trainerName?: string
}

export default function ApprovalCard({ proof, planTitle, trainerName }: Props) {
  const router = useRouter()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleDecision(approved: boolean) {
    if (!approved && !reason.trim()) { setRejecting(true); return }
    setLoading(true)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    await supabase.from('step_completions').update({
      status: approved ? 'Approved' : 'Rejected',
      reviewed_at: new Date().toISOString(),
      reviewer_id: user?.id,
      rejection_reason: approved ? null : reason,
    }).eq('id', proof.id)

    router.refresh()
  }

  const proofIsImage = proof.proof_url && /\.(jpg|jpeg|png|gif|webp)$/i.test(proof.proof_url)

  return (
    <div className="card border-l-4 border-l-amber-400">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-xs text-navy-400 font-semibold mb-1">{planTitle} · Step {proof.step?.order_num}</div>
          <h2 className="font-black text-navy text-lg">{proof.step?.title}</h2>
          <div className="text-sm text-navy-500 mt-1">
            📍 {proof.outlet?.name}{proof.outlet?.location ? ` — ${proof.outlet.location}` : ''}
            {trainerName && <> · Trainer: {trainerName}</>}
          </div>
        </div>
        <span className="badge-orange">Awaiting Review</span>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Left: Proof */}
        <div className="space-y-3">
          <div className="text-xs font-bold text-navy-400 uppercase tracking-wide">Proof Submitted</div>

          {proof.proof_url ? (
            proofIsImage ? (
              <a href={proof.proof_url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={proof.proof_url} alt="Proof" className="rounded-xl w-full max-h-48 object-cover border border-navy-100 hover:opacity-90 transition-opacity" />
              </a>
            ) : (
              <a href={proof.proof_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 bg-navy-50 rounded-xl px-4 py-3 text-sm text-brand font-semibold hover:bg-brand-light transition-colors">
                <FileText size={16} /> View Proof Document
              </a>
            )
          ) : (
            <div className="bg-navy-50 rounded-xl px-4 py-8 text-center text-navy-400 text-sm">No file uploaded</div>
          )}

          {proof.proof_notes && (
            <div>
              <div className="text-xs font-bold text-navy-400 uppercase tracking-wide mb-1">Notes</div>
              <div className="text-sm text-navy-600 bg-navy-50 rounded-xl px-3 py-2">{proof.proof_notes}</div>
            </div>
          )}

          {proof.staff_name && (
            <div className="text-sm text-navy-600">
              <span className="font-semibold">Staff sign-off:</span> {proof.staff_name}
            </div>
          )}
        </div>

        {/* Right: Step info + Actions */}
        <div className="space-y-3">
          {proof.step?.instructions && (
            <div>
              <div className="text-xs font-bold text-navy-400 uppercase tracking-wide mb-2">Step Instructions</div>
              <div className="text-sm text-navy-600 bg-navy-50 rounded-xl px-3 py-2 max-h-28 overflow-y-auto">{proof.step.instructions}</div>
            </div>
          )}

          {proof.step?.attachment_url && (
            <a href={proof.step.attachment_url} target="_blank" rel="noopener noreferrer"
              className="btn-outline text-xs px-3 py-2 inline-flex items-center gap-2">
              {proof.step.attachment_type === 'video' ? <><Video size={13} />Watch Reference Video</> : <><FileText size={13} />View Reference PDF</>}
            </a>
          )}

          {/* Actions */}
          {!rejecting ? (
            <div className="flex gap-3 pt-2">
              <button onClick={() => handleDecision(true)} disabled={loading}
                className="btn-primary flex-1 justify-center gap-2">
                <CheckCircle size={16} /> Approve
              </button>
              <button onClick={() => setRejecting(true)} disabled={loading}
                className="btn-danger flex-1 justify-center gap-2">
                <XCircle size={16} /> Reject
              </button>
            </div>
          ) : (
            <div className="space-y-2 pt-2">
              <label className="label">Rejection Reason *</label>
              <textarea
                className="input"
                rows={3}
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Explain what needs to be fixed or re-done..."
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={() => handleDecision(false)} disabled={!reason.trim() || loading}
                  className="btn-danger flex-1 justify-center text-sm">
                  {loading ? 'Sending...' : 'Send Rejection'}
                </button>
                <button onClick={() => setRejecting(false)}
                  className="btn-ghost flex-1 text-sm">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
