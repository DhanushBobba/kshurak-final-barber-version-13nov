-- KSHURAK Admin Audit Logs
-- Migration: 001_create_admin_audit_logs.sql
-- Application-managed append-only audit history.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    actor_user_id UUID NOT NULL
        REFERENCES auth.users(id) ON DELETE RESTRICT,

    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(100) NOT NULL,
    target_id TEXT,

    previous_values JSONB,
    new_values JSONB,
    metadata JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_actor
ON public.admin_audit_logs(actor_user_id);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at
ON public.admin_audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_action
ON public.admin_audit_logs(action);

ALTER TABLE public.admin_audit_logs
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_audit_logs
FROM PUBLIC, anon, authenticated;


-- Prevent UPDATE and DELETE operations on audit records.
-- This protects records even from ordinary table owners.
-- Privileged database administrators can still change schema objects.

CREATE OR REPLACE FUNCTION public.prevent_admin_audit_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Admin audit records are append-only and cannot be modified';
END;
$$;

CREATE TRIGGER trg_prevent_admin_audit_modification
BEFORE UPDATE OR DELETE
ON public.admin_audit_logs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_admin_audit_modification();


-- Prevent removal of all audit records through TRUNCATE.
CREATE TRIGGER trg_prevent_admin_audit_truncate
BEFORE TRUNCATE
ON public.admin_audit_logs
FOR EACH STATEMENT
EXECUTE FUNCTION public.prevent_admin_audit_modification();

COMMIT;
