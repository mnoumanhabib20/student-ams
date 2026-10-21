# Attendify Pro

Attendify Pro is a modern, lightweight SaaS Student Management & Attendance Tracking System built for teachers. It provides a responsive workspace for organizing classes, managing student rosters, recording attendance, and reviewing student-wise attendance summaries.

## Key Features

- **Dynamic dashboard and workspace management** for a quick overview of classes, students, and attendance.
- **Class and subject management** with create, edit, and delete workflows.
- **Student roster management** with search, class filtering, editing, deletion, and flexible Excel (`.xlsx`/`.xls`) bulk import. Only `Name` and `Roll_Number` are required; other spreadsheet fields are optional.
- **Session-based attendance marking** with Present, Absent, Leave, and Not Marked statuses.
- **Student-wise attendance summaries and insights** with class, subject, and date-range filters, plus an individual monthly attendance calendar for each student.
- **Configurable attendance target** with soft green, yellow, and red indicators reflecting each student's attendance against the target.
- **One-click formatted Excel (`.xlsx`) export** for attendance reports, including report metadata, percentage-formatted data, and class averages, powered by SheetJS.
- **Persistent teacher workspace profile header** displaying the teacher's name, initials, and institution.
- **Supabase authentication and row-level security** for teacher-owned application data.
- **Responsive navigation and interface** for desktop, tablet, and mobile screens.

## Tech Stack

- **Frontend:** HTML5, vanilla JavaScript (ES6+ modules), custom CSS (with Tailwind-style utility class names where used; no frontend framework or build step).
- **Icons:** Lucide.
- **Backend and database:** Supabase Auth and PostgreSQL.
- **Spreadsheet engine:** SheetJS (`xlsx`).

Supabase JS, Lucide, and SheetJS are loaded from browser-accessible CDNs. An internet connection is required for these libraries and for Supabase features.

## Setup & Local Development

### Prerequisites

- [Visual Studio Code](https://code.visualstudio.com/) or another editor.
- A static local web server, such as the VS Code **Live Server** extension.
- A [Supabase](https://supabase.com/) account and project.
- A modern browser with JavaScript modules enabled.

### 1. Clone the repository

```bash
git clone https://github.com/mnoumanhabib20/student-AMS.git
cd student-AMS
```

Alternatively, download the repository and open its root folder in VS Code.

### 2. Configure Supabase

The client is initialized in [`js/supabaseClient.js`](./js/supabaseClient.js). Update the project URL and **publishable key** there if you are connecting a different Supabase project:

```js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = "https://YOUR_PROJECT_REF.supabase.co";
const supabasePublishableKey = "YOUR_SUPABASE_PUBLISHABLE_KEY";

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
```

The current repository already has a project URL and publishable key configured. A publishable key is intended for use in browser applications; **never put a Supabase service-role key or other secret in frontend code**. Protect application data with the supplied Row Level Security (RLS) policies.

In the Supabase dashboard, configure **Authentication → URL Configuration** with the local URL used by your web server. For example, if Live Server serves the site at `http://127.0.0.1:5500`, set that as a development Site URL and add it to the allowed redirect URLs. Use the actual port and host shown by your server.

### 3. Create the database schema

1. Open your Supabase project and go to **SQL Editor**.
2. Open [`sql/schema.sql`](./sql/schema.sql) from this repository and copy its full contents.
3. Paste the SQL into a new SQL Editor query and run it as a project owner.
4. Confirm the script completes successfully before using the application.

The schema script creates the application tables, relationships, indexes, profile bootstrap behavior, grants, and RLS policies. It is intended to be run in the Supabase SQL Editor; review it before applying it to an existing database.

For an existing database, run [`sql/migrations/preserve_student_attendance_history.sql`](./sql/migrations/preserve_student_attendance_history.sql) in the SQL Editor. Student removal now marks the record inactive and records its exit timestamp; the immutable student UUID keeps prior attendance linked and available to reports. Inactive records that predate this migration use their existing `updated_at` as the best available exit-date estimate.

### 4. Run the application

1. Open the repository root in VS Code.
2. Start Live Server from `index.html` (or `dashboard.html`).
3. Open the local URL provided by Live Server.
4. Create a teacher account using the sign-up page, then sign in.

Serve the project over HTTP rather than opening the HTML files directly with `file://`, because the app uses JavaScript ES modules and browser requests to Supabase.

## Database Schema

Run [`sql/schema.sql`](./sql/schema.sql) to set up the database. The primary tables are:

| Table | Purpose |
| --- | --- |
| `profiles` | Teacher profile preferences linked to Supabase Auth users. |
| `classes` | Classes owned by a teacher, including section, academic year, and status. |
| `subjects` | Subjects belonging to classes. |
| `students` | Students associated with a teacher and their current class; roll numbers are unique within a class. |
| `class_sessions` | Individual class/subject sessions, including date and start/end times. Multiple sessions can be recorded for a date. |
| `attendance_records` | Per-student attendance for a session, with a unique session/student pair and the supported attendance statuses. |

The schema also creates `class_schedules` and `holidays` for schedule and calendar data. Foreign keys preserve class/subject/student relationships and clean up related records according to the declared cascade behavior. RLS is enabled so authenticated teachers are limited to their own profiles and class-owned data.

## How to Use

1. **Set up classes and subjects:** Create a class with its section and academic year, then add its subjects.
2. **Add or import students:** Add students individually or import an Excel workbook from the Students page. `Name` and `Roll_Number` are required. Optional columns may be left blank. The class is selected in the application and applied to imported records.
3. **Mark daily attendance:** Create or select a class session, then mark each student Present, Absent, or Leave. Save the attendance register when finished.
4. **Set the attendance target:** Open Settings and choose the minimum required attendance percentage. The setting is stored in the browser for the signed-in teacher.
5. **Review reports:** Select a class and subject, and optionally set a date range. The summary shows student-wise attendance counts and highlights performance relative to the configured target. Use **View calendar** on a student row to inspect their daily attendance within the selected range.
6. **Export data:** Use the report's Excel export action to download a formatted `.xlsx` workbook containing report metadata, student attendance details, percentage formatting, and class averages.

## Project Structure

```text
.
├── assets/
│   ├── css/styles.css
│   └── js/app.js
├── js/
│   ├── attendance.js
│   ├── auth.js
│   ├── classes.js
│   ├── dashboard.js
│   ├── reports.js
│   ├── settings.js
│   ├── students.js
│   └── supabaseClient.js
├── sql/
│   └── schema.sql
├── attendance.html
├── classes.html
├── dashboard.html
├── index.html
├── reports.html
├── settings.html
└── students.html
```
