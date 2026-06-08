import { createClient } from '@/lib/supabase/server'
import ApprovalCard from './ApprovalCard'

export default async function ApprovalsPage() {
  const supabase = await createClient()

  const { data: pendingProofs } = await supabase
    .from('step_completions')
    .select('*, step:steps(id,title,order_num,plan_id,attachment_url,attachment_type,instructions), outlet:outlets(id,name,location)')
    .eq('status', 'Submitted')
    .order('submitted_at', { ascending: true })

  // Get plan info for each proof
  const planIds = [...new Set(pendingProofs?.map(p => p.step?.plan_id).filter(Boolean))]
  const { data: plans } = planIds.length
    ? await supabase.from('training_plans').select('id,title,trainer_id,trainer:profiles(full_name)').in('id', planIds)
    : { data: [] }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-black text-navy">Approvals</h1>
        <p className="text-navy-400 text-sm mt-1">{pendingProofs?.length ?? 0} proofs awaiting your review</p>
      </div>

      {!pendingProofs?.length && (
        <div className="card text-center py-20">
          <div className="text-4xl mb-3">✅</div>
          <div className="font-bold text-navy-600">All caught up!</div>
          <div className="text-sm text-navy-400 mt-1">No proofs waiting for review</div>
        </div>
      )}

      <div className="space-y-4">
        {pendingProofs?.map(proof => {
          const plan = plans?.find(p => p.id === proof.step?.plan_id)
          return (
            <ApprovalCard
              key={proof.id}
              proof={proof}
              planTitle={plan?.title}
              trainerName={plan?.trainer?.full_name}
            />
          )
        })}
      </div>
    </div>
  )
}
