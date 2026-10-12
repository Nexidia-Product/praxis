-- =============================================================================
-- NiCE products, and which of them a use case / project aligns to.
-- =============================================================================
--
-- `nice_products` is an admin-managed catalogue (name, description,
-- deprecated flag). Products are never deleted — a retired product is
-- flagged `deprecated` so existing alignments stay readable while it drops
-- out of the pickers. Seeded from the Products listing at www.nice.com.
--
-- A use case aligns to one or more products (`use_cases.nice_product_ids`).
-- A project then picks from the products of the use case it belongs to
-- (`projects.nice_product_ids`), the same way it picks use case outcomes
-- (0040). Consistency is enforced in code (lib/products/*,
-- lib/use-cases/service.ts reconciles after any change); ids can't be real
-- FKs because they live in text[] columns.

create table if not exists public.nice_products (
  product_id   uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text not null default '',
  deprecated   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists nice_products_name_key
  on public.nice_products (lower(name));

drop trigger if exists nice_products_set_updated_at on public.nice_products;
create trigger nice_products_set_updated_at
  before update on public.nice_products
  for each row execute function public.set_updated_at();

alter table public.nice_products enable row level security;

alter table public.use_cases
  add column if not exists nice_product_ids text[] not null default '{}';

alter table public.projects
  add column if not exists nice_product_ids text[] not null default '{}';

create index if not exists use_cases_nice_product_ids_idx
  on public.use_cases using gin (nice_product_ids);
create index if not exists projects_nice_product_ids_idx
  on public.projects using gin (nice_product_ids);

insert into public.nice_products (name, description) values
  ('NiCE CXone', 'Enterprise platform for coordinating human and AI agents, automating service, and scaling customer experiences.'),
  ('NiCE Cognigy', 'Conversational and agentic AI that works alongside CXone to scale AI across customer experiences.'),
  ('AI Agents for Self-Service', 'AI agents that carry customer requests through to completion.'),
  ('AI Agents for Sales and Marketing', 'AI agents that create sales and loyalty opportunities at customer touchpoints.'),
  ('AI Agents for Proactive Engagement', 'AI agents that keep customers in conversation across the customer lifecycle.'),
  ('AI Agents for Process Automation', 'AI agents that run tasks across business systems.'),
  ('Knowledge Management', 'AI-powered access to enterprise knowledge to improve self-service resolution.'),
  ('Interactive Voice Response', 'Automated phone self-service and call routing.'),
  ('Omnichannel Routing', 'Matching customers with the right agent across channels.'),
  ('Outbound Engagement', 'Proactive outbound calling to increase revenue and reduce friction.'),
  ('Digital Experience', 'Consistent, cross-channel customer conversations.'),
  ('Voice Services', 'Cloud voice and data services.'),
  ('Orchestration', 'Unified management of service workflows from intent to fulfillment.'),
  ('Workforce Management', 'AI forecasting and scheduling to meet service levels cost-effectively.'),
  ('Quality Management', 'AI evaluation of interactions and agent coaching.'),
  ('Performance Management', 'Goal tracking, coaching, and gamification for employees.'),
  ('Recording Management', 'Interaction recording for compliance and performance.'),
  ('Interaction Analytics', 'AI-driven insights from interactions.'),
  ('Feedback Management', 'Customer feedback analysis to guide loyalty and growth.'),
  ('Copilot for Agents', 'An AI assistant for customer service agents.'),
  ('Copilot for Supervisors', 'An AI assistant for supervisors.')
on conflict do nothing;
