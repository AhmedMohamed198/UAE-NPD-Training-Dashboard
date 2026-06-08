import type { Step, StepCompletion } from '@/types'

interface PlanOutlet {
  id: string
  outlet_id: string
  outlet?: { id: string; name: string; location?: string }
}

export default function OutletProgressTable({
  planOutlets, steps, completions,
}: {
  planOutlets: PlanOutlet[]
  steps: Step[]
  completions: StepCompletion[]
}) {
  if (!planOutlets.length) {
    return <p className="text-navy-400 text-sm">No outlets assigned yet.</p>
  }

  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-navy-100">
          <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Outlet</th>
          <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Progress</th>
          <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Approved</th>
          <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Pending</th>
          <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Rejected</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-navy-50">
        {planOutlets.map(po => {
          const outletCompletions = completions.filter(c => c.outlet_id === po.outlet_id)
          const approved = outletCompletions.filter(c => c.status === 'Approved').length
          const submitted = outletCompletions.filter(c => c.status === 'Submitted').length
          const rejected = outletCompletions.filter(c => c.status === 'Rejected').length
          const pct = steps.length ? Math.round((approved / steps.length) * 100) : 0

          return (
            <tr key={po.id} className="hover:bg-navy-50">
              <td className="py-3 pr-4">
                <div className="font-semibold text-sm text-navy-800">{po.outlet?.name ?? '—'}</div>
                {po.outlet?.location && <div className="text-xs text-navy-400">{po.outlet.location}</div>}
              </td>
              <td className="py-3 pr-4">
                <div className="flex items-center gap-2">
                  <div className="w-24 bg-navy-100 rounded-full h-2">
                    <div className="h-2 rounded-full bg-brand" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-navy-500">{approved}/{steps.length}</span>
                </div>
              </td>
              <td className="py-3 pr-4"><span className="badge-green">{approved}</span></td>
              <td className="py-3 pr-4"><span className="badge-orange">{submitted}</span></td>
              <td className="py-3"><span className="badge-red">{rejected}</span></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
