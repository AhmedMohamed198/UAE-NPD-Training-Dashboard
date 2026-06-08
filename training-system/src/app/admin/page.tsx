import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { differenceInDays } from 'date-fns'

export default async function AdminDashboard() {
  const supabase = await createClient()

  const [
    { count: plansCount },
    { data: outlets },
    { data: pendingProofs },
    { data: plans },
  ] = await Promise.all([
    supabase.from('training_plans').select('*', { count: 'exact', head: true }),
    supabase.from('plan_outlets').select('outlet_id', { count: 'exact' }),
    supabase.from('step_completions').select('*, step:steps(title, plan_id), outlet:outlets(name)')
      .eq('status', 'Submitted'),
    supabase.from('training_plans')
      .select('*, trainer:profiles(full_name, job_title)')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const uniqueOutlets = new Set(outlets?.map(o => o.outlet_id)).size

  const { data: allOutletProgress } = await supabase
    .from('plan_outlets')
    .select('outlet:outlets(id, name, location), plan:training_plans(deadline)')

  // Count overdue (deadline passed, not completed)
  const overdue = allOutletProgress?.filter(po => {
    const plan = po.plan as { deadline?: string } | null
    const deadline = plan?.deadline
    return deadline && differenceInDays(new Date(), new Date(deadline)) > 0
  }).length ?? 0

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-navy">Training Dashboard</h1>
          <p className="text-navy-400 text-sm mt-1">Manage plans, outlets, and trainers</p>
        </div>
        <Link href="/admin/plans/new" className="btn-primary">
          + New Training Plan
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="card">
          <div className="text-3xl font-black text-navy">{plansCount ?? 0}</div>
          <div className="text-xs font-bold text-navy-400 uppercase tracking-wide mt-1">Training Plans</div>
        </div>
        <div className="card">
          <div className="text-3xl font-black text-brand">{uniqueOutlets}</div>
          <div className="text-xs font-bold text-navy-400 uppercase tracking-wide mt-1">Outlets Enrolled</div>
        </div>
        <div className="card">
          <div className="text-3xl font-black text-amber-500">{overdue}</div>
          <div className="text-xs font-bold text-navy-400 uppercase tracking-wide mt-1">Overdue</div>
        </div>
        <div className="card">
          <div className="text-3xl font-black text-red-500">{pendingProofs?.length ?? 0}</div>
          <div className="text-xs font-bold text-navy-400 uppercase tracking-wide mt-1">Awaiting CEO Review</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Recent Plans */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold text-navy-400 uppercase tracking-wide">Recent Training Plans</h2>
            <Link href="/admin/plans" className="text-brand text-xs font-semibold hover:underline">View all</Link>
          </div>
          {!plans?.length && <p className="text-navy-400 text-sm">No plans yet.</p>}
          <div className="divide-y divide-navy-100">
            {plans?.map(plan => (
              <div key={plan.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm text-navy-800">{plan.title}</div>
                  <div className="text-xs text-navy-400 mt-0.5">
                    {plan.trainer?.full_name ?? 'Unassigned'} · {plan.deadline ? `Due ${plan.deadline}` : 'No deadline'}
                  </div>
                </div>
                <span className={
                  plan.status === 'Active' ? 'badge-green' :
                  plan.status === 'Completed' ? 'badge-blue' :
                  plan.status === 'Draft' ? 'badge-gray' : 'badge-orange'
                }>{plan.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Pending Proofs */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold text-navy-400 uppercase tracking-wide">Pending CEO Review</h2>
          </div>
          {!pendingProofs?.length && <p className="text-navy-400 text-sm">No pending proofs.</p>}
          <div className="space-y-3">
            {pendingProofs?.slice(0, 5).map(proof => (
              <div key={proof.id} className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                <div>
                  <div className="font-semibold text-sm text-navy-800">{proof.step?.title}</div>
                  <div className="text-xs text-navy-400 mt-0.5">{proof.outlet?.name}</div>
                </div>
                <span className="badge-orange">Awaiting</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
