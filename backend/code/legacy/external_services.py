"""
Wrapper module for external services.
Imports from services/ folder inside code/.
"""

from code.services.email_service import (
    validate_email, send_credentials_email,
    send_schedule_email, send_custom_email
)

from code.services.timetable_service import (
    get_student_timetable,
    set_student_timetable, delete_student_timetable, check_exam_eligibility,
    bulk_set_student_timetable
)

from code.services.bulk_import_service import (
    parse_students_excel, parse_questions_excel,
    get_student_template, get_question_template
)

from code.services.live_tracking import (
    register_active_exam, update_exam_progress, update_exam_status,
    unregister_active_exam, get_active_exams, get_active_exam,
    cleanup_idle_exams
)

__all__ = [
    'validate_email',
    'send_credentials_email',
    'send_schedule_email',
    'send_custom_email',
    'get_student_timetable',
    'set_student_timetable',
    'delete_student_timetable',
    'check_exam_eligibility',
    'bulk_set_student_timetable',
    'parse_students_excel',
    'parse_questions_excel',
    'get_student_template',
    'get_question_template',
    'register_active_exam',
    'update_exam_progress',
    'update_exam_status',
    'unregister_active_exam',
    'get_active_exams',
    'get_active_exam',
    'cleanup_idle_exams',
]