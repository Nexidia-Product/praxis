# Configuring email delivery

Two distinct email channels:

1. **Auth emails** — invite acceptance, password recovery, email
   confirmation. Sent by **Supabase Auth** using the templates
   configured in your Supabase dashboard. Always available, no
   provider configuration needed on Praxis's side.

2. **Per-event notification emails** — `TaskAssigned`,
   `TaskDueSoon`, `TaskOverdue`, `ProjectBlocked`,
   `DependencyBlocked`, `HealthScoreChanged`, `IdeaStatusChanged`,
   plus the daily digest. Sent through **Resend** when configured;
   logged to stdout when not. Praxis still works without it — only
   email delivery is optional.

This doc covers channel #2 only. For channel #1 (Supabase), see the
"Configure Supabase Auth → Email Templates" section in `README.md`.

## What's wired up

Per-event notifications use [Resend](https://resend.com/). Reasoning:

- Single environment variable to configure (`RESEND_API_KEY`)
- Free tier (3,000 emails/month) is more than enough for a typical
  internal team
- The HTTP API is simple — integration is ~50 lines plus the Resend
  npm package

When `RESEND_API_KEY` is unset, `lib/notifications/email.ts` logs
every would-be email to stdout instead of sending. That's the
default in development. Production deployments either set
`RESEND_API_KEY` or accept "no email; in-app bell only."

If you want to swap providers (SendGrid, Postmark, SMTP, etc.), the
swap point is `lib/notifications/email.ts` — `getResendClient()` and
the call to `client.emails.send()` are the only Resend-specific
parts. The rest of the system calls `dispatchNotificationEmail()`
which doesn't care which provider is underneath.

## Setting up Resend

1. Sign up at [resend.com](https://resend.com) and create an API key.
2. Add to your environment (locally in `.env.local`, on Vercel via
   the project's Environment Variables):
   ```
   RESEND_API_KEY=re_<your_key>
   RESEND_FROM=Praxis <notifications@yourcompany.com>
   ```
3. To use a real `From` address, verify your domain in the Resend
   dashboard. For testing, leave `RESEND_FROM` unset and Resend will
   accept their default sandbox sender.
4. Restart `npm run dev` (or redeploy on Vercel). Email delivery is
   now live for every event a user has set to `Email + In-App`.

## Per-user preferences

Each user has a per-event-type delivery preference at
`/profile/notifications`:

- **In-app only** — bell drawer, no email
- **Email + in-app** — both
- **Off** — neither (no notification persisted at all)

There's also a top-level **Daily digest** toggle. When on, all
`Email + In-App` events accumulate during the day and ship in one
digest email at 07:00 UTC (the daily Vercel Cron run).

Org-wide defaults for new users live in the settings row under
`notification_defaults` — change them via the Admin Console.

## Testing without sending

In development, `RESEND_API_KEY` is typically unset. Open the
`npm run dev` terminal — every would-be email logs its
subject + recipient + body. Useful for verifying that the right
event fires for the right user without setting up a real inbox.
