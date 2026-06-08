# CALO NPD Training System — Setup Guide

## 1. Create Supabase Project
1. Go to https://supabase.com and create a new project
2. Copy your **Project URL** and **anon key** from Settings → API
3. Copy your **service_role key** (keep this secret — server only)

## 2. Run the Database Schema
1. Open Supabase SQL Editor
2. Paste and run the full contents of `supabase/schema.sql`
3. Create storage buckets in Supabase Dashboard → Storage:
   - `proofs` (private) — for trainer proof uploads
   - `attachments` (public) — for step PDFs/videos

## 3. Configure Environment Variables
```bash
cp .env.example .env.local
```
Fill in your Supabase values in `.env.local`

## 4. Install & Run
```bash
npm install
npm run dev
```

## 5. Create Your Admin Account
1. Go to Supabase Dashboard → Authentication → Users
2. Click "Invite user" or "Add user" and create your account
3. In SQL Editor, insert your profile:
```sql
insert into public.profiles (id, email, full_name, role, job_title)
values (
  'your-user-uuid-from-auth',
  'your@email.com',
  'Your Name',
  'Admin',
  'Admin'
);
```

## 6. Add Users
Once logged in as Admin, go to **Users** page and add trainers and the CEO.

## Roles
| Role    | Access |
|---------|--------|
| Admin   | Everything — create plans, steps, outlets, users |
| Trainer | See assigned plans/outlets, upload proofs per step |
| CEO     | View all, approve or reject proofs with feedback |

## Notification Triggers
Automatic in-app notifications fire for:
- New training plan created
- Outlet assigned to plan
- Proof submitted by trainer
- Proof approved/rejected by CEO
- (Schedule a cron job via Supabase Edge Functions for deadline warnings)
