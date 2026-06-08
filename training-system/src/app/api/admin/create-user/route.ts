import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'Admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const { fullName, email, role, jobTitle, password } = await req.json()

  // Use service role key to create auth user
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: newUser, error: authErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authErr || !newUser.user) {
    return NextResponse.json({ error: authErr?.message ?? 'Auth creation failed' }, { status: 400 })
  }

  const { error: profileErr } = await adminClient.from('profiles').insert({
    id: newUser.user.id,
    email,
    full_name: fullName,
    role,
    job_title: jobTitle || null,
  })

  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
