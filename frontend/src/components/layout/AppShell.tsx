import { Outlet, Navigate } from 'react-router-dom';
import Header from './Header';
import TickerStrip from './TickerStrip';
import Footer from './Footer';
import useAuthStore from '@/store/authStore';
import styles from './AppShell.module.css';

export default function AppShell() {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className={styles.shell}>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <Header />
      <TickerStrip />
      <main id="main-content" className={styles.main}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
