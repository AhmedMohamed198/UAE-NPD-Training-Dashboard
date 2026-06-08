import { createClient } from '@/lib/supabase/server'
import AddUserForm from './AddUserForm'

export default async function UsersPage() {
  const supabase = await createClient()
  const { data: users } = await supabase.from('profiles').select('*').order('role').order('full_name')

  const roleBadge: Record<string, string> = {
    Admin: 'badge-red',
    Trainer: 'badge-blue',
    CEO: 'badge-orange',
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-black text-navy">Users & Roles</h1>
        <p className="text-navy-400 text-sm mt-1">{users?.length ?? 0} users</p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 card">
          {!users?.length && <p className="text-navy-400 text-sm py-8 text-center">No users yet.</p>}
          {users && users.length > 0 && (
            <table className="w-full">
              <thead>
                <tr className="border-b border-navy-100">
                  <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Name</th>
                  <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Email</th>
                  <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Role</th>
                  <th className="text-left text-xs font-bold text-navy-400 uppercase tracking-wide pb-3">Job Title</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-50">
                {users.map(user => (
                  <tr key={user.id} className="hover:bg-navy-50">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {user.full_name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-semibold text-sm text-navy-800">{user.full_name}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-sm text-navy-500">{user.email}</td>
                    <td className="py-3 pr-4"><span className={roleBadge[user.role] ?? 'badge-gray'}>{user.role}</span></td>
                    <td className="py-3 text-sm text-navy-400">{user.job_title ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card h-fit">
          <h2 className="font-bold text-navy-800 mb-4">Add New User</h2>
          <p className="text-xs text-navy-400 mb-4">
            Creates a Supabase auth account and profile. The user will receive a password setup email from Supabase.
          </p>
          <AddUserForm />
        </div>
      </div>
    </div>
  )
}
