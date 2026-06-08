import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { differenceInDays } from 'date-fns'

export default async function CEODashboard() {
  const supabase = await createClient()

  const [
    { data: planOutlets },
    { data: pendingProofs },
    { data: plans },
  ] = await Promise.all([
    supabase.from('plan_outlets').select('*, outlet:outlets(id,name,location), plan:training_plans(id,title,deadline,trainer_id,trainer:profiles(full_name))'),
    supabase.from('step_completions').select('*, step:steps(id,title,plan_id), outlet:outlets(id,name)').eq('status', 'Submitted'),
    supabase.from('training_plans').select('*, trainer:profiles(full_name)'),
  ])

  const { data: allSteps } = await supabase.from('steps').select('id, plan_id')
  const { data: allCompletions } = await supabase.from('step_completions').select('id, step_id, outlet_id, status')

  // Build outlet progress
  const outletMap = new Map<string, {
    outletName: string
    location?: string
    planTitle: string
    trainerName: string
    deadline?: string
    totalSteps: number
    approved: number
  }>()

  planOutlets?.forEach(po => {
    const planSteps = allSteps?.filter(s => s.plan_id === po.plan?.id) ?? []
    const completions = allCompletions?.filter(c =>
      planSteps.some(s => s.id === c.step_id) && c.outlet_id === po.outlet?.id
    ) ?? []
    const approved = completions.filter(c => c.status === 'Approved').length

    const key = `${po.plan?.id}-${po.outlet?.id}`
    outletMap.set(key, {
      outletName: po.outlet?.name ?? '—',
      location: po.outlet?.location,
      planTitle: po.plan?.title ?? '—',
      trainerName: po.plan?.trainer?.full_name ?? '—',
      deadline: po.plan?.deadline,
      totalSteps: planSteps.length,
      approved,
    })
  })

  const rows = Array.from(outletMap.values())
  const onTrack = rows.filter(r => r.deadline && differenceInDays(new Date(r.deadline), new Date()) > 3).length
  const overdue = rows.filter(r => r.deadline && differenceInDays(new Date(), new Date(r.deadline)) > 0).length

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-black text-navy">Training Overview</h1>
        <p className="text-navy-400 text-sm mt-1">Monitor all outlet training progress</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="card">
          <div className="text-3xl font-black text-navy">{rows.length}</div>
          <div className="text-xs font-bold text-navy-400 uppercase tracking-wide mt-1">Total Outlets</div>
        </div>
        <div className="card">
          <div className="text-3xl font-black text-brand">{onTrack}</div>
          <div className="text-xs font-bold text-navy-400 uppercase tracking-wide mt-1">On Track</div>
        </div>
        <div className="card">
          <div className="text-3xl font-black text-amber-500">{overdue}</div>
          <div className="text-xs font-bold text-navy-400 uppercase tracking-wide mt-1">Overdue</div>
        </div>
        <div className="card">
          <div className="text-3xl font-black text-red-500">{pendingProofs?.length ?? 0}</div>
          <div className="text-xs font-bold text-navy-400 uppercase tracking-wide mt-1">Pending My Review</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Outlet Table */}
        <div className="col-span-2 card">
          <h2 className="text-xs font-bold text-navy-400 uppercase tracking-wide mb-4">All Outlets — Training Status</h2>
          {!rows.length && <p className="text-navy-400 text-sm">No outlets enrolled yet.</p>}
          {rows.length > 0 && (
            <table className="w-full">
              <thead>
                <tr className="border-b border-navy-100">
                  <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Outlet</th>
                  <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Plan</th>
                  <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Trainer</th>
                  <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Progress</th>
                  <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-50">
                {rows.map((row, i) => {
                  const pct = row.totalSteps ? Math.round((row.approved / row.totalSteps) * 100) : 0
                  const isOverdue = row.deadline && differenceInDays(new Date(), new Date(row.deadline)) > 0
                  const isCompleted = row.approved === row.totalSteps && row.totalSteps > 0
                  const isWarning = row.deadline && !isOverdue && differenceInDays(new Date(row.deadline), new Date()) <= 3

                  return (
                    <tr key={i} className="hover:bg-navy-50">
                      <td className="py-3 pr-4">
                        <div className="font-semibold text-sm text-navy-800">{row.outletName}</div>
                        {row.location && <div className="text-xs text-navy-400">{row.location}</div>}
                      </td>
                      <td className="py-3 pr-4 text-sm text-navy-600">{row.planTitle}</td>
                      <td className="py-3 pr-4 text-sm text-navy-500">{row.trainerName}</td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-20 bg-navy-100 rounded-full h-2">
                            <div className="h-2 rounded-full bg-brand" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-navy-400">{row.approved}/{row.totalSteps}</span>
                        </div>
                      </td>
                      <td className="py-3">
                        <span className={
                          isCompleted ? 'badge-blue' :
                          isOverdue ? 'badge-red' :
                          isWarning ? 'badge-orange' :
                          'badge-green'
                        }>
                          {isCompleted ? 'Completed' : isOverdue ? 'Overdue' : isWarning ? 'Due Soon' : 'On Track'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pending Approvals */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold text-navy-400 uppercase tracking-wide">Pending My Approval</h2>
            {(pendingProofs?.length ?? 0) > 3 && (
              <Link href="/ceo/approvals" className="text-brand text-xs font-semibold hover:underline">View all</Link>
            )}
          </div>
          {!pendingProofs?.length && (
            <div className="text-center py-8 text-navy-400">
              <div className="text-2xl mb-2">✅</div>
              <div className="text-sm">All caught up!</div>
            </div>
          )}
          <div className="space-y-3">
            {pendingProofs?.slice(0, 4).map(proof => (
              <Link
                key={proof.id}
                href="/ceo/approvals"
                className="block bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 hover:border-amber-300 transition-colors"
              >
                <div className="font-semibold text-sm text-navy-800">{proof.step?.title}</div>
                <div className="text-xs text-navy-400 mt-0.5">{proof.outlet?.name}</div>
                <span className="badge-orange mt-2">Awaiting Review</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
