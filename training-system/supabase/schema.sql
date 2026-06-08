-- ============================================================
-- CALO NPD TRAINING SYSTEM — Database Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- PROFILES (extends auth.users)
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null,
  role        text not null check (role in ('Admin', 'Trainer', 'CEO')),
  job_title   text,                        -- e.g. "NPD Chef", "Nutritionist"
  created_at  timestamptz default now()
);

-- OUTLETS
create table public.outlets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location    text,
  created_at  timestamptz default now()
);

-- TRAINING PLANS
create table public.training_plans (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  trainer_id  uuid references public.profiles(id),
  start_date  date,
  deadline    date,
  status      text not null default 'Draft' check (status in ('Draft','Active','Completed','Archived')),
  created_by  uuid references public.profiles(id),
  created_at  timestamptz default now()
);

-- PLAN ↔ OUTLET (many-to-many)
create table public.plan_outlets (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.training_plans(id) on delete cascade,
  outlet_id   uuid not null references public.outlets(id) on delete cascade,
  assigned_at timestamptz default now(),
  unique(plan_id, outlet_id)
);

-- STEPS
create table public.steps (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references public.training_plans(id) on delete cascade,
  order_num        integer not null default 1,
  title            text not null,
  description      text,
  instructions     text,
  attachment_url   text,
  attachment_type  text check (attachment_type in ('pdf','video','image',null)),
  created_at       timestamptz default now()
);

-- STEP COMPLETIONS (one per step per outlet)
create table public.step_completions (
  id                uuid primary key default gen_random_uuid(),
  step_id           uuid not null references public.steps(id) on delete cascade,
  outlet_id         uuid not null references public.outlets(id) on delete cascade,
  status            text not null default 'Not Started'
                      check (status in ('Not Started','Submitted','Approved','Rejected')),
  proof_url         text,
  proof_notes       text,
  staff_name        text,
  submitted_at      timestamptz,
  reviewed_at       timestamptz,
  reviewer_id       uuid references public.profiles(id),
  rejection_reason  text,
  created_at        timestamptz default now(),
  unique(step_id, outlet_id)
);

-- NOTIFICATIONS
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null,   -- 'plan_created','proof_submitted','proof_approved','proof_rejected','overdue_warning','overdue','plan_completed','outlet_assigned'
  title       text not null,
  message     text not null,
  read        boolean default false,
  plan_id     uuid references public.training_plans(id) on delete set null,
  step_id     uuid references public.steps(id) on delete set null,
  outlet_id   uuid references public.outlets(id) on delete set null,
  created_at  timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles          enable row level security;
alter table public.outlets           enable row level security;
alter table public.training_plans    enable row level security;
alter table public.plan_outlets      enable row level security;
alter table public.steps             enable row level security;
alter table public.step_completions  enable row level security;
alter table public.notifications     enable row level security;

-- Helper: get current user role
create or replace function public.my_role()
returns text language sql security definer stable as $$
  select role from public.profiles where id = auth.uid()
$$;

-- PROFILES policies
create policy "Users can read all profiles" on public.profiles for select using (true);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Admin can insert profiles" on public.profiles for insert with check (public.my_role() = 'Admin');

-- OUTLETS policies
create policy "All authenticated can view outlets" on public.outlets for select using (auth.role() = 'authenticated');
create policy "Admin can manage outlets" on public.outlets for all using (public.my_role() = 'Admin');

-- TRAINING PLANS policies
create policy "All authenticated can view plans" on public.training_plans for select using (auth.role() = 'authenticated');
create policy "Admin can manage plans" on public.training_plans for all using (public.my_role() = 'Admin');

-- PLAN OUTLETS policies
create policy "All authenticated can view plan_outlets" on public.plan_outlets for select using (auth.role() = 'authenticated');
create policy "Admin can manage plan_outlets" on public.plan_outlets for all using (public.my_role() = 'Admin');

-- STEPS policies
create policy "All authenticated can view steps" on public.steps for select using (auth.role() = 'authenticated');
create policy "Admin can manage steps" on public.steps for all using (public.my_role() = 'Admin');

