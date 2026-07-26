-- 5.6: vendor GRNs capture an invoice file. Adds a path column on grns
-- (nullable — internal-source GRNs never have one) plus a private
-- Storage bucket and RLS on storage.objects mirroring the grns table's
-- own access rule (admin any branch, branch_manager/store_manager/
-- purchase_manager own branch, hod own department) rather than
-- inventing a separate permission model for the file.

alter table public.grns add column invoice_path text;

insert into storage.buckets (id, name, public)
values ('grn-invoices', 'grn-invoices', false)
on conflict (id) do nothing;

-- Objects are stored at "<grn id>/<filename>" — the path's first
-- segment is matched against the owning grn's branch/department scope,
-- the same shape used by every other RLS policy in this project.
create policy grn_invoices_select on storage.objects
for select
using (
  bucket_id = 'grn-invoices'
  and exists (
    select 1 from public.grns g
    where g.id::text = (storage.foldername(name))[1]
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'store_manager', 'purchase_manager')
          and g.branch_id = public.current_profile_branch_id()
        )
        or (
          public.current_profile_role() = 'hod'
          and public.is_assigned_to_department(g.department_id)
        )
      )
  )
);

create policy grn_invoices_insert on storage.objects
for insert
with check (
  bucket_id = 'grn-invoices'
  and exists (
    select 1 from public.grns g
    where g.id::text = (storage.foldername(name))[1]
      and g.status = 'draft'
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'store_manager', 'purchase_manager')
          and g.branch_id = public.current_profile_branch_id()
        )
        or (
          public.current_profile_role() = 'hod'
          and public.is_assigned_to_department(g.department_id)
        )
      )
  )
);
