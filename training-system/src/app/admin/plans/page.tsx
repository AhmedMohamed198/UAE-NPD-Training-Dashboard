import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function PlansPage() {
  const supabase = await createClient()

  const { data: plans } = await supabase
    .from('training_plans')
    .select('*, trainer:profiles(full_name, job_title)')
    .order('created_at', { ascending: false })

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-navy">Training Plans</h1>
          <p className="text-navy-400 text-sm mt-1">{plans?.length ?? 0} plans total</p>
        </div>
        <Link href="/admin/plans/new" className="btn-primary">+ New Plan</Link>
      </div>

      <div className="card">
        {!plans?.length && (
          <div className="text-center py-16 text-navy-400">
            <div className="text-4xl mb-3">📋</div>
            <div className="font-semibold">No training plans yet</div>
            <div className="text-sm mt-1">Create your first plan to get started</div>
            <Link href="/admin/plans/new" className="btn-primary mt-4 inline-flex">+ New Plan</Link>
          </div>
        )}

        {plans && plans.length > 0 && (
          <table className="w-full">
            <thead>
              <tr className="border-b border-navy-100">
                <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Plan</th>
                <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Trainer</th>
                <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Start</th>
                <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Deadline</th>
                <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-50">
              {plans.map(plan => (
                <tr key={plan.id} className="hover:bg-navy-50">
                  <td className="py-3 pr-4">
                    <div className="font-semibold text-sm text-navy-800">{plan.title}</div>
                    {plan.description && <div className="text-xs text-navy-400 mt-0.5 truncate max-w-xs">{plan.description}</div>}
                  </td>
                  <td className="py-3 pr-4 text-sm text-navy-600">
                    {plan.trainer ? (
                      <div>
                        <div>{plan.trainer.full_name}</div>
                        <div className="text-xs text-navy-400">{plan.trainer.job_title}</div>
                      </div>
                    ) : <span className="text-navy-300">—</span>}
                  </td>
                  <td className="py-3 pr-4 text-sm text-navy-600">{plan.start_date ?? '—'}</td>
                  <td className="py-3 pr-4 text-sm text-navy-600">{plan.deadline ?? '—'}</td>
                  <td className="py-3 pr-4">
                    <span className={
                      plan.status === 'Active' ? 'badge-green' :
                      plan.status === 'Completed' ? 'badge-blue' :
                      plan.status === 'Draft' ? 'badge-gray' : 'badge-orange'
                    }>{plan.status}</span>
                  </td>
                  <td className="py-3">
                    <Link href={`/admin/plans/${plan.id}`} className="btn-ghost text-xs px-3 py-1.5">
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
