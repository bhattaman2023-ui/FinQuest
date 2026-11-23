import { Router } from 'express';
import { query } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

export const coursesRouter = Router();

// ── GET /api/courses ─────────────────────────────────────────────
// List all published courses with progress for authenticated user
coursesRouter.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { rows } = await query<{
      id: string; slug: string; title: string; category: string;
      description: string; sort_order: number;
      total_lessons: string; completed_lessons: string;
    }>(
      `SELECT
         c.id, c.slug, c.title, c.category, c.description, c.sort_order,
         COUNT(DISTINCT l.id)::TEXT AS total_lessons,
         COUNT(DISTINCT CASE WHEN ulp.completed THEN l.id END)::TEXT AS completed_lessons
       FROM courses c
       LEFT JOIN lessons l ON l.course_id = c.id AND l.is_published = true
       LEFT JOIN user_lesson_progress ulp ON ulp.lesson_id = l.id AND ulp.user_id = $1
       WHERE c.is_published = true
       GROUP BY c.id
       ORDER BY c.sort_order`,
      [userId]
    );

    res.json(rows.map(r => ({
      id:               r.id,
      slug:             r.slug,
      title:            r.title,
      category:         r.category,
      description:      r.description,
      sortOrder:        r.sort_order,
      totalLessons:     parseInt(r.total_lessons, 10),
      completedLessons: parseInt(r.completed_lessons, 10),
      progress:         r.total_lessons === '0' ? 0
                          : Math.round(parseInt(r.completed_lessons, 10) / parseInt(r.total_lessons, 10) * 100),
    })));
  } catch (err) { next(err); }
});

// ── GET /api/courses/:slug ────────────────────────────────────────
coursesRouter.get('/:slug', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { slug } = req.params;

    type CourseRow = { id: string; slug: string; title: string; category: string; description: string };
    const cr = await query<CourseRow>(
      `SELECT id, slug, title, category, description FROM courses WHERE slug=$1 AND is_published=true`,
      [slug]
    );
    if (cr.rows.length === 0) throw createError('Course not found.', 404, 'NOT_FOUND');
    const course = cr.rows[0];

    type LessonRow = {
      id: string; slug: string; title: string; read_time_min: number;
      sort_order: number; completed: boolean | null;
    };
    const lr = await query<LessonRow>(
      `SELECT l.id, l.slug, l.title, l.read_time_min, l.sort_order,
              ulp.completed
       FROM lessons l
       LEFT JOIN user_lesson_progress ulp ON ulp.lesson_id = l.id AND ulp.user_id = $1
       WHERE l.course_id = $2 AND l.is_published = true
       ORDER BY l.sort_order`,
      [userId, course.id]
    );

    res.json({
      ...course,
      lessons: lr.rows.map(l => ({
        id:          l.id,
        slug:        l.slug,
        title:       l.title,
        readTimeMin: l.read_time_min,
        sortOrder:   l.sort_order,
        completed:   l.completed ?? false,
      })),
    });
  } catch (err) { next(err); }
});

