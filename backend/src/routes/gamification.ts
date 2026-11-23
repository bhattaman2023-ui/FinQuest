import { Router } from 'express';
import { query } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';

export const gamificationRouter = Router();

// ── GET /api/gamification/profile ────────────────────────────────
gamificationRouter.get('/profile', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;

    // XP and level
    type XpRow = { total_xp: number; level: number };
    const xpR = await query<XpRow>(`SELECT total_xp, level FROM user_xp WHERE user_id=$1`, [userId]);
    const xp  = xpR.rows[0] ?? { total_xp: 0, level: 1 };

    // Recalculate level (every 500 XP = 1 level)
    const computedLevel = Math.max(1, Math.floor(xp.total_xp / 500) + 1);
    if (computedLevel !== xp.level) {
      await query(`UPDATE user_xp SET level=$1 WHERE user_id=$2`, [computedLevel, userId]);
    }

    // Streak
    type StreakRow = { current_streak: number; longest_streak: number; last_activity_date: string | null };
    const streakR = await query<StreakRow>(
      `SELECT current_streak, longest_streak, last_activity_date FROM user_streaks WHERE user_id=$1`, [userId]
    );
    const streak = streakR.rows[0] ?? { current_streak: 0, longest_streak: 0, last_activity_date: null };

    // Badges
    type BadgeRow = { code: string; name: string; description: string; icon: string; awarded_at: string };
    const badgeR = await query<BadgeRow>(
      `SELECT b.code, b.name, b.description, b.icon, ub.awarded_at
       FROM user_badges ub JOIN badges b ON b.id=ub.badge_id WHERE ub.user_id=$1 ORDER BY ub.awarded_at DESC`,
      [userId]
    );

    // Challenges
    type ChallengeRow = { code: string; title: string; description: string; xp_reward: number; progress: number; completed: boolean };
    const challR = await query<ChallengeRow>(
      `SELECT ch.code, ch.title, ch.description, ch.xp_reward,
              COALESCE(uc.progress, 0) AS progress, COALESCE(uc.completed, false) AS completed
       FROM challenges ch
       LEFT JOIN user_challenges uc ON uc.challenge_id=ch.id AND uc.user_id=$1
       ORDER BY ch.sort_order`,
      [userId]
    );

    // Recent XP transactions
    type XpTxRow = { source_type: string; xp_amount: number; description: string; created_at: string };
    const xpTxR = await query<XpTxRow>(
      `SELECT source_type, xp_amount, description, created_at FROM xp_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [userId]
    );

    res.json({
      totalXp:       xp.total_xp,
      level:         computedLevel,
      xpToNextLevel: 500 - (xp.total_xp % 500),
      streak:        { current: streak.current_streak, longest: streak.longest_streak, lastActivity: streak.last_activity_date },
      badges:        badgeR.rows,
      challenges:    challR.rows,
      recentXp:      xpTxR.rows,
    });
  } catch (err) { next(err); }
});

// ── GET /api/gamification/leaderboard ────────────────────────────
gamificationRouter.get('/leaderboard', requireAuth, async (_req, res, next) => {
  try {
    type LeaderRow = { rank: string; display_name: string; avatar_initials: string; total_xp: number; level: number };
    const { rows } = await query<LeaderRow>(
      `SELECT
         ROW_NUMBER() OVER (ORDER BY ux.total_xp DESC)::TEXT AS rank,
         u.display_name, u.avatar_initials,
         ux.total_xp, ux.level
       FROM user_xp ux
       JOIN users u ON u.id=ux.user_id
       WHERE u.leaderboard_opt_in=true
       ORDER BY ux.total_xp DESC
       LIMIT 50`
    );
    res.json(rows.map(r => ({
      rank:          parseInt(r.rank, 10),
      displayName:   r.display_name,
      avatarInitials: r.avatar_initials,
      totalXp:       r.total_xp,
      level:         r.level,
    })));
  } catch (err) { next(err); }
});
