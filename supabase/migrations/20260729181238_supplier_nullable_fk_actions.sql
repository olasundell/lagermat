alter table public.supplier_products
  drop constraint supplier_products_latest_import_fk,
  add constraint supplier_products_latest_import_fk
    foreign key (
      organization_id,
      supplier_account_id,
      latest_import_run_id
    )
    references public.supplier_import_runs (
      organization_id,
      supplier_account_id,
      id
    )
    on delete set null (latest_import_run_id);

alter table public.supplier_import_rows
  drop constraint supplier_import_rows_product_fk,
  add constraint supplier_import_rows_product_fk
    foreign key (
      organization_id,
      supplier_account_id,
      supplier_product_id
    )
    references public.supplier_products (
      organization_id,
      supplier_account_id,
      id
    )
    on delete set null (supplier_product_id);

alter table public.supplier_match_candidates
  drop constraint supplier_match_candidates_import_run_fk,
  add constraint supplier_match_candidates_import_run_fk
    foreign key (
      organization_id,
      supplier_account_id,
      import_run_id
    )
    references public.supplier_import_runs (
      organization_id,
      supplier_account_id,
      id
    )
    on delete set null (import_run_id);
