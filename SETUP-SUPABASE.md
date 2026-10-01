# Connecting the Golf Ball Fitter to Supabase

## 1. Create a Supabase project
If you don't already have one: [supabase.com](https://supabase.com) → New project. Takes a couple of minutes to provision.

## 2. Run the schema
In your project: **SQL Editor** → **New query** → paste the entire contents of `supabase-schema.sql` → **Run**.

This creates two tables (`fitting_submissions`, `tester_feedback`) with Row Level Security already configured: anyone can submit a fitting or feedback, but nobody using the public site can read, edit, or delete any data — including their own. Only you, in the Supabase dashboard, can see the results.

## 3. Get your credentials
**Settings → API** in your Supabase project. You need:
- **Project URL** (e.g. `https://xxxxx.supabase.co`)
- **anon / public key** (a long string starting `eyJ...`)

Do **not** use the `service_role` key here — that one bypasses Row Level Security entirely and must never appear in client-side code.

## 4. Fill in `config.js`
Open `config.js` and replace both placeholder values with what you copied in step 3. That's the only file that needs editing.

## 5. Deploy
All six files (plus `config.js` and `supabase-client.js`) go in the same folder, unchanged relative to each other. No build step. Push to GitHub, connect the repo to Cloudflare Pages, done.

## Viewing results
Supabase dashboard → **Table Editor** → `fitting_submissions` / `tester_feedback`. That's also where you'd export data for analysis later.

## A deliberate design choice, worth knowing
The RLS policies grant `INSERT` only — not `SELECT`. This means the app's own code can never read data back after saving it, which is why it generates each row's ID itself (`crypto.randomUUID()`) before inserting, rather than asking the database for it afterwards. If you ever add a feature that needs to read data back from the browser (e.g. "see what other testers picked"), that needs its own, deliberately-scoped SELECT policy — don't just grant broad read access to `anon`.
