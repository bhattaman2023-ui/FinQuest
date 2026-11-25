import fs from 'fs';
import os from 'os';
import path from 'path';

const testDbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'finquest-certificate-test-'));
process.env.DB_DRIVER = 'pglite';
process.env.PGLITE_DATA_DIR = testDbPath;

const request = require('supertest') as typeof import('supertest');
const { pool, query } = require('../db/pool') as typeof import('../db/pool');
const { default: app } = require('../index') as typeof import('../index');
const { signToken } = require('../middleware/auth') as typeof import('../middleware/auth');

describe('course certificate issuance', () => {
  let token: string;
  let userId: string;
  let quizId: string;

  beforeAll(async () => {
    await pool.query(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8'));

    const user = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3) RETURNING id`,
      ['certificate-test@example.test', 'unused', 'Certificate Test']
    );
    userId = user.rows[0].id;

    const course = await query<{ id: string }>(
      `INSERT INTO courses (slug, title, category, description)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      ['certificate-test', 'Certificate Test', 'test', 'test']
    );
    const lesson = await query<{ id: string }>(
      `INSERT INTO lessons (course_id, slug, title)
       VALUES ($1, $2, $3) RETURNING id`,
      [course.rows[0].id, 'quiz-lesson', 'Quiz Lesson']
    );
    const quiz = await query<{ id: string }>(
      'INSERT INTO quizzes (lesson_id) VALUES ($1) RETURNING id',
      [lesson.rows[0].id]
    );
    quizId = quiz.rows[0].id;

    await query(
      `INSERT INTO user_lesson_progress (user_id, lesson_id, completed)
       VALUES ($1, $2, true)`,
      [userId, lesson.rows[0].id]
    );

    token = signToken({
      sub: userId,
      email: 'certificate-test@example.test',
      displayName: 'Certificate Test',
      role: 'user',
    });
  });

  afterAll(async () => {
    await pool.end();
    fs.rmSync(testDbPath, { recursive: true, force: true });
  });

  it('requires passed quizzes and creates only one certificate for concurrent requests', async () => {
    await query(
      `INSERT INTO quiz_attempts (user_id, quiz_id, score, passed, answers)
       VALUES ($1, $2, 40, false, '[]')`,
      [userId, quizId]
    );

    const ineligibleStatus = await request(app)
      .get('/api/courses/certificate/status')
      .set('Authorization', `Bearer ${token}`);
    const blockedIssue = await request(app)
      .post('/api/courses/certificate/issue')
      .set('Authorization', `Bearer ${token}`);

    expect(ineligibleStatus.status).toBe(200);
    expect(ineligibleStatus.body.eligible).toBe(false);
    expect(blockedIssue.status).toBe(403);

    await query(
      `INSERT INTO quiz_attempts (user_id, quiz_id, score, passed, answers)
       VALUES ($1, $2, 90, true, '[]')`,
      [userId, quizId]
    );

    const eligibleStatus = await request(app)
      .get('/api/courses/certificate/status')
      .set('Authorization', `Bearer ${token}`);
    const issueResponses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .post('/api/courses/certificate/issue')
          .set('Authorization', `Bearer ${token}`)
      )
    );
    const certificates = await query<{ count: number }>(
      'SELECT COUNT(*)::INT AS count FROM certificates WHERE user_id = $1',
      [userId]
    );

    expect(eligibleStatus.body.eligible).toBe(true);
    expect(issueResponses.filter(response => response.status === 201)).toHaveLength(1);
    expect(issueResponses.filter(response => response.status === 200)).toHaveLength(3);
    expect(new Set(issueResponses.map(response => response.body.id)).size).toBe(1);
    expect(certificates.rows[0].count).toBe(1);
  });
});