// ── GET /api/courses/:courseSlug/:lessonSlug ──────────────────────
coursesRouter.get('/:courseSlug/:lessonSlug', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { courseSlug, lessonSlug } = req.params;

    type LessonRow = {
      id: string; slug: string; title: string; read_time_min: number;
      objectives: unknown[]; body_md: string; key_terms: unknown[];
      key_takeaways: unknown[]; diagram_type: string | null; sort_order: number;
      course_id: string; course_title: string; course_slug: string;
    };
    const lr = await query<LessonRow>(
      `SELECT l.id, l.slug, l.title, l.read_time_min, l.objectives, l.body_md,
              l.key_terms, l.key_takeaways, l.diagram_type, l.sort_order,
              c.id AS course_id, c.title AS course_title, c.slug AS course_slug
       FROM lessons l
       JOIN courses c ON c.id = l.course_id
       WHERE c.slug=$1 AND l.slug=$2 AND l.is_published=true AND c.is_published=true`,
      [courseSlug, lessonSlug]
    );
    if (lr.rows.length === 0) throw createError('Lesson not found.', 404, 'NOT_FOUND');
    const lesson = lr.rows[0];

    // Progress
    type ProgRow = { completed: boolean; completed_at: string | null };
    const pr = await query<ProgRow>(
      `SELECT completed, completed_at FROM user_lesson_progress WHERE user_id=$1 AND lesson_id=$2`,
      [userId, lesson.id]
    );
    const progress = pr.rows[0] ?? null;

    // Quiz
    type QuizRow = { id: string; pass_mark: number };
    const qr = await query<QuizRow>(`SELECT id, pass_mark FROM quizzes WHERE lesson_id=$1`, [lesson.id]);

    type QuestionRow = { id: string; question_text: string; options: string[]; explanation: string | null; sort_order: number };
    let questions: QuestionRow[] = [];
    if (qr.rows.length > 0) {
      const qs = await query<QuestionRow>(
        `SELECT id, question_text, options, explanation, sort_order FROM questions WHERE quiz_id=$1 ORDER BY sort_order`,
        [qr.rows[0].id]
      );
      questions = qs.rows;
    }

    // Best quiz score
    type AttemptRow = { score: number; passed: boolean; attempted_at: string };
    let bestAttempt: AttemptRow | null = null;
    if (qr.rows.length > 0) {
      const ar = await query<AttemptRow>(
        `SELECT score, passed, attempted_at FROM quiz_attempts WHERE user_id=$1 AND quiz_id=$2 ORDER BY score DESC LIMIT 1`,
        [userId, qr.rows[0].id]
      );
      bestAttempt = ar.rows[0] ?? null;
    }

    // Sibling lessons for prev/next navigation
    type SiblingRow = { id: string; slug: string; title: string; sort_order: number };
    const siblings = await query<SiblingRow>(
      `SELECT id, slug, title, sort_order FROM lessons WHERE course_id=$1 AND is_published=true ORDER BY sort_order`,
      [lesson.course_id]
    );
    const idx = siblings.rows.findIndex(s => s.id === lesson.id);
    const prevLesson = idx > 0 ? siblings.rows[idx - 1] : null;
    const nextLesson = idx < siblings.rows.length - 1 ? siblings.rows[idx + 1] : null;

    res.json({
      id:          lesson.id,
      slug:        lesson.slug,
      title:       lesson.title,
      readTimeMin: lesson.read_time_min,
      objectives:  lesson.objectives,
      bodyMd:      lesson.body_md,
      keyTerms:    lesson.key_terms,
      keyTakeaways:lesson.key_takeaways,
      diagramType: lesson.diagram_type,
      sortOrder:   lesson.sort_order,
      course: {
        id:    lesson.course_id,
        title: lesson.course_title,
        slug:  lesson.course_slug,
      },
      progress: progress ? { completed: progress.completed, completedAt: progress.completed_at } : null,
      quiz: qr.rows.length > 0 ? {
        id:         qr.rows[0].id,
        passMark:   qr.rows[0].pass_mark,
        questions:  questions.map(q => ({
          id:           q.id,
          questionText: q.question_text,
          options:      q.options,
          explanation:  q.explanation,
          sortOrder:    q.sort_order,
        })),
        bestAttempt,
      } : null,
      navigation: { prev: prevLesson, next: nextLesson },
    });
  } catch (err) { next(err); }
});

// ── POST /api/courses/:courseSlug/:lessonSlug/complete ───────────
coursesRouter.post('/:courseSlug/:lessonSlug/complete', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { courseSlug, lessonSlug } = req.params;

    // Get lesson ID
    type LessonRow = { id: string };
    const lr = await query<LessonRow>(
      `SELECT l.id FROM lessons l JOIN courses c ON c.id=l.course_id WHERE c.slug=$1 AND l.slug=$2`,
      [courseSlug, lessonSlug]
    );
    if (lr.rows.length === 0) throw createError('Lesson not found.', 404, 'NOT_FOUND');
    const lessonId = lr.rows[0].id;

    await query(
      `INSERT INTO user_lesson_progress (user_id, lesson_id, completed, completed_at)
       VALUES ($1, $2, true, NOW())
       ON CONFLICT (user_id, lesson_id) DO UPDATE SET completed=true, completed_at=COALESCE(user_lesson_progress.completed_at, NOW())`,
      [userId, lessonId]
    );

    // Award XP (idempotent)
    const xpAmount = parseInt(process.env.XP_LESSON_COMPLETE || '50', 10);
    await query(
      `INSERT INTO xp_transactions (user_id, source_type, source_id, xp_amount, description)
       VALUES ($1, 'LESSON_COMPLETE', $2, $3, 'Completed lesson')
       ON CONFLICT (user_id, source_type, source_id) DO NOTHING`,
      [userId, lessonId, xpAmount]
    );
    // Update total XP
    await query(
      `INSERT INTO user_xp (user_id, total_xp) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         total_xp = user_xp.total_xp + CASE WHEN (SELECT COUNT(*) FROM xp_transactions WHERE user_id=$1 AND source_type='LESSON_COMPLETE' AND source_id=$3) = 1 THEN $2 ELSE 0 END,
         updated_at = NOW()`,
      [userId, xpAmount, lessonId]
    );

    // Update streak (IST-based: today's date)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    await query(
      `INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_activity_date)
       VALUES ($1, 1, 1, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         current_streak = CASE
           WHEN user_streaks.last_activity_date = ($2::DATE - INTERVAL '1 day')::DATE THEN user_streaks.current_streak + 1
           WHEN user_streaks.last_activity_date = $2::DATE THEN user_streaks.current_streak
           ELSE 1
         END,
         longest_streak = GREATEST(user_streaks.longest_streak,
           CASE
             WHEN user_streaks.last_activity_date = ($2::DATE - INTERVAL '1 day')::DATE THEN user_streaks.current_streak + 1
             WHEN user_streaks.last_activity_date = $2::DATE THEN user_streaks.current_streak
             ELSE 1
           END),
         last_activity_date = $2::DATE,
         updated_at = NOW()`,
      [userId, today]
    );

    res.json({ success: true, xpAwarded: xpAmount });
  } catch (err) { next(err); }
});

