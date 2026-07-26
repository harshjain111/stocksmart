-- Fixes a mismatch found while building 4.3 (Requisitions > To approve):
-- block_requisition_line_mutations() was written to allow decision/
-- approved_qty_g/decision_note to be set while the parent requisition is
-- 'submitted' (that's the whole point of the approver step), but the
-- requisition_lines_update RLS policy from 4.1 only ever allowed
-- status = 'draft', and only for admin/hod — branch_manager and
-- store_manager (the actual approvers) had no RLS path to the row at
-- all once it left draft. RLS runs before the trigger, so every approver
-- write was silently filtered to 0 rows rather than reaching the trigger.

drop policy requisition_lines_update on public.requisition_lines;

create policy requisition_lines_update on public.requisition_lines
for update
using (
  exists (
    select 1 from public.requisitions r
    where r.id = requisition_lines.requisition_id
      and (
        (
          r.status = 'draft'
          and (
            public.current_profile_role() = 'admin'
            or (
              public.current_profile_role() = 'hod'
              and public.is_assigned_to_department(r.department_id)
            )
          )
        )
        or (
          r.status = 'submitted'
          and (
            public.current_profile_role() = 'admin'
            or (
              public.current_profile_role() in ('branch_manager', 'store_manager')
              and r.branch_id = public.current_profile_branch_id()
            )
          )
        )
      )
  )
)
with check (
  exists (
    select 1 from public.requisitions r
    where r.id = requisition_lines.requisition_id
      and (
        (
          r.status = 'draft'
          and (
            public.current_profile_role() = 'admin'
            or (
              public.current_profile_role() = 'hod'
              and public.is_assigned_to_department(r.department_id)
            )
          )
        )
        or (
          r.status = 'submitted'
          and (
            public.current_profile_role() = 'admin'
            or (
              public.current_profile_role() in ('branch_manager', 'store_manager')
              and r.branch_id = public.current_profile_branch_id()
            )
          )
        )
      )
  )
);
