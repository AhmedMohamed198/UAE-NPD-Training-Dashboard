import type { Step } from '@/types'
import { FileText, Video, Image } from 'lucide-react'

const attachIcon = { pdf: FileText, video: Video, image: Image }

export default function StepsList({ steps, planId }: { steps: Step[]; planId: string }) {
  if (!steps.length) {
    return <p className="text-navy-400 text-sm">No steps added yet.</p>
  }

  return (
    <div className="space-y-3">
      {steps.map(step => {
        const Icon = step.attachment_type ? attachIcon[step.attachment_type] : null
        return (
          <div key={step.id} className="flex gap-3 p-4 bg-navy-50 rounded-xl">
            <div className="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center text-xs font-black flex-shrink-0">
              {step.order_num}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-navy-800">{step.title}</div>
              {step.description && <div className="text-xs text-navy-500 mt-0.5">{step.description}</div>}
              {step.attachment_url && Icon && (
                <a
                  href={step.attachment_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-brand font-semibold mt-2 hover:underline"
                >
                  <Icon size={12} />
                  {step.attachment_type === 'pdf' ? 'View PDF' : step.attachment_type === 'video' ? 'Watch Video' : 'View Image'}
                </a>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