// ── POST /api/courses/:courseSlug/:lessonSlug/quiz ───────────────
coursesRouter.post('/:courseSlug/:lessonSlug/quiz', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { courseSlug, lessonSlug } = req.params;
    const { answers } = req.body; // Array of selected option indices

    if (!Array.isArray(answers)) throw createError('answers must be an array.', 400, 'VALIDATION_ERROR');

    // Get quiz
    type QuizRow = { id: string; pass_mark: number };
    type AnswerRow = { correct_index: number };
    const qr = await query<QuizRow>(
      `SELECT q.id, q.pass_mark FROM quizzes q
       JOIN lessons l ON l.id = q.lesson_id
       JOIN courses c ON c.id = l.course_id
       WHERE c.slug=$1 AND l.slug=$2`,
      [courseSlug, lessonSlug]
    );
    if (qr.rows.length === 0) throw createError('Quiz not found.', 404, 'NOT_FOUND');
    const quiz = qr.rows[0];

    const qs = await query<AnswerRow>(
      `SELECT correct_index FROM questions WHERE quiz_id=$1 ORDER BY sort_order`,
      [quiz.id]
    );
    const questions = qs.rows;

    if (answers.length !== questions.length) {
      throw createError(`Expected ${questions.length} answers.`, 400, 'VALIDATION_ERROR');
    }

    // Grade
    let correct = 0;
    questions.forEach((q, i) => { if (answers[i] === q.correct_index) correct++; });
    const score = Math.round((correct / questions.length) * 100);
    const passed = score >= quiz.pass_mark;

    // Record attempt
    await query(
      `INSERT INTO quiz_attempts (user_id, quiz_id, score, passed, answers) VALUES ($1,$2,$3,$4,$5)`,
      [userId, quiz.id, score, passed, JSON.stringify(answers)]
    );

    // Award XP if passed (idempotent — only first pass)
    if (passed) {
      const xpAmount = parseInt(process.env.XP_QUIZ_PASS || '30', 10);
      await query(
        `INSERT INTO xp_transactions (user_id, source_type, source_id, xp_amount, description)
         VALUES ($1, 'QUIZ_PASS', $2, $3, 'Passed quiz')
         ON CONFLICT (user_id, source_type, source_id) DO NOTHING`,
        [userId, quiz.id, xpAmount]
      );
      await query(
        `UPDATE user_xp SET total_xp = total_xp + CASE WHEN (SELECT COUNT(*) FROM xp_transactions WHERE user_id=$1 AND source_type='QUIZ_PASS' AND source_id=$3) = 1 THEN $2 ELSE 0 END, updated_at=NOW() WHERE user_id=$1`,
        [userId, xpAmount, quiz.id]
      );
    }

    res.json({ score, passed, correct, total: questions.length, passMark: quiz.pass_mark });
  } catch (err) { next(err); }
});

