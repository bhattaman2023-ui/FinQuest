import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { CheckCircle, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import api from '@/api/client';
import { PageSpinner } from '@/components/ui/PageSpinner';
import { ErrorState } from '@/components/ui/States';

type Lesson = {
  id: string; slug: string; title: string; readTimeMin: number;
  objectives: string[]; bodyMd: string;
  keyTerms: Array<{ term: string; def: string }>;
  keyTakeaways: string[];
  course: { id: string; title: string; slug: string };
  progress: { completed: boolean; completedAt: string | null } | null;
  quiz: {
    id: string; passMark: number;
    questions: Array<{ id: string; questionText: string; options: string[]; explanation: string | null; sortOrder: number }>;
    bestAttempt: { score: number; passed: boolean; attempted_at: string } | null;
  } | null;
  navigation: {
    prev: { slug: string; title: string } | null;
    next: { slug: string; title: string } | null;
  };
};

// Minimal markdown renderer — renders headings, bold, italic, tables, code, blockquote
function renderMd(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

export default function LessonPage() {
  const { courseSlug, lessonSlug } = useParams<{ courseSlug: string; lessonSlug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: lesson, isLoading, isError, refetch } = useQuery<Lesson>({
    queryKey: ['lesson', courseSlug, lessonSlug],
    queryFn: () => api.get(`/courses/${courseSlug}/${lessonSlug}`).then(r => r.data),
  });

  const completeMutation = useMutation({
    mutationFn: () => api.post(`/courses/${courseSlug}/${lessonSlug}/complete`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lesson', courseSlug, lessonSlug] }); qc.invalidateQueries({ queryKey: ['courses'] }); },
  });

  if (isLoading) return <PageSpinner />;
  if (isError || !lesson) return <ErrorState message="Lesson not found." onRetry={refetch} />;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'var(--sidebar-width) 1fr', minHeight: '100%', maxWidth: 'var(--content-max)', margin: '0 auto' }}>
      {/* Sidebar */}
      <aside style={{ borderRight: '1px solid var(--color-hairline)', padding: 'var(--space-6)', position: 'sticky', top: 'calc(var(--header-height) + var(--ticker-height))', height: 'fit-content' }}>
        <Link to={`/learn/${courseSlug}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--color-muted)', textDecoration: 'none', marginBottom: 'var(--space-5)' }}>
          <ChevronLeft size={14} /> Back to course
        </Link>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 'var(--space-2)' }}>
          {lesson.course.title}
        </div>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-ink)', marginBottom: 'var(--space-6)' }}>
          {lesson.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
          <Clock size={12} /> {lesson.readTimeMin} min read
        </div>
        {lesson.progress?.completed && (
          <div style={{ marginTop: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-gain)', fontWeight: 600 }}>
            <CheckCircle size={14} /> Completed
          </div>
        )}
      </aside>

      {/* Content */}
      <main style={{ padding: 'var(--space-10) var(--space-8)', maxWidth: 'calc(var(--lesson-measure) + 4rem)' }}>
        {/* Objectives */}
        {lesson.objectives.length > 0 && (
          <div style={{ background: 'var(--color-sage)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)', marginBottom: 'var(--space-8)' }}>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 'var(--space-3)' }}>Learning Objectives</div>
            <ul style={{ paddingLeft: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {lesson.objectives.map((o, i) => <li key={i} style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink)' }}>{o}</li>)}
            </ul>
          </div>
        )}

        {/* Title */}
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-3xl)', fontWeight: 500, color: 'var(--color-ink)', marginBottom: 'var(--space-8)', lineHeight: 'var(--leading-tight)' }}>{lesson.title}</h1>

        {/* Body */}
        <div
          className="lesson-body"
          dangerouslySetInnerHTML={{ __html: renderMd(lesson.bodyMd) }}
          style={{ fontSize: 'var(--text-md)', lineHeight: 'var(--leading-loose)', color: 'var(--color-ink)', maxWidth: 'var(--lesson-measure)' }}
        />

        {/* Key terms */}
        {lesson.keyTerms.length > 0 && (
          <div style={{ marginTop: 'var(--space-10)', borderTop: '1px solid var(--color-hairline)', paddingTop: 'var(--space-8)' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 500, marginBottom: 'var(--space-5)' }}>Key Terms</h3>
            <dl style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {lesson.keyTerms.map((kt: { term: string; def: string }) => (
                <div key={kt.term}>
                  <dt style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-ink)', marginBottom: 'var(--space-1)' }}>{kt.term}</dt>
                  <dd style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', lineHeight: 'var(--leading-normal)' }}>{kt.def}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Key takeaways */}
        {lesson.keyTakeaways.length > 0 && (
          <div style={{ marginTop: 'var(--space-8)', background: 'var(--color-sage)', border: '1px solid var(--color-hairline)', borderLeft: '3px solid var(--color-accent)', borderRadius: '0 var(--radius-md) var(--radius-md) 0', padding: 'var(--space-5)' }}>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 'var(--space-3)' }}>Key Takeaways</div>
            <ul style={{ paddingLeft: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {lesson.keyTakeaways.map((t, i) => <li key={i} style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink)' }}>{t}</li>)}
            </ul>
          </div>
        )}

        {/* Quiz section */}
        {lesson.quiz && <QuizSection lesson={lesson} courseSlug={courseSlug!} lessonSlug={lessonSlug!} />}

        {/* Mark complete + navigation */}
        <div style={{ marginTop: 'var(--space-10)', paddingTop: 'var(--space-8)', borderTop: '1px solid var(--color-hairline)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {lesson.navigation.prev ? (
            <Link to={`/learn/${courseSlug}/${lesson.navigation.prev.slug}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--color-muted)', textDecoration: 'none' }}>
              <ChevronLeft size={14} /> {lesson.navigation.prev.title}
            </Link>
          ) : <div />}

          {!lesson.progress?.completed && (
            <button
              onClick={() => completeMutation.mutate()}
              disabled={completeMutation.isPending}
              style={{ padding: 'var(--space-3) var(--space-6)', background: 'var(--color-gain)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer' }}
            >
              {completeMutation.isPending ? 'Saving…' : '✓ Mark as Completed'}
            </button>
          )}

          {lesson.navigation.next ? (
            <Link to={`/learn/${courseSlug}/${lesson.navigation.next.slug}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--color-accent)', fontWeight: 600, textDecoration: 'none' }}>
              {lesson.navigation.next.title} <ChevronRight size={14} />
            </Link>
          ) : <div />}
        </div>
      </main>
    </div>
  );
}

function QuizSection({ lesson, courseSlug, lessonSlug }: { lesson: Lesson; courseSlug: string; lessonSlug: string }) {
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<{ score: number; passed: boolean; correct: number; total: number } | null>(null);

  const quizMutation = useMutation({
    mutationFn: (ans: number[]) => api.post(`/courses/${courseSlug}/${lessonSlug}/quiz`, { answers: ans }).then(r => r.data),
    onSuccess: (data) => { setResult(data); setSubmitted(true); qc.invalidateQueries({ queryKey: ['lesson', courseSlug, lessonSlug] }); },
  });

  const quiz = lesson.quiz!;
  const allAnswered = quiz.questions.every((_, i) => answers[i] !== undefined);

  if (lesson.quiz?.bestAttempt?.passed && !submitted) {
    return (
      <div style={{ marginTop: 'var(--space-10)', padding: 'var(--space-5)', background: 'rgba(47,125,91,0.08)', border: '1px solid rgba(47,125,91,0.2)', borderRadius: 'var(--radius-md)' }}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-gain)', fontWeight: 600 }}>✓ Quiz passed — Score: {lesson.quiz.bestAttempt.score}%</div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 'var(--space-10)', borderTop: '1px solid var(--color-hairline)', paddingTop: 'var(--space-8)' }}>
      <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--text-xl)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>Quiz</h3>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-6)' }}>Pass mark: {quiz.passMark}%</p>

      {result ? (
        <div style={{ padding: 'var(--space-6)', background: result.passed ? 'rgba(47,125,91,0.08)' : 'rgba(180,68,60,0.08)', border: `1px solid ${result.passed ? 'rgba(47,125,91,0.2)' : 'rgba(180,68,60,0.2)'}`, borderRadius: 'var(--radius-md)' }}>
          <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: result.passed ? 'var(--color-gain)' : 'var(--color-loss)', marginBottom: 'var(--space-2)' }}>
            {result.passed ? '✓ Passed!' : '✗ Not quite'}
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>Score: {result.score}% ({result.correct}/{result.total} correct)</div>
          {!result.passed && (
            <button onClick={() => { setSubmitted(false); setAnswers({}); setResult(null); }}
              style={{ marginTop: 'var(--space-4)', padding: 'var(--space-2) var(--space-4)', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', cursor: 'pointer', background: 'transparent' }}>
              Try Again
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {quiz.questions.map((q, qi) => (
            <div key={q.id}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-ink)', marginBottom: 'var(--space-3)' }}>{qi + 1}. {q.questionText}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {q.options.map((opt: string, oi: number) => (
                  <button key={oi} onClick={() => setAnswers(a => ({ ...a, [qi]: oi }))}
                    style={{ padding: 'var(--space-3) var(--space-4)', border: `1px solid ${answers[qi] === oi ? 'var(--color-ink)' : 'var(--color-hairline)'}`, borderRadius: 'var(--radius-md)', textAlign: 'left', fontSize: 'var(--text-sm)', cursor: 'pointer', background: answers[qi] === oi ? 'var(--color-ink)' : 'transparent', color: answers[qi] === oi ? '#fff' : 'var(--color-ink)', transition: 'all var(--transition-fast)' }}>
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button
            disabled={!allAnswered || quizMutation.isPending}
            onClick={() => quizMutation.mutate(quiz.questions.map((_, i) => answers[i]))}
            style={{ padding: 'var(--space-3) var(--space-6)', background: allAnswered ? 'var(--color-ink)' : 'var(--color-hairline)', color: allAnswered ? '#fff' : 'var(--color-muted)', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', fontWeight: 600, cursor: allAnswered ? 'pointer' : 'not-allowed' }}>
            {quizMutation.isPending ? 'Submitting…' : 'Submit Quiz'}
          </button>
        </div>
      )}
    </div>
  );
}
