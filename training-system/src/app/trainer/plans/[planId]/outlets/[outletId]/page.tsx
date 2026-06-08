import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, FileText, Video } from 'lucide-react'
import StepCompletionCard from './StepCompletionCard'

export default async function TrainerStepsPage({
  params,
}: {
  params: Promise<{ planId: string; outletId: string }>
}) {
  const { planId, outletId } = await params
  const supabase = await createClient()

  const [
    { data: plan },
    { data: outlet },
    { data: steps },
  ] = await Promise.all([
    supabase.from('training_plans').select('*').eq('id', planId).single(),
    supabase.from('outlets').select('*').eq('id', outletId).single(),
    supabase.from('steps').select('*').eq('plan_id', planId).order('order_num'),
  ])

  if (!plan || !outlet) notFound()

  const { data: completions } = steps?.length
    ? await supabase.from('step_completions').select('*')
        .in('step_id', steps.map(s => s.id))
        .eq('outlet_id', outletId)
    : { data: [] }

  const approved  = completions?.filter(c => c.status === 'Approved').length ?? 0
  const total     = steps?.length ?? 0
  const pct       = total ? Math.round((approved / total) * 100) : 0

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <Link href="/trainer" className="btn-ghost px-2"><ArrowLeft size={18} /></Link>
        <div>
          <h1 className="text-2xl font-black text-navy">{plan.title}</h1>
          <p className="text-navy-400 text-sm mt-0.5">📍 {outlet.name}{outlet.location ? ` — ${outlet.location}` : ''}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="card mb-6 flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-navy-400 uppercase tracking-wide">Overall Progress</span>
            <span className="text-sm font-bold text-navy-800">{approved} / {total} steps approved</span>
          </div>
          <div className="w-full bg-navy-100 rounded-full h-3">
            <div className="h-3 rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="text-2xl font-black text-brand">{pct}%</div>
      </div>

      {/* Steps */}
      <div className="space-y-4">
        {steps?.map((step, index) => {
          const completion = completions?.find(c => c.step_id === step.id)
          const prevApproved = index === 0 || completions?.find(c =>
            c.step_id === steps[index - 1].id && c.status === 'Approved'
          )
          return (
            <StepCompletionCard
              key={step.id}
              step={step}
              completion={completion ?? null}
              outletId={outletId}
              planId={planId}
              isUnlocked={index === 0 || !!prevApproved}
            />
          )
        })}
      </div>
    </div>
  )
}