// ── GET /api/courses/glossary/all ────────────────────────────────
coursesRouter.get('/glossary/all', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { q, category } = req.query;
    let sql = `SELECT id, term, definition, category, example FROM glossary_terms WHERE 1=1`;
    const params: unknown[] = [];
    if (q) { params.push(`%${q}%`); sql += ` AND (LOWER(term) LIKE LOWER($${params.length}) OR LOWER(definition) LIKE LOWER($${params.length}))`; }
    if (category) { params.push(category); sql += ` AND category = $${params.length}`; }
    sql += ` ORDER BY term`;
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/courses/certificate/status ──────────────────────────
coursesRouter.get('/certificate/status', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;

    // Count total required lessons and completed ones
    type CountRow = { total: string; completed: string };
    const cr = await query<CountRow>(
      `SELECT
         COUNT(DISTINCT l.id)::TEXT AS total,
         COUNT(DISTINCT CASE WHEN ulp.completed THEN l.id END)::TEXT AS completed
       FROM lessons l
       JOIN courses c ON c.id = l.course_id
       LEFT JOIN user_lesson_progress ulp ON ulp.lesson_id = l.id AND ulp.user_id = $1
       WHERE l.is_published = true AND c.is_published = true`,
      [userId]
    );
    const { total, completed } = cr.rows[0];

    // Check all quizzes passed
    type QuizCountRow = { total_quizzes: string; passed_quizzes: string };
    const qc = await query<QuizCountRow>(
      `SELECT
         COUNT(DISTINCT q.id)::TEXT AS total_quizzes,
         COUNT(DISTINCT CASE WHEN qa.passed THEN q.id END)::TEXT AS passed_quizzes
       FROM quizzes q
       JOIN lessons l ON l.id = q.lesson_id
       LEFT JOIN (
         SELECT DISTINCT ON (user_id, quiz_id) user_id, quiz_id, passed
         FROM quiz_attempts WHERE user_id=$1
         ORDER BY user_id, quiz_id, score DESC
       ) qa ON qa.quiz_id = q.id
       WHERE l.is_published = true`,
      [userId]
    );
    const { total_quizzes, passed_quizzes } = qc.rows[0];

    const lessonsComplete = parseInt(total, 10) > 0 && parseInt(completed, 10) === parseInt(total, 10);
    const quizzesComplete = parseInt(total_quizzes, 10) === 0 || parseInt(passed_quizzes, 10) === parseInt(total_quizzes, 10);
    const eligible = lessonsComplete && quizzesComplete;

    // Check existing certificate
    type CertRow = { id: string; verification_id: string; issued_at: string };
    const certR = await query<CertRow>(
      `SELECT id, verification_id, issued_at FROM certificates WHERE user_id=$1 ORDER BY issued_at DESC LIMIT 1`,
      [userId]
    );

    res.json({
      eligible,
      totalLessons:   parseInt(total, 10),
      completedLessons: parseInt(completed, 10),
      totalQuizzes:   parseInt(total_quizzes, 10),
      passedQuizzes:  parseInt(passed_quizzes, 10),
      certificate:    certR.rows[0] ?? null,
    });
  } catch (err) { next(err); }
});

// ── POST /api/courses/certificate/issue ──────────────────────────
coursesRouter.post('/certificate/issue', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;

    // Verify eligibility (re-check server side)
    type CountRow = { total: string; completed: string };
    const cr = await query<CountRow>(
      `SELECT COUNT(DISTINCT l.id)::TEXT AS total, COUNT(DISTINCT CASE WHEN ulp.completed THEN l.id END)::TEXT AS completed
       FROM lessons l JOIN courses c ON c.id=l.course_id LEFT JOIN user_lesson_progress ulp ON ulp.lesson_id=l.id AND ulp.user_id=$1
       WHERE l.is_published=true AND c.is_published=true`,
      [userId]
    );
    const { total, completed } = cr.rows[0];
    if (parseInt(total, 10) === 0 || parseInt(completed, 10) < parseInt(total, 10)) {
      throw createError('Complete all lessons before issuing a certificate.', 403, 'NOT_ELIGIBLE');
    }

    // Issue (idempotent)
    type CertRow = { id: string; verification_id: string; issued_at: string };
    const r = await query<CertRow>(
      `INSERT INTO certificates (user_id) VALUES ($1)
       ON CONFLICT DO NOTHING RETURNING id, verification_id, issued_at`,
      [userId]
    );

    if (r.rows.length === 0) {
      // Already issued
      const existing = await query<CertRow>(`SELECT id, verification_id, issued_at FROM certificates WHERE user_id=$1`, [userId]);
      return res.json(existing.rows[0]);
    }

    res.status(201).json(r.rows[0]);
  } catch (err) { next(err); }
});