-- STEP COMPLETIONS policies
create policy "All authenticated can view completions" on public.step_completions for select using (auth.role() = 'authenticated');
create policy "Trainer can submit proof" on public.step_completions for update using (public.my_role() = 'Trainer');
create policy "Trainer can insert completion" on public.step_completions for insert with check (public.my_role() = 'Trainer');
create policy "CEO can approve/reject" on public.step_completions for update using (public.my_role() in ('CEO','Admin'));

-- NOTIFICATIONS policies
create policy "Users see own notifications" on public.notifications for select using (auth.uid() = user_id);
create policy "System can insert notifications" on public.notifications for insert with check (true);
create policy "Users can mark own as read" on public.notifications for update using (auth.uid() = user_id);

-- ============================================================
-- STORAGE BUCKET (run separately or via dashboard)
-- ============================================================
-- insert into storage.buckets (id, name, public) values ('proofs', 'proofs', false);
-- insert into storage.buckets (id, name, public) values ('attachments', 'attachments', true);

-- ============================================================
-- FUNCTION: notify users on proof submission
-- ============================================================
create or replace function public.handle_proof_submitted()
returns trigger language plpgsql security definer as $$
declare
  v_step    record;
  v_plan    record;
  v_outlet  record;
  v_admin   record;
begin
  if NEW.status = 'Submitted' and OLD.status = 'Not Started' then
    select * into v_step   from public.steps           where id = NEW.step_id;
    select * into v_plan   from public.training_plans  where id = v_step.plan_id;
    select * into v_outlet from public.outlets         where id = NEW.outlet_id;

    -- Notify Admin
    for v_admin in select id from public.profiles where role = 'Admin' loop
      insert into public.notifications(user_id,type,title,message,plan_id,step_id,outlet_id)
      values(v_admin.id,'proof_submitted','New Proof Submitted',
        v_outlet.name || ' — ' || v_step.title,v_plan.id,NEW.step_id,NEW.outlet_id);
    end loop;

    -- Notify CEO
    for v_admin in select id from public.profiles where role = 'CEO' loop
      insert into public.notifications(user_id,type,title,message,plan_id,step_id,outlet_id)
      values(v_admin.id,'proof_submitted','Proof Awaiting Your Review',
        v_outlet.name || ' — ' || v_step.title,v_plan.id,NEW.step_id,NEW.outlet_id);
    end loop;
  end if;
  return NEW;
end;
$$;

create trigger on_proof_submitted
after update on public.step_completions
for each row execute function public.handle_proof_submitted();

-- ============================================================
-- FUNCTION: notify on approve/reject
-- ============================================================
create or replace function public.handle_proof_reviewed()
returns trigger language plpgsql security definer as $$
declare
  v_step   record;
  v_plan   record;
  v_outlet record;
  v_admin  record;
begin
  if NEW.status in ('Approved','Rejected') and OLD.status = 'Submitted' then
    select * into v_step   from public.steps           where id = NEW.step_id;
    select * into v_plan   from public.training_plans  where id = v_step.plan_id;
    select * into v_outlet from public.outlets         where id = NEW.outlet_id;

    -- Notify trainer
    insert into public.notifications(user_id,type,title,message,plan_id,step_id,outlet_id)
    values(
      v_plan.trainer_id,
      case when NEW.status='Approved' then 'proof_approved' else 'proof_rejected' end,
      case when NEW.status='Approved' then 'Proof Approved ✓' else 'Proof Rejected — Action Required' end,
      v_outlet.name || ' — ' || v_step.title ||
        case when NEW.status='Rejected' then ': ' || coalesce(NEW.rejection_reason,'') else '' end,
      v_plan.id, NEW.step_id, NEW.outlet_id
    );

    -- Notify Admins
    for v_admin in select id from public.profiles where role = 'Admin' loop
      insert into public.notifications(user_id,type,title,message,plan_id,step_id,outlet_id)
      values(v_admin.id,
        case when NEW.status='Approved' then 'proof_approved' else 'proof_rejected' end,
        'Proof ' || NEW.status,
        v_outlet.name || ' — ' || v_step.title,
        v_plan.id, NEW.step_id, NEW.outlet_id);
    end loop;
  end if;
  return NEW;
end;
$$;

create trigger on_proof_reviewed
after update on public.step_completions
for each row execute function public.handle_proof_reviewed();
