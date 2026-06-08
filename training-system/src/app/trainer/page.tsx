import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { differenceInDays } from 'date-fns'

export default async function TrainerDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  // Plans assigned to this trainer
  const { data: plans } = await supabase
    .from('training_plans')
    .select('*, plan_outlets(outlet_id, outlet:outlets(id, name, location))')
    .eq('trainer_id', user.id)
    .order('created_at', { ascending: false })

  // All steps for these plans
  const planIds = plans?.map(p => p.id) ?? []
  const { data: allSteps } = planIds.length
    ? await supabase.from('steps').select('*').in('plan_id', planIds)
    : { data: [] }

  // All completions
  const { data: allCompletions } = planIds.length
    ? await supabase.from('step_completions').select('*').in('step_id', allSteps?.map(s => s.id) ?? [])
    : { data: [] }

  const totalSteps = allSteps?.length ?? 0
  const approved   = allCompletions?.filter(c => c.status === 'Approved').length ?? 0
  const rejected   = allCompletions?.filter(c => c.status === 'Rejected').length ?? 0
  const remaining  = totalSteps - approved

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-black text-navy">My Assignments</h1>
        <p className="text-navy-400 text-sm mt-1">
          Welcome back, {profile?.full_name} · {profile?.job_title}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="card">
          <div className="text-3xl font-black text-navy">{plans?.length ?? 0}</div>
          <div className="text-xs font-bold text-navy-400 uppercase tracking-wide mt-1">Training Plans</div>
        </div>
        <div className="card">
          <div className="text-3xl font-black text-brand">{approved}</div>
          <div className="text-xs font-bold text-navy-400 uppercase tracking-wide mt-1">Steps Approved</div>
        </div>
        <div className="card">
          <div className="text-3xl font-black text-amber-500">{remaining}</div>
          <div className="text-xs font-bold text-navy-400 uppercase tracking-wide mt-1">Steps Remaining</div>
        </div>
        <div className="card">
          <div className="text-3xl font-black text-red-500">{rejected}</div>
          <div className="text-xs font-bold text-navy-400 uppercase tracking-wide mt-1">Rejected — Redo</div>
        </div>
      </div>

      {/* Plans + Outlets */}
      {!plans?.length && (
        <div className="card text-center py-16">
          <div className="text-4xl mb-3">📋</div>
          <div className="font-semibold text-navy-600">No training plans assigned yet</div>
          <div className="text-sm text-navy-400 mt-1">Your admin will assign plans to you</div>
        </div>
      )}

      <div className="space-y-6">
        {plans?.map(plan => {
          const planSteps = allSteps?.filter(s => s.plan_id === plan.id) ?? []
          const outlets = plan.plan_outlets ?? []
          const isOverdue = plan.deadline && differenceInDays(new Date(), new Date(plan.deadline)) > 0
          const daysLeft = plan.deadline ? differenceInDays(new Date(plan.deadline), new Date()) : null

          return (
            <div key={plan.id} className="card">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="font-black text-navy text-lg">{plan.title}</h2>
                  <div className="text-navy-400 text-xs mt-1 flex gap-3">
                    <span>{planSteps.length} steps</span>
                    {plan.deadline && (
                      <span className={isOverdue ? 'text-red-500 font-semibold' : daysLeft !== null && daysLeft <= 3 ? 'text-amber-500 font-semibold' : ''}>
                        {isOverdue ? `Overdue by ${Math.abs(daysLeft ?? 0)} days` : `${daysLeft} days left`}
                      </span>
                    )}
                  </div>
                </div>
                <span className={
                  plan.status === 'Active' ? 'badge-green' :
                  plan.status === 'Completed' ? 'badge-blue' :
                  'badge-gray'
                }>{plan.status}</span>
              </div>

              {outlets.length === 0 && (
                <p className="text-navy-400 text-sm">No outlets assigned to this plan yet.</p>
              )}

              <div className="grid grid-cols-2 gap-3">
                {outlets.map((po: { outlet_id: string; outlet?: { id: string; name: string; location?: string } }) => {
                  const outletStepCompletions = allCompletions?.filter(c =>
                    c.outlet_id === po.outlet_id &&
                    planSteps.some(s => s.id === c.step_id)
                  ) ?? []
                  const outletApproved = outletStepCompletions.filter(c => c.status === 'Approved').length
                  const pct = planSteps.length ? Math.round((outletApproved / planSteps.length) * 100) : 0
                  const hasRejected = outletStepCompletions.some(c => c.status === 'Rejected')

                  return (
                    <Link
                      key={po.outlet_id}
                      href={`/trainer/plans/${plan.id}/outlets/${po.outlet_id}`}
                      className="flex items-center gap-3 p-4 border-2 border-navy-100 hover:border-brand rounded-xl transition-colors group"
                    >
                      <div className="text-2xl">🏪</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-navy-800 group-hover:text-brand">{po.outlet?.name}</div>
                        {po.outlet?.location && <div className="text-xs text-navy-400">{po.outlet.location}</div>}
                        <div className="flex items-center gap-2 mt-2">
                          <div className="flex-1 bg-navy-100 rounded-full h-1.5">
                            <div className="h-1.5 rounded-full bg-brand" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-navy-400">{outletApproved}/{planSteps.length}</span>
                          {hasRejected && <span className="badge-red">!</span>}
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
