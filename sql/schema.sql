-- Attendify Pro: Supabase schema and row-level security
-- Run the entire script in the Supabase SQL Editor as a project owner/admin.

-- A composite key allows child records to enforce that their class and owner
-- always refer to the same class row.
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    full_name text NOT NULL DEFAULT 'New teacher',
    institution_name text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS institution_name text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.classes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id uuid NOT NULL DEFAULT auth.uid()
        REFERENCES auth.users (id) ON DELETE CASCADE,
    name text NOT NULL,
    section text NOT NULL,
    academic_year text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT classes_teacher_name_section_year_key
        UNIQUE (teacher_id, name, section, academic_year),
    CONSTRAINT classes_id_teacher_key UNIQUE (id, teacher_id)
);

CREATE TABLE IF NOT EXISTS public.subjects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id uuid NOT NULL
        REFERENCES public.classes (id) ON DELETE CASCADE,
    name text NOT NULL,
    code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT subjects_id_class_key UNIQUE (id, class_id),
    CONSTRAINT subjects_class_name_key UNIQUE (class_id, name),
    CONSTRAINT subjects_class_code_key UNIQUE (class_id, code)
);

CREATE TABLE IF NOT EXISTS public.students (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id uuid NOT NULL DEFAULT auth.uid()
        REFERENCES auth.users (id) ON DELETE CASCADE,
    class_id uuid NOT NULL,
    roll_number text NOT NULL,
    full_name text NOT NULL,
    email text,
    description text,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT students_class_owner_fkey
        FOREIGN KEY (class_id, teacher_id)
        REFERENCES public.classes (id, teacher_id) ON DELETE CASCADE,
    CONSTRAINT students_class_roll_number_key UNIQUE (class_id, roll_number),
    CONSTRAINT students_id_class_key UNIQUE (id, class_id)
);
ALTER TABLE public.students
    ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.students
    ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.students
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
UPDATE public.students
SET deleted_at = updated_at
WHERE status = 'inactive'
  AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.class_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id uuid NOT NULL
        REFERENCES public.classes (id) ON DELETE CASCADE,
    subject_id uuid NOT NULL,
    session_date date NOT NULL,
    title text NOT NULL,
    start_time time NOT NULL,
    end_time time NOT NULL,
    topic text,
    status text NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'completed', 'cancelled')),
    created_by uuid NOT NULL DEFAULT auth.uid()
        REFERENCES auth.users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT class_sessions_time_order_check CHECK (end_time > start_time),
    CONSTRAINT class_sessions_subject_class_fkey
        FOREIGN KEY (subject_id, class_id)
        REFERENCES public.subjects (id, class_id) ON DELETE CASCADE,
    CONSTRAINT class_sessions_id_class_creator_key
        UNIQUE (id, class_id, created_by)
);

CREATE TABLE IF NOT EXISTS public.attendance_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL
        REFERENCES public.class_sessions (id) ON DELETE CASCADE,
    student_id uuid NOT NULL
        REFERENCES public.students (id) ON DELETE RESTRICT,
    attendance_status text NOT NULL DEFAULT 'Not Marked'
        CHECK (
            attendance_status IN ('Present', 'Absent', 'Leave', 'Not Marked')
        ),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT attendance_records_session_student_key
        UNIQUE (session_id, student_id)
);

ALTER TABLE public.attendance_records
    DROP CONSTRAINT IF EXISTS attendance_records_student_id_fkey;
ALTER TABLE public.attendance_records
    ADD CONSTRAINT attendance_records_student_id_fkey
    FOREIGN KEY (student_id)
    REFERENCES public.students (id)
    ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.class_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id uuid NOT NULL DEFAULT auth.uid()
        REFERENCES auth.users (id) ON DELETE CASCADE,
    class_id uuid NOT NULL,
    subject_id uuid,
    weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_time time NOT NULL,
    end_time time NOT NULL,
    effective_from date NOT NULL DEFAULT CURRENT_DATE,
    effective_until date,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT class_schedules_time_order_check CHECK (end_time > start_time),
    CONSTRAINT class_schedules_effective_dates_check
        CHECK (effective_until IS NULL OR effective_until >= effective_from),
    CONSTRAINT class_schedules_class_owner_fkey
        FOREIGN KEY (class_id, teacher_id)
        REFERENCES public.classes (id, teacher_id) ON DELETE CASCADE,
    CONSTRAINT class_schedules_subject_class_fkey
        FOREIGN KEY (subject_id, class_id)
        REFERENCES public.subjects (id, class_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.holidays (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id uuid NOT NULL DEFAULT auth.uid()
        REFERENCES auth.users (id) ON DELETE CASCADE,
    holiday_date date NOT NULL,
    name text NOT NULL,
    academic_year text NOT NULL,
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT holidays_teacher_date_name_key
        UNIQUE (teacher_id, holiday_date, name)
);

-- Indexes for ownership checks, joins, and common list/filter operations.
CREATE INDEX IF NOT EXISTS classes_teacher_status_year_idx
    ON public.classes (teacher_id, status, academic_year);
CREATE INDEX IF NOT EXISTS subjects_class_idx
    ON public.subjects (class_id);
CREATE INDEX IF NOT EXISTS students_teacher_class_status_idx
    ON public.students (teacher_id, class_id, status);
CREATE INDEX IF NOT EXISTS students_teacher_lifecycle_idx
    ON public.students (teacher_id, class_id, created_at, deleted_at);
CREATE INDEX IF NOT EXISTS class_sessions_class_date_idx
    ON public.class_sessions (class_id, session_date);
CREATE INDEX IF NOT EXISTS class_sessions_creator_date_idx
    ON public.class_sessions (created_by, session_date);
CREATE INDEX IF NOT EXISTS attendance_records_session_idx
    ON public.attendance_records (session_id);
CREATE INDEX IF NOT EXISTS attendance_records_student_idx
    ON public.attendance_records (student_id);
CREATE INDEX IF NOT EXISTS class_schedules_teacher_class_weekday_idx
    ON public.class_schedules (teacher_id, class_id, weekday)
    WHERE is_active;
CREATE INDEX IF NOT EXISTS holidays_teacher_date_idx
    ON public.holidays (teacher_id, holiday_date);

-- Maintain updated_at consistently on tables that have that column.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

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

DO $block$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'profiles',
        'classes',
        'students',
        'class_sessions',
        'attendance_records',
        'class_schedules',
        'holidays'
    ]
    LOOP
        EXECUTE pg_catalog.format(
            'DROP TRIGGER IF EXISTS set_updated_at ON public.%I',
            table_name
        );
        EXECUTE pg_catalog.format(
            'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I '
            'FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
            table_name
        );
    END LOOP;
