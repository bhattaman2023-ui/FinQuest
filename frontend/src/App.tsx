import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppShell from '@/components/layout/AppShell';
import PageSpinner from '@/components/ui/PageSpinner';
import useThemeStore from '@/store/themeStore';

// Lazy-loaded routes
const LandingPage       = lazy(() => import('@/pages/Landing/LandingPage'));
const HomePage          = lazy(() => import('@/pages/Home/HomePage'));
const LearnPage         = lazy(() => import('@/pages/Learn/LearnPage'));
const LessonPage        = lazy(() => import('@/pages/Learn/LessonPage'));
const GlossaryPage      = lazy(() => import('@/pages/Learn/GlossaryPage'));
const SimulatorPage     = lazy(() => import('@/pages/Simulator/SimulatorPage'));
const PortfolioPage     = lazy(() => import('@/pages/Portfolio/PortfolioPage'));
const GamificationPage  = lazy(() => import('@/pages/Gamification/GamificationPage'));
const InsightsPage      = lazy(() => import('@/pages/Insights/InsightsPage'));
const MentorPage        = lazy(() => import('@/pages/Mentor/MentorPage'));
const LoginPage         = lazy(() => import('@/pages/Auth/LoginPage'));
const RegisterPage      = lazy(() => import('@/pages/Auth/RegisterPage'));
const NotFoundPage      = lazy(() => import('@/pages/NotFoundPage'));

export default function App() {
  const { i18n } = useTranslation();
  const { theme } = useThemeStore();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('lang', i18n.language);
  }, [i18n.language]);

  return (
    <Suspense fallback={<PageSpinner />}>
      <Routes>
        {/* Public landing — no shell */}
        <Route path="/" element={<LandingPage />} />

        {/* Auth pages — no shell */}
        <Route path="/login"    element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* App shell wraps all authenticated routes */}
        <Route element={<AppShell />}>
          <Route path="/dashboard"    element={<HomePage />} />
          <Route path="/learn"        element={<LearnPage />} />
          <Route path="/learn/glossary" element={<GlossaryPage />} />
          <Route path="/learn/:courseSlug/:lessonSlug" element={<LessonPage />} />
          <Route path="/simulator"    element={<SimulatorPage />} />
          <Route path="/portfolio"    element={<PortfolioPage />} />
          <Route path="/gamification" element={<GamificationPage />} />
          <Route path="/insights"     element={<InsightsPage />} />
          <Route path="/mentor"       element={<MentorPage />} />
        </Route>

        {/* Fallbacks */}
        <Route path="/app" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
