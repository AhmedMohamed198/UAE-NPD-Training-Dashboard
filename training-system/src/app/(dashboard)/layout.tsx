import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'
import NotificationBell from '@/components/layout/NotificationBell'
import type { Role } from '@/types'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  return (
    <div className="min-h-screen bg-navy-100">
      <Sidebar
        role={profile.role as Role}
        fullName={profile.full_name}
        jobTitle={profile.job_title}
      />

      <div className="ml-56">
        {/* Top bar */}
        <header className="bg-white border-b border-navy-100 px-8 py-4 flex items-center justify-end gap-3 sticky top-0 z-30">
          <NotificationBell userId={user.id} />
        </header>

        {/* Page content */}
        <main className="p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
