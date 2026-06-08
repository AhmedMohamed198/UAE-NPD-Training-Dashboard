'use client'

import { useState, useEffect, useRef } from 'react'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Notification } from '@/types'
import { formatDistanceToNow } from 'date-fns'
import clsx from 'clsx'

const typeColor: Record<string, string> = {
  proof_submitted:  'bg-amber-500',
  proof_approved:   'bg-brand',
  proof_rejected:   'bg-red-500',
  plan_created:     'bg-blue-500',
  outlet_assigned:  'bg-purple-500',
  overdue_warning:  'bg-orange-500',
  overdue:          'bg-red-600',
  plan_completed:   'bg-brand',
}

export default function NotificationBell({ userId }: { userId: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  useEffect(() => {
    fetchNotifications()

    // Realtime subscription
    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        setNotifications(prev => [payload.new as Notification, ...prev])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function fetchNotifications() {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30)
    if (data) setNotifications(data)
  }

  async function markAllRead() {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  async function markRead(id: string) {
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  const unread = notifications.filter(n => !n.read).length

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-xl hover:bg-navy-100 transition-colors"
      >
        <Bell size={20} className="text-navy-600" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-80 bg-white rounded-2xl shadow-xl border border-navy-100 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-navy-100">
            <span className="font-bold text-sm text-navy-800">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-brand font-semibold hover:underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-navy-50">
            {notifications.length === 0 && (
              <div className="px-4 py-8 text-center text-navy-400 text-sm">No notifications yet</div>
            )}
            {notifications.map(n => (
              <div
                key={n.id}
                onClick={() => markRead(n.id)}
                className={clsx(
                  'flex gap-3 px-4 py-3 cursor-pointer hover:bg-navy-50 transition-colors',
                  !n.read && 'bg-brand-light'
                )}
              >
                <div className={clsx('w-2 h-2 rounded-full mt-1.5 flex-shrink-0', typeColor[n.type] ?? 'bg-navy-400')} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-navy-800">{n.title}</div>
                  <div className="text-xs text-navy-500 mt-0.5 truncate">{n.message}</div>
                  <div className="text-xs text-navy-400 mt-1">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </div>
                </div>
                {!n.read && <div className="w-2 h-2 rounded-full bg-brand flex-shrink-0 mt-1.5" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
