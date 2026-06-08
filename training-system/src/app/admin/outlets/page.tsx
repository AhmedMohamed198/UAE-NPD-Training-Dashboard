import { createClient } from '@/lib/supabase/server'
import AddOutletForm from './AddOutletForm'

export default async function OutletsPage() {
  const supabase = await createClient()
  const { data: outlets } = await supabase.from('outlets').select('*').order('name')

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-navy">Outlets</h1>
          <p className="text-navy-400 text-sm mt-1">{outlets?.length ?? 0} outlets registered</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 card">
          {!outlets?.length && (
            <div className="text-center py-12 text-navy-400">
              <div className="text-4xl mb-3">🏪</div>
              <div className="font-semibold">No outlets yet</div>
              <div className="text-sm mt-1">Add your first outlet using the form</div>
            </div>
          )}
          {outlets && outlets.length > 0 && (
            <table className="w-full">
              <thead>
                <tr className="border-b border-navy-100">
                  <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Outlet Name</th>
                  <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Location</th>
                  <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-50">
                {outlets.map(outlet => (
                  <tr key={outlet.id} className="hover:bg-navy-50">
                    <td className="py-3 pr-4 font-semibold text-sm text-navy-800">{outlet.name}</td>
                    <td className="py-3 pr-4 text-sm text-navy-500">{outlet.location ?? '—'}</td>
                    <td className="py-3 text-sm text-navy-400">{new Date(outlet.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card h-fit">
          <h2 className="font-bold text-navy-800 mb-4">Add New Outlet</h2>
          <AddOutletForm />
        </div>
      </div>
    </div>
  )
}
