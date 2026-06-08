'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, ClipboardList, Store, Users, CheckSquare, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Role } from '@/types'
import clsx from 'clsx'

const adminNav = [
  { href: '/admin',          label: 'Dashboard',       icon: LayoutDashboard },
  { href: '/admin/plans',    label: 'Training Plans',  icon: ClipboardList },
  { href: '/admin/outlets',  label: 'Outlets',         icon: Store },
  { href: '/admin/users',    label: 'Users',           icon: Users },
]

const trainerNav = [
  { href: '/trainer',        label: 'My Assignments',  icon: LayoutDashboard },
]

const ceoNav = [
  { href: '/ceo',            label: 'Overview',        icon: LayoutDashboard },
  { href: '/ceo/approvals',  label: 'Approvals',       icon: CheckSquare },
]

const navByRole: Record<Role, typeof adminNav> = {
  Admin:   adminNav,
  Trainer: trainerNav,
  CEO:     ceoNav,
}

interface Props {
  role: Role
  fullName: string
  jobTitle?: string
}

export default function Sidebar({ role, fullName, jobTitle }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const nav = navByRole[role] ?? []

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className="fixed left-0 top-0 h-screen w-56 bg-navy flex flex-col z-40">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-navy-800">
        <div className="text-brand font-black text-2xl tracking-tight">CALO</div>
        <div className="text-navy-400 text-xs mt-0.5">NPD Training System</div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/admin' && href !== '/trainer' && href !== '/ceo' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors',
                active
                  ? 'bg-brand text-white'
                  : 'text-navy-400 hover:text-white hover:bg-navy-800'
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* User + Logout */}
      <div className="px-3 py-4 border-t border-navy-800">
        <div className="flex items-center gap-3 px-3 py-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {fullName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-white text-xs font-semibold truncate">{fullName}</div>
            <div className="text-navy-400 text-xs truncate">{jobTitle ?? role}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm text-navy-400 hover:text-white hover:bg-navy-800 transition-colors"
        >
          <LogOut size={15} />
          Sign out
        </button>
      </div>
    </aside>
  )
}