END;
$block$;

-- Create profiles automatically for new Auth users.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    INSERT INTO public.profiles (id, full_name)
    VALUES (
        NEW.id,
        COALESCE(
            NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
            'New teacher'
        )
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill profiles for Auth users that predate this script.
INSERT INTO public.profiles (id, full_name)
SELECT
    users.id,
    COALESCE(
        NULLIF(pg_catalog.btrim(users.raw_user_meta_data ->> 'full_name'), ''),
        'New teacher'
    )
FROM auth.users AS users
ON CONFLICT (id) DO NOTHING;

-- Row-level security is enabled on every application table.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

-- Remove broad table grants, then grant only the intended authenticated access.
REVOKE ALL PRIVILEGES ON TABLE
    public.profiles,
    public.classes,
    public.subjects,
    public.students,
    public.class_sessions,
    public.attendance_records,
    public.class_schedules,
    public.holidays
FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (full_name, institution_name) ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.classes,
    public.subjects,
    public.students,
    public.class_sessions,
    public.attendance_records,
    public.class_schedules,
    public.holidays
TO authenticated;

-- Profiles: users can only view/update their own profile.
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (id = (SELECT auth.uid()))
    WITH CHECK (id = (SELECT auth.uid()));

-- Classes: the teacher_id is always the authenticated user.
DROP POLICY IF EXISTS classes_owner_all ON public.classes;
CREATE POLICY classes_owner_all
    ON public.classes
    FOR ALL
    TO authenticated
    USING (teacher_id = (SELECT auth.uid()))
    WITH CHECK (teacher_id = (SELECT auth.uid()));

-- Subjects: authorize through ownership of the parent class.
DROP POLICY IF EXISTS subjects_class_owner_all ON public.subjects;
CREATE POLICY subjects_class_owner_all
    ON public.subjects
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.classes AS class_row
            WHERE class_row.id = subjects.class_id
              AND class_row.teacher_id = (SELECT auth.uid())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.classes AS class_row
            WHERE class_row.id = subjects.class_id
              AND class_row.teacher_id = (SELECT auth.uid())
        )
    );

-- Students: both their owner column and parent class must match the user.
DROP POLICY IF EXISTS students_owner_all ON public.students;
CREATE POLICY students_owner_all
    ON public.students
    FOR ALL
    TO authenticated
    USING (
        teacher_id = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1
            FROM public.classes AS class_row
            WHERE class_row.id = students.class_id
              AND class_row.teacher_id = (SELECT auth.uid())
        )
    )
    WITH CHECK (
        teacher_id = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1
            FROM public.classes AS class_row
            WHERE class_row.id = students.class_id
              AND class_row.teacher_id = (SELECT auth.uid())
        )
    );

-- Sessions: creator and class owner must both be the authenticated teacher.
DROP POLICY IF EXISTS class_sessions_owner_all ON public.class_sessions;
CREATE POLICY class_sessions_owner_all
    ON public.class_sessions
    FOR ALL
    TO authenticated
    USING (
        created_by = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1
            FROM public.classes AS class_row
            WHERE class_row.id = class_sessions.class_id
              AND class_row.teacher_id = (SELECT auth.uid())
        )
    )
    WITH CHECK (
        created_by = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1
            FROM public.classes AS class_row
            WHERE class_row.id = class_sessions.class_id
              AND class_row.teacher_id = (SELECT auth.uid())
        )
    );

-- Attendance history remains visible after transfer/deactivation, while new
-- records must still match the student's current class.
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

-- Schedules: verify both the schedule teacher and owning class.
DROP POLICY IF EXISTS class_schedules_owner_all ON public.class_schedules;
CREATE POLICY class_schedules_owner_all
    ON public.class_schedules
    FOR ALL
    TO authenticated
    USING (
        teacher_id = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1
            FROM public.classes AS class_row
            WHERE class_row.id = class_schedules.class_id
              AND class_row.teacher_id = (SELECT auth.uid())
        )
    )
    WITH CHECK (
        teacher_id = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1
            FROM public.classes AS class_row
            WHERE class_row.id = class_schedules.class_id
              AND class_row.teacher_id = (SELECT auth.uid())
        )
    );

-- Holidays are private to the teacher who created them.
DROP POLICY IF EXISTS holidays_owner_all ON public.holidays;
CREATE POLICY holidays_owner_all
    ON public.holidays
    FOR ALL
    TO authenticated
    USING (teacher_id = (SELECT auth.uid()))
    WITH CHECK (teacher_id = (SELECT auth.uid()));
