-- Document numbering: REQ-0001, TRF-0001, PO-0001, GRN-0001, B-0001, CNT-0001.
-- Sequential per type, per branch, per financial year (Apr-Mar, IST).
-- Never client-generated: the only way to get a number is next_doc_no(),
-- which atomically increments via INSERT ... ON CONFLICT DO UPDATE — the
-- row lock that takes serializes concurrent callers, so nothing is ever
-- issued twice. document_sequences itself has no policies at all (default
-- deny for every role); next_doc_no() is SECURITY DEFINER so it can write
-- to the counter regardless of the caller's own RLS grants.

create type public.document_type as enum ('REQ', 'TRF', 'PO', 'GRN', 'B', 'CNT');

create table public.document_sequences (
  id uuid primary key default gen_random_uuid(),
  doc_type public.document_type not null,
  branch_id uuid not null references public.branches (id),
  financial_year text not null,
  last_number integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doc_type, branch_id, financial_year)
);

create trigger document_sequences_set_updated_at
  before update on public.document_sequences
  for each row execute function public.set_updated_at();

alter table public.document_sequences enable row level security;

create or replace function public.current_financial_year()
returns text
language sql
stable
as $$
  select case
    when extract(month from (now() at time zone 'Asia/Kolkata')) >= 4 then
      extract(year from (now() at time zone 'Asia/Kolkata'))::text
      || '-' ||
      right((extract(year from (now() at time zone 'Asia/Kolkata')) + 1)::text, 2)
    else
      (extract(year from (now() at time zone 'Asia/Kolkata')) - 1)::text
      || '-' ||
      right(extract(year from (now() at time zone 'Asia/Kolkata'))::text, 2)
  end;
$$;

grant execute on function public.current_financial_year() to authenticated;

create or replace function public.next_doc_no(p_doc_type public.document_type, p_branch_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fy text := public.current_financial_year();
  v_number integer;
begin
  insert into public.document_sequences (doc_type, branch_id, financial_year, last_number)
  values (p_doc_type, p_branch_id, v_fy, 1)
  on conflict (doc_type, branch_id, financial_year)
  do update set last_number = public.document_sequences.last_number + 1
  returning last_number into v_number;

  return p_doc_type::text || '-' || lpad(v_number::text, 4, '0');
end;
$$;

grant execute on function public.next_doc_no(public.document_type, uuid) to authenticated;
