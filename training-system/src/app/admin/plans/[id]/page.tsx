import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import AssignOutletForm from './AssignOutletForm'
import StepsList from './StepsList'
import OutletProgressTable from './OutletProgressTable'

export default async function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [
    { data: plan },
    { data: steps },
    { data: planOutlets },
  ] = await Promise.all([
    supabase.from('training_plans').select('*, trainer:profiles(full_name, job_title)').eq('id', id).single(),
    supabase.from('steps').select('*').eq('plan_id', id).order('order_num'),
    supabase.from('plan_outlets').select('*, outlet:outlets(id, name, location)').eq('plan_id', id),
  ])

  if (!plan) notFound()

  const outletIds = planOutlets?.map(po => po.outlet_id) ?? []

  // Completions for all steps in this plan across all outlets
  const { data: completions } = steps?.length && outletIds.length
    ? await supabase.from('step_completions').select('*')
        .in('step_id', steps.map(s => s.id))
        .in('outlet_id', outletIds)
    : { data: [] }

  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        <Link href="/admin/plans" className="btn-ghost px-2"><ArrowLeft size={18} /></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-black text-navy">{plan.title}</h1>
          <p className="text-navy-400 text-sm mt-0.5">
            {plan.trainer?.full_name ?? 'No trainer'} · {steps?.length ?? 0} steps · {planOutlets?.length ?? 0} outlets
          </p>
        </div>
        <span className={
          plan.status === 'Active' ? 'badge-green' :
          plan.status === 'Completed' ? 'badge-blue' :
          plan.status === 'Draft' ? 'badge-gray' : 'badge-orange'
        }>{plan.status}</span>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Steps */}
        <div className="col-span-2 space-y-6">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-navy-400 uppercase tracking-wide">Training Steps</h2>
            </div>
            <StepsList steps={steps ?? []} planId={id} />
          </div>

          {/* Outlets Progress */}
          <div className="card">
            <h2 className="text-xs font-bold text-navy-400 uppercase tracking-wide mb-4">Outlet Progress</h2>
            <OutletProgressTable
              planOutlets={planOutlets ?? []}
              steps={steps ?? []}
              completions={completions ?? []}
            />
          </div>
        </div>

        {/* Right: Info + Assign */}
        <div className="space-y-4">
          <div className="card">
            <h2 className="text-xs font-bold text-navy-400 uppercase tracking-wide mb-4">Plan Details</h2>
            <dl className="space-y-3">
              <div>
                <dt className="label">Trainer</dt>
                <dd className="text-sm text-navy-800">{plan.trainer?.full_name ?? '—'}</dd>
                {plan.trainer?.job_title && <dd className="text-xs text-navy-400">{plan.trainer.job_title}</dd>}
              </div>
              <div>
                <dt className="label">Start Date</dt>
                <dd className="text-sm text-navy-800">{plan.start_date ?? '—'}</dd>
              </div>
              <div>
                <dt className="label">Deadline</dt>
                <dd className="text-sm text-navy-800">{plan.deadline ?? '—'}</dd>
              </div>
              {plan.description && (
                <div>
                  <dt className="label">Description</dt>
                  <dd className="text-sm text-navy-600">{plan.description}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="card">
            <h2 className="text-xs font-bold text-navy-400 uppercase tracking-wide mb-4">Assign Outlet</h2>
            <AssignOutletForm planId={id} existingOutletIds={outletIds} />
          </div>
        </div>
      </div>
    </div>
  )
}
