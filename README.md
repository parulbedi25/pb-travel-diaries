# PB Travel Diaries

A React/Vite travel site with an optional Supabase-backed account system.

## Local development

```bash
npm ci
cp .env.example .env.local
# Fill in the Supabase project URL and public anon key in .env.local
npm run dev
```

The account pages remain in a setup state until `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are configured. These are public browser values; **never put a Supabase service-role key in a `VITE_` variable or in this frontend**.

## Supabase auth setup

The app expects a Supabase project with email/password auth, email confirmations, a private `profiles` table, and two Edge Functions.

1. Create a Supabase project. In **Authentication → Providers → Email**, keep email/password enabled and turn on **Confirm email**.
2. Configure a working SMTP provider in Supabase **Authentication → SMTP Settings** for production delivery. Supabase's default mail service is intended for testing and may have tight delivery limits.
3. In **Authentication → URL Configuration**, set the production site URL and add allowed redirect URLs for local development (`http://localhost:5173/**`) and the deployed site (`https://your-domain.example/**`). The signup flow redirects to `/?auth=verified` after Supabase confirms the email.
4. Copy `.env.example` to `.env.local` and set the Supabase project URL and public anon key. Set the same two public values in the frontend hosting environment.
5. Install/use the Supabase CLI, then link the project and deploy the schema and functions:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   npx supabase functions deploy username-login
   npx supabase functions deploy admin-users
   ```

   Supabase Edge Functions use the project's server-side `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` secrets. If your project does not inject these built-in values, set them with `supabase secrets set` **for the functions only**. Do not copy the service-role key into `.env.local`, Vite variables, source code, or browser storage.

## Account flows

- Visitors open **Sign in** from the person icon in the site header (`#/account`). Sign-up collects a username, email, and password. Supabase sends its confirmation link; clicking it verifies the address and returns to the account page.
- Users may sign in with either their email or username plus password. Username resolution runs in an Edge Function and never exposes the matching email to the browser.
- In the existing dashboard, use **Users**. That panel requires a Supabase session whose private `profiles.role` is `super_admin`; the local PB Control password alone does not grant account-management access.
- The user list distinguishes **Pending verification**, **Email verified**, and **Created by admin** accounts. Admin-created accounts are confirmed by the server function and do not receive a confirmation email. The administrator must provide the initial password to that user securely.

## Bootstrap the first super admin

After creating the owner's account through the public signup page and confirming its email, open the Supabase SQL Editor. Replace the email below with the owner's address, run it, and confirm exactly one row was updated:

```sql
update public.profiles as p
set role = 'super_admin'
from auth.users as u
where u.id = p.id
  and lower(u.email) = lower('owner@example.com')
  and u.email_confirmed_at is not null;
```

Then sign in to `#/admin` using the existing PB Control login, open **Users**, and sign in to the user manager with that Supabase super-admin account. User listing, role checks, and account creation are enforced again by the Edge Function; the browser never receives the service-role key.
