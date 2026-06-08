export type Role = 'Admin' | 'Trainer' | 'CEO'

export type StepStatus = 'Not Started' | 'Submitted' | 'Approved' | 'Rejected'

export type PlanStatus = 'Draft' | 'Active' | 'Completed' | 'Archived'

export type NotificationType =
  | 'plan_created'
  | 'outlet_assigned'
  | 'proof_submitted'
  | 'proof_approved'
  | 'proof_rejected'
  | 'overdue_warning'
  | 'overdue'
  | 'plan_completed'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  job_title?: string
  created_at: string
}

export interface Outlet {
  id: string
  name: string
  location?: string
  created_at: string
}

export interface TrainingPlan {
  id: string
  title: string
  description?: string
  trainer_id?: string
  start_date?: string
  deadline?: string
  status: PlanStatus
  created_by?: string
  created_at: string
  trainer?: Profile
}

export interface PlanOutlet {
  id: string
  plan_id: string
  outlet_id: string
  assigned_at: string
  outlet?: Outlet
  plan?: TrainingPlan
}

export interface Step {
  id: string
  plan_id: string
  order_num: number
  title: string
  description?: string
  instructions?: string
  attachment_url?: string
  attachment_type?: 'pdf' | 'video' | 'image'
  created_at: string
}

export interface StepCompletion {
  id: string
  step_id: string
  outlet_id: string
  status: StepStatus
  proof_url?: string
  proof_notes?: string
  staff_name?: string
  submitted_at?: string
  reviewed_at?: string
  reviewer_id?: string
  rejection_reason?: string
  created_at: string
  step?: Step
  outlet?: Outlet
}

export interface Notification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  message: string
  read: boolean
  plan_id?: string
  step_id?: string
  outlet_id?: string
  created_at: string
}

// Computed view types
export interface OutletProgress {
  outlet: Outlet
  total_steps: number
  completed_steps: number
  pending_steps: number
  rejected_steps: number
  pct: number
  status: 'Not Started' | 'In Progress' | 'On Track' | 'Overdue' | 'Completed'
}

export interface PlanWithProgress extends TrainingPlan {
  total_steps: number
  outlet_count: number
  trainer?: Profile
}
