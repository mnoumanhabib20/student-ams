BEGIN;

ALTER TABLE public.students
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

UPDATE public.students
SET deleted_at = updated_at
WHERE status = 'inactive'
  AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS students_teacher_lifecycle_idx
    ON public.students (teacher_id, class_id, created_at, deleted_at);

CREATE OR REPLACE FUNCTION public.prevent_student_id_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Student IDs are immutable'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_student_id_change()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_student_id_change ON public.students;
CREATE TRIGGER prevent_student_id_change
    BEFORE UPDATE OF id ON public.students
    FOR EACH ROW EXECUTE FUNCTION public.prevent_student_id_change();

CREATE OR REPLACE FUNCTION public.sync_student_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    IF NEW.status = 'inactive' AND NEW.deleted_at IS NULL THEN
        NEW.deleted_at := pg_catalog.now();
    ELSIF NEW.status = 'active' THEN
        NEW.deleted_at := NULL;
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_student_lifecycle()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_student_lifecycle_insert ON public.students;
CREATE TRIGGER sync_student_lifecycle_insert
    BEFORE INSERT ON public.students
    FOR EACH ROW EXECUTE FUNCTION public.sync_student_lifecycle();

DROP TRIGGER IF EXISTS sync_student_lifecycle_update ON public.students;
CREATE TRIGGER sync_student_lifecycle_update
    BEFORE UPDATE OF status, deleted_at ON public.students
    FOR EACH ROW EXECUTE FUNCTION public.sync_student_lifecycle();

CREATE OR REPLACE FUNCTION public.prevent_attendance_link_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    IF NEW.student_id IS DISTINCT FROM OLD.student_id
       OR NEW.session_id IS DISTINCT FROM OLD.session_id THEN
        RAISE EXCEPTION 'Attendance student and session links are immutable'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_attendance_link_change()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_attendance_link_change ON public.attendance_records;
CREATE TRIGGER prevent_attendance_link_change
    BEFORE UPDATE OF student_id, session_id ON public.attendance_records
    FOR EACH ROW EXECUTE FUNCTION public.prevent_attendance_link_change();

ALTER TABLE public.attendance_records
    DROP CONSTRAINT IF EXISTS attendance_records_student_id_fkey;
ALTER TABLE public.attendance_records
    ADD CONSTRAINT attendance_records_student_id_fkey
    FOREIGN KEY (student_id)
    REFERENCES public.students (id)
    ON DELETE RESTRICT;

DROP POLICY IF EXISTS attendance_records_owner_all ON public.attendance_records;
DROP POLICY IF EXISTS attendance_records_select_owner ON public.attendance_records;
CREATE POLICY attendance_records_select_owner
    ON public.attendance_records
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.class_sessions AS session_row
            JOIN public.classes AS class_row
              ON class_row.id = session_row.class_id
            JOIN public.students AS student_row
              ON student_row.id = attendance_records.student_id
            WHERE session_row.id = attendance_records.session_id
              AND session_row.created_by = (SELECT auth.uid())
              AND class_row.teacher_id = (SELECT auth.uid())
              AND student_row.teacher_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS attendance_records_insert_owner ON public.attendance_records;
CREATE POLICY attendance_records_insert_owner
    ON public.attendance_records
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.class_sessions AS session_row
            JOIN public.classes AS class_row
              ON class_row.id = session_row.class_id
            JOIN public.students AS student_row
              ON student_row.id = attendance_records.student_id
             AND student_row.class_id = session_row.class_id
            WHERE session_row.id = attendance_records.session_id
              AND session_row.created_by = (SELECT auth.uid())
              AND class_row.teacher_id = (SELECT auth.uid())
              AND student_row.teacher_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS attendance_records_update_owner ON public.attendance_records;
CREATE POLICY attendance_records_update_owner
    ON public.attendance_records
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.class_sessions AS session_row
            JOIN public.classes AS class_row
              ON class_row.id = session_row.class_id
            JOIN public.students AS student_row
              ON student_row.id = attendance_records.student_id
            WHERE session_row.id = attendance_records.session_id
              AND session_row.created_by = (SELECT auth.uid())
              AND class_row.teacher_id = (SELECT auth.uid())
              AND student_row.teacher_id = (SELECT auth.uid())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.class_sessions AS session_row
            JOIN public.classes AS class_row
              ON class_row.id = session_row.class_id
            JOIN public.students AS student_row
              ON student_row.id = attendance_records.student_id
            WHERE session_row.id = attendance_records.session_id
              AND session_row.created_by = (SELECT auth.uid())
              AND class_row.teacher_id = (SELECT auth.uid())
              AND student_row.teacher_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS attendance_records_delete_owner ON public.attendance_records;
CREATE POLICY attendance_records_delete_owner
    ON public.attendance_records
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.class_sessions AS session_row
            JOIN public.classes AS class_row
              ON class_row.id = session_row.class_id
            JOIN public.students AS student_row
              ON student_row.id = attendance_records.student_id
            WHERE session_row.id = attendance_records.session_id
              AND session_row.created_by = (SELECT auth.uid())
              AND class_row.teacher_id = (SELECT auth.uid())
              AND student_row.teacher_id = (SELECT auth.uid())
        )
    );

COMMIT;
