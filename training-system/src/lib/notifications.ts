import { createClient } from '@/lib/supabase/server'
import type { NotificationType } from '@/types'

interface NotifyPayload {
  type: NotificationType
  title: string
  message: string
  plan_id?: string
  step_id?: string
  outlet_id?: string
}

export async function notifyUsers(userIds: string[], payload: NotifyPayload) {
  const supabase = await createClient()
  const rows = userIds.map((user_id) => ({ user_id, ...payload }))
  await supabase.from('notifications').insert(rows)
}

export async function notifyRole(role: string, payload: NotifyPayload) {
  const supabase = await createClient()
  const { data: users } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', role)
  if (!users?.length) return
  await notifyUsers(users.map((u) => u.id), payload)
}

export async function notifyAllRoles(payload: NotifyPayload) {
  await notifyRole('Admin', payload)
  await notifyRole('CEO', payload)
  await notifyRole('Trainer', payload)
}
