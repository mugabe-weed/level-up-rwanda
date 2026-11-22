import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AgeGroup, SupportedLanguage, UserRole } from '../../shared/schemas.ts';
import { appConfig } from '../config.ts';
import type { AuthenticatedUser } from '../middleware/auth.ts';
import {
  generateSecureToken,
  generateVerificationCode,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from '../utils/crypto.ts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../utils/errors.ts';

export function calculateLevelFromXpLocal(totalXp: number): number {
  const safeXp = Math.max(0, totalXp);
  return Math.floor(Math.sqrt(safeXp / 100)) + 1;
}

interface LocalUser {
  id: number;
  email: string | null;
  phone: string | null;
  password_hash: string;
  role: UserRole;
  status: 'active' | 'suspended' | 'pending_verification';
  age_group: AgeGroup;
  preferred_language: SupportedLanguage;
  contact_verified: number;
  contact_verification_token_hash: string | null;
  contact_verification_expires_at: string | null;
  password_reset_token_hash: string | null;
  password_reset_expires_at: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
}

interface LocalUserProfile {
  user_id: number;
  display_name: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  district: string | null;
  interests_json: string[];
  skills_json: string[];
  profile_visibility: 'public' | 'community' | 'private';
  show_activity: number;
  total_xp: number;
  current_level: number;
  current_streak: number;
  longest_streak: number;
  last_challenge_date: string | null;
}

interface LocalSession {
  id: number;
  user_id: number;
  token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

interface LocalChallengeCategory {
  id: number;
  slug: string;
  name_en: string;
  name_rw: string;
  name_fr: string;
  description_en: string;
  description_rw: string;
  description_fr: string;
  is_active: number;
  sort_order: number;
}

interface LocalChallenge {
  id: number;
  category_id: number;
  slug: string;
  title_en: string;
  title_rw: string;
  title_fr: string;
  description_en: string;
  description_rw: string;
  description_fr: string;
  difficulty: string;
  challenge_type: string;
  time_limit_seconds: number;
  xp_reward: number;
  active_date: string | null;
  is_featured: number;
  is_sample: number;
  status: 'draft' | 'published' | 'archived';
  created_by: number | null;
  created_at: string;
}

interface LocalChallengeQuestion {
  id: number;
  challenge_id: number;
  prompt_en: string;
  prompt_rw: string;
  prompt_fr: string;
  options_json: string[];
  correct_option_index: number;
  explanation_en: string;
  explanation_rw: string;
  explanation_fr: string;
  points_weight: number;
  sort_order: number;
}

interface LocalChallengeSubmission {
  id: number;
  challenge_id: number;
  user_id: number;
  answers_json: Array<{ questionId: number; selectedOptionIndex: number }>;
  score: number;
  max_score: number;
  correct_count: number;
  total_questions: number;
  duration_seconds: number;
  xp_awarded: number;
  submitted_at: string;
}

interface LocalCourseCategory {
  id: number;
  slug: string;
  name_en: string;
  name_rw: string;
  name_fr: string;
  description_en: string;
  description_rw: string;
  description_fr: string;
  is_active: number;
  sort_order: number;
}

interface LocalCourse {
  id: number;
  category_id: number;
  slug: string;
  title_en: string;
  title_rw: string;
  title_fr: string;
  summary_en: string;
  summary_rw: string;
  summary_fr: string;
  level: string;
  estimated_minutes: number;
  xp_reward: number;
  status: 'draft' | 'published' | 'archived';
  is_sample: number;
  created_by: number | null;
  created_at: string;
}

interface LocalCourseModule {
  id: number;
  course_id: number;
  title_en: string;
  title_rw: string;
  title_fr: string;
  sort_order: number;
}

interface LocalCourseLesson {
  id: number;
  module_id: number;
  course_id: number;
  title_en: string;
  title_rw: string;
  title_fr: string;
  content_en: string;
  content_rw: string;
  content_fr: string;
  duration_minutes: number;
  xp_reward: number;
  assessment_question_json: {
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  } | null;
  sort_order: number;
}

interface LocalCourseEnrollment {
  id: number;
  course_id: number;
  user_id: number;
  status: 'enrolled' | 'completed';
  progress_percent: number;
  enrolled_at: string;
  completed_at: string | null;
}

interface LocalLessonProgress {
  id: number;
  enrollment_id: number;
  lesson_id: number;
  user_id: number;
  completed: number;
  assessment_passed: number;
  assessment_score: number;
}

interface LocalCommunityGroup {
  id: number;
  slug: string;
  name: string;
  description: string;
  category: string;
  created_by: number | null;
  is_private: number;
  member_count: number;
  is_sample: number;
  status: 'active' | 'archived';
  created_at: string;
}

interface LocalGroupMembership {
  id: number;
  group_id: number;
  user_id: number;
  role: 'member' | 'moderator';
  created_at: string;
}

interface LocalCreativePost {
  id: number;
  user_id: number;
  group_id: number | null;
  post_type: 'create_showcase' | 'discussion';
  category: string;
  title: string;
  body: string;
  media_url: string | null;
  media_mime: string | null;
  likes_count: number;
  comments_count: number;
  moderation_status: 'approved' | 'hidden' | 'removed';
  is_sample: number;
  created_at: string;
}

interface LocalPostReaction {
  id: number;
  post_id: number;
  user_id: number;
  reaction_type: 'like' | 'celebrate' | 'helpful';
  created_at: string;
}

interface LocalPostComment {
  id: number;
  post_id: number;
  user_id: number;
  body: string;
  moderation_status: 'visible' | 'hidden' | 'removed';
  created_at: string;
}

interface LocalUserFollow {
  id: number;
  follower_id: number;
  following_id: number;
  created_at: string;
}

interface LocalUserBlock {
  id: number;
  blocker_id: number;
  blocked_id: number;
  reason: string | null;
  created_at: string;
}

interface LocalContentReport {
  id: number;
  reporter_id: number;
  target_type: 'post' | 'comment' | 'user' | 'opportunity';
  target_id: number;
  reason: string;
  details: string | null;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  reviewed_by: number | null;
  resolution_note: string | null;
  created_at: string;
}

interface LocalOpportunityCategory {
  id: number;
  slug: string;
  name_en: string;
  name_rw: string;
  name_fr: string;
  sort_order: number;
}

interface LocalOpportunity {
  id: number;
  category_id: number;
  opportunity_type: string;
  title: string;
  organization_name: string;
  location: string;
  is_remote: number;
  summary: string;
  eligibility: string;
  application_url: string;
  deadline_at: string | null;
  approval_status: 'pending' | 'approved' | 'rejected' | 'expired';
  verified_status: 'unverified' | 'verified';
  is_featured: number;
  is_sample: number;
  submitted_by: number | null;
  approved_by: number | null;
  created_at: string;
}

interface LocalSavedOpportunity {
  id: number;
  opportunity_id: number;
  user_id: number;
  created_at: string;
}

interface LocalOrganization {
  id: number;
  name: string;
  slug: string;
  org_type: string;
  website_url: string | null;
  verified: number;
  description: string | null;
  created_by: number | null;
  created_at: string;
}

interface LocalAchievement {
  id: number;
  slug: string;
  title_en: string;
  title_rw: string;
  title_fr: string;
  description_en: string;
  description_rw: string;
  description_fr: string;
  icon_name: string;
  badge_tier: string;
  xp_bonus: number;
  rule_type: string;
  rule_threshold: number;
  is_active: number;
}

interface LocalUserAchievement {
  id: number;
  user_id: number;
  achievement_id: number;
  unlocked_at: string;
}

interface LocalXpTransaction {
  id: number;
  user_id: number;
  source_type: string;
  source_id: number;
  idempotency_key: string;
  points: number;
  description: string;
  created_at: string;
}

interface LocalNotification {
  id: number;
  user_id: number;
  type: string;
  title_text: string;
  body_text: string;
  link_url: string | null;
  is_read: number;
  read_at: string | null;
  created_at: string;
}

interface LocalNotificationPreferences {
  user_id: number;
  challenge_reminders: number;
  learning_updates: number;
  community_activity: number;
  opportunity_alerts: number;
  announcements: number;
}

interface LocalAnnouncement {
  id: number;
  title_en: string;
  title_rw: string;
  title_fr: string;
  body_en: string;
  body_rw: string;
  body_fr: string;
  audience: string;
  is_active: number;
  starts_at: string | null;
  ends_at: string | null;
  created_by: number | null;
  created_at: string;
}

interface LocalPlatformSetting {
  setting_key: string;
  setting_value_json: unknown;
  description: string | null;
  updated_by: number | null;
}

interface LocalAuditLog {
  id: number;
  actor_user_id: number | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata_json: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

interface LocalDatabaseState {
  version: number;
  nextIds: Record<string, number>;
  users: LocalUser[];
  user_profiles: LocalUserProfile[];
  user_sessions: LocalSession[];
  challenge_categories: LocalChallengeCategory[];
  challenges: LocalChallenge[];
  challenge_questions: LocalChallengeQuestion[];
  challenge_submissions: LocalChallengeSubmission[];
  course_categories: LocalCourseCategory[];
  courses: LocalCourse[];
  course_modules: LocalCourseModule[];
  course_lessons: LocalCourseLesson[];
  course_enrollments: LocalCourseEnrollment[];
  lesson_progress: LocalLessonProgress[];
  community_groups: LocalCommunityGroup[];
  group_memberships: LocalGroupMembership[];
  creative_posts: LocalCreativePost[];
  post_reactions: LocalPostReaction[];
  post_comments: LocalPostComment[];
  user_follows: LocalUserFollow[];
  user_blocks: LocalUserBlock[];
  content_reports: LocalContentReport[];
  opportunity_categories: LocalOpportunityCategory[];
  opportunities: LocalOpportunity[];
  saved_opportunities: LocalSavedOpportunity[];
  organizations: LocalOrganization[];
  achievements: LocalAchievement[];
  user_achievements: LocalUserAchievement[];
  xp_transactions: LocalXpTransaction[];
  notifications: LocalNotification[];
  notification_preferences: LocalNotificationPreferences[];
  announcements: LocalAnnouncement[];
  platform_settings: LocalPlatformSetting[];
  audit_logs: LocalAuditLog[];
}

function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function hoursFromNowIso(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysDiffFromDateStrings(todayStr: string, prevStr: string | null): number | null {
  if (!prevStr) return null;
  const t = new Date(`${todayStr}T00:00:00Z`).getTime();
  const p = new Date(`${prevStr.slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(p)) return null;
  return Math.round((t - p) / (24 * 60 * 60 * 1000));
}

function createInitialSeedState(): LocalDatabaseState {
  const now = new Date().toISOString();
  const earlier1 = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const earlier2 = new Date(Date.now() - 18 * 3600 * 1000).toISOString();
  const earlier3 = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const today = todayDateStr();
  const disabledPassHash = `scrypt$16384$8$1$${crypto.randomBytes(16).toString('hex')}$${crypto.randomBytes(64).toString('hex')}`;

  return {
    version: 1,
    nextIds: {
      users: 4,
      user_sessions: 1,
      challenge_categories: 6,
      challenges: 5,
      challenge_questions: 11,
      challenge_submissions: 3,
      course_categories: 5,
      courses: 4,
      course_modules: 4,
      course_lessons: 7,
      course_enrollments: 2,
      lesson_progress: 3,
      community_groups: 4,
      group_memberships: 6,
      creative_posts: 5,
      post_reactions: 4,
      post_comments: 4,
      user_follows: 3,
      user_blocks: 1,
      content_reports: 1,
      opportunity_categories: 6,
      opportunities: 5,
      saved_opportunities: 1,
      organizations: 3,
      achievements: 6,
      user_achievements: 4,
      xp_transactions: 6,
      notifications: 1,
      announcements: 2,
      audit_logs: 1,
    },
    users: [
      {
        id: 1,
        email: 'aline.uwase@community.rw',
        phone: null,
        password_hash: disabledPassHash,
        role: 'member',
        status: 'active',
        age_group: 'adult_18_plus',
        preferred_language: 'en',
        contact_verified: 1,
        contact_verification_token_hash: null,
        contact_verification_expires_at: null,
        password_reset_token_hash: null,
        password_reset_expires_at: null,
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: earlier1,
        created_at: earlier3,
      },
      {
        id: 2,
        email: 'jeanbosco.h@community.rw',
        phone: null,
        password_hash: disabledPassHash,
        role: 'member',
        status: 'active',
        age_group: 'adult_18_plus',
        preferred_language: 'rw',
        contact_verified: 1,
        contact_verification_token_hash: null,
        contact_verification_expires_at: null,
        password_reset_token_hash: null,
        password_reset_expires_at: null,
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: earlier2,
        created_at: earlier3,
      },
      {
        id: 3,
        email: 'keza.sandrine@community.rw',
        phone: null,
        password_hash: disabledPassHash,
        role: 'educator',
        status: 'active',
        age_group: 'adult_18_plus',
        preferred_language: 'fr',
        contact_verified: 1,
        contact_verification_token_hash: null,
        contact_verification_expires_at: null,
        password_reset_token_hash: null,
        password_reset_expires_at: null,
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: earlier2,
        created_at: earlier3,
      },
    ],
    user_profiles: [
      {
        user_id: 1,
        display_name: 'Aline Uwase',
        username: 'aline_uwase',
        avatar_url: null,
        bio: 'Web developer and digital literacy mentor based in Gasabo, Kigali.',
        district: 'Gasabo',
        interests_json: ['Web Engineering', 'Civic Tech', 'UI Design'],
        skills_json: ['HTML & CSS', 'TypeScript', 'Community Training'],
        profile_visibility: 'public',
        show_activity: 1,
        total_xp: 240,
        current_level: 2,
        current_streak: 4,
        longest_streak: 4,
        last_challenge_date: today,
      },
      {
        user_id: 2,
        display_name: 'Jean Bosco Habimana',
        username: 'jb_habimana',
        avatar_url: null,
        bio: 'Agribusiness founder and cooperative bookkeeper in Huye District.',
        district: 'Huye',
        interests_json: ['Agribusiness', 'Financial Literacy', 'Cooperatives'],
        skills_json: ['Cashflow Planning', 'Kinyarwanda Communication'],
        profile_visibility: 'public',
        show_activity: 1,
        total_xp: 185,
        current_level: 2,
        current_streak: 3,
        longest_streak: 3,
        last_challenge_date: today,
      },
      {
        user_id: 3,
        display_name: 'Keza Sandrine',
        username: 'keza_s',
        avatar_url: null,
        bio: 'Career readiness coach helping students prepare standout applications.',
        district: 'Musanze',
        interests_json: ['Career Coaching', 'Scholarships', 'Writing'],
        skills_json: ['CV Review', 'Interview Prep', 'French & English'],
        profile_visibility: 'public',
        show_activity: 1,
        total_xp: 120,
        current_level: 2,
        current_streak: 2,
        longest_streak: 2,
        last_challenge_date: today,
      },
    ],
    user_sessions: [],
    challenge_categories: [
      {
        id: 1,
        slug: 'rwanda-heritage-civics',
        name_en: 'Rwanda Heritage & Civics',
        name_rw: 'Umuco n’Uburere Mboneragihugu',
        name_fr: 'Patrimoine et Civisme du Rwanda',
        description_en: 'History, civic values, geography, and national development milestones.',
        description_rw: 'Amateka, indangagaciro z’uburere mboneragihugu, ubumenyi bw’isi n’iterambere.',
        description_fr: 'Histoire, valeurs civiques, géographie et étapes du développement.',
        is_active: 1,
        sort_order: 1,
      },
      {
        id: 2,
        slug: 'digital-literacy-coding',
        name_en: 'Digital Literacy & Coding',
        name_rw: 'Ubumenyi bw’Ikoranabuhanga',
        name_fr: 'Compétences Numériques & Code',
        description_en: 'Practical computing, online safety, web engineering, and data logic.',
        description_rw: 'Ubumenyi ngiro mu ikoranabuhanga, umutekano kuri murandasi no gukora porogaramu.',
        description_fr: 'Informatique pratique, sécurité en ligne, programmation et données.',
        is_active: 1,
        sort_order: 2,
      },
      {
        id: 3,
        slug: 'mathematics-logic',
        name_en: 'Mathematics & Logic',
        name_rw: 'Imibare n’Imitekerereze',
        name_fr: 'Mathématiques et Logique',
        description_en: 'Everyday problem solving, quantitative reasoning, and analytical puzzles.',
        description_rw: 'Gukemura ibibazo ukoresheje imibare n’imitekerereze isobanutse.',
        description_fr: 'Résolution de problèmes, raisonnement quantitatif et logique.',
        is_active: 1,
        sort_order: 3,
      },
      {
        id: 4,
        slug: 'entrepreneurship-finance',
        name_en: 'Entrepreneurship & Finance',
        name_rw: 'Kwihangira Imirimo n’Imari',
        name_fr: 'Entrepreneuriat et Finance',
        description_en: 'Budgeting, small business growth, savings, and cooperative management.',
        description_rw: 'Gucunga umutungo, gutangira umushinga muto no kwizigamira.',
        description_fr: 'Gestion financière, création d’entreprise et épargne.',
        is_active: 1,
        sort_order: 4,
      },
      {
        id: 5,
        slug: 'communication-languages',
        name_en: 'Communication & Languages',
        name_rw: 'Itumanaho n’Indimi',
        name_fr: 'Communication et Langues',
        description_en: 'Clear writing, Kinyarwanda proficiency, English & French workplace skills.',
        description_rw: 'Kwandika neza, Ikinyarwanda cyiza n’indimi z’amahanga mu kazi.',
        description_fr: 'Rédaction claire, maîtrise du kinyarwanda et communication professionnelle.',
        is_active: 1,
        sort_order: 5,
      },
    ],
    challenges: [
      {
        id: 1,
        category_id: 2,
        slug: 'sample-digital-safety-rwanda-daily',
        title_en: 'Daily Challenge: Safe Digital Citizen in Rwanda',
        title_rw: 'Irushanwa ry’Umunsi: Umutekano kuri Murandasi',
        title_fr: 'Défi du Jour : Citoyen Numérique Sûr',
        description_en:
          'Test practical habits for protecting mobile money accounts, personal passwords, and avoiding phishing links.',
        description_rw:
          'Gerageza ubumenyi bwo kurinda konti ya Mobile Money, ijambobanga n’uburiganya kuri murandasi.',
        description_fr:
          'Testez vos réflexes pour protéger vos comptes mobiles et mots de passe.',
        difficulty: 'beginner',
        challenge_type: 'daily',
        time_limit_seconds: 180,
        xp_reward: 60,
        active_date: today,
        is_featured: 1,
        is_sample: 0,
        status: 'published',
        created_by: 3,
        created_at: earlier1,
      },
      {
        id: 2,
        category_id: 1,
        slug: 'sample-rwanda-geography-innovation',
        title_en: 'Rwanda Geography & Innovation Sprint',
        title_rw: 'Ubumenyi bw’Isi n’Udushya mu Rwanda',
        title_fr: 'Géographie et Innovation au Rwanda',
        description_en:
          'Explore Rwanda’s provinces, natural landmarks, and national digital ecosystem milestones.',
        description_rw:
          'Menya intara z’u Rwanda, ibyiza nyaburanga n’iterambere mu ikoranabuhanga.',
        description_fr:
          'Découvrez les provinces du Rwanda, ses sites naturels et son essor technologique.',
        difficulty: 'beginner',
        challenge_type: 'weekly',
        time_limit_seconds: 240,
        xp_reward: 75,
        active_date: today,
        is_featured: 0,
        is_sample: 0,
        status: 'published',
        created_by: 3,
        created_at: earlier2,
      },
      {
        id: 3,
        category_id: 4,
        slug: 'sample-small-business-budgeting',
        title_en: 'Entrepreneurship & Cashflow Basics',
        title_rw: 'Ibanze mu Gucunga Umushinga n’Imari',
        title_fr: 'Bases de Gestion et Trésorerie',
        description_en:
          'Practice profit margin calculation, separating personal and business funds, and savings discipline.',
        description_rw:
          'Imenyereze kubara inyungu, gutandukanya amafaranga y’umushinga n’ayawe bwite no kwizigamira.',
        description_fr:
          'Maîtrisez la marge, la séparation des comptes et l’épargne d’entreprise.',
        difficulty: 'intermediate',
        challenge_type: 'practice',
        time_limit_seconds: 200,
        xp_reward: 70,
        active_date: today,
        is_featured: 0,
        is_sample: 0,
        status: 'published',
        created_by: 3,
        created_at: earlier2,
      },
      {
        id: 4,
        category_id: 3,
        slug: 'everyday-mathematics-logic',
        title_en: 'Everyday Mathematics & Data Logic',
        title_rw: 'Imibare ya Buri Munsi n’Ubusesenguzi',
        title_fr: 'Mathématiques Pratiques et Logique',
        description_en:
          'Solve percentage discounts, unit rates, and practical scheduling problems.',
        description_rw:
          'Kemura ibibazo by’ijanisha, igabanuka ry’ibiciro n’igenamigambi ry’igihe.',
        description_fr:
          'Résolvez des problèmes de pourcentages, taux unitaires et planification.',
        difficulty: 'intermediate',
        challenge_type: 'practice',
        time_limit_seconds: 240,
        xp_reward: 80,
        active_date: today,
        is_featured: 0,
        is_sample: 0,
        status: 'published',
        created_by: 3,
        created_at: earlier3,
      },
    ],
    challenge_questions: [
      {
        id: 1,
        challenge_id: 1,
        prompt_en: 'You receive an SMS asking for your Mobile Money PIN to claim a prize. What should you do?',
        prompt_rw: 'Ubonye ubutumwa bugusaba PIN ya Mobile Money ngo uhabwe igihembo. Wakora iki?',
        prompt_fr: 'Un SMS vous demande votre code PIN Mobile Money pour recevoir un prix. Que faire ?',
        options_json: [
          'Reply immediately with your PIN',
          'Ignore, never share your PIN, and report the number',
          'Forward the SMS to friends',
          'Call the number and read your ID number',
        ],
        correct_option_index: 1,
        explanation_en: 'No legitimate service or bank ever asks for your PIN via SMS or phone call.',
        explanation_rw: 'Nta kigo cyemewe kigusaba PIN yawe kuri SMS cyangwa telefoni.',
        explanation_fr: 'Aucun service légitime ne demande jamais votre code PIN.',
        points_weight: 20,
        sort_order: 1,
      },
      {
        id: 2,
        challenge_id: 1,
        prompt_en: 'Which password is strongest for protecting your learning and career accounts?',
        prompt_rw: 'Ni irihe jambobanga rikomeye ririnda konti zawe zo kwiga n’akazi?',
        prompt_fr: 'Quel mot de passe protège le mieux vos comptes ?',
        options_json: ['kigali2026', '12345678', 'Umisozi@Kigali!94#', 'password1'],
        correct_option_index: 2,
        explanation_en:
          'A strong password combines length (12+ chars), uppercase, lowercase, numbers, and symbols.',
        explanation_rw: 'Ijambobanga rikomeye rigira inyuguti nkuru n’intoya, imibare n’ibimenyetso.',
        explanation_fr: 'Un mot de passe robuste combine longueur, majuscules, chiffres et symboles.',
        points_weight: 20,
        sort_order: 2,
      },
      {
        id: 3,
        challenge_id: 1,
        prompt_en: 'Before clicking a scholarship link shared in a group chat, what is the safest check?',
        prompt_rw: 'Mbere yo gukanda link ya buruse yoherejwe mu itsinda, ni iki ugomba kubanza kugenzura?',
        prompt_fr: 'Avant de cliquer sur un lien de bourse partagé en groupe, que vérifier ?',
        options_json: [
          'Verify the official domain name and HTTPS lock icon',
          'Click quickly before it expires',
          'Download any .exe file attached',
          'Share your national ID photo first',
        ],
        correct_option_index: 0,
        explanation_en:
          'Always check the official organization domain and HTTPS certificate before entering personal details.',
        explanation_rw: 'Banza ugenzure izina ry’urubuga rwemewe (domain) n’ikimenyetso cya HTTPS.',
        explanation_fr: 'Vérifiez toujours le nom de domaine officiel et le cadenas HTTPS.',
        points_weight: 20,
        sort_order: 3,
      },
      {
        id: 4,
        challenge_id: 2,
        prompt_en: 'How many administrative provinces make up Rwanda (including the City of Kigali)?',
        prompt_rw: 'U Rwanda rugizwe n’intara zingahe (habariwemo n’Umujyi wa Kigali)?',
        prompt_fr: 'Combien d’entités provinciales composent le Rwanda (avec Kigali) ?',
        options_json: ['3', '4', '5', '6'],
        correct_option_index: 2,
        explanation_en:
          'Rwanda consists of Northern, Southern, Eastern, Western Provinces and the City of Kigali (5 total).',
        explanation_rw: 'U Rwanda rugizwe n’Intara 4 n’Umujyi wa Kigali (zose hamwe ni 5).',
        explanation_fr: 'Le Rwanda compte 4 provinces plus la ville de Kigali (5 au total).',
        points_weight: 25,
        sort_order: 1,
      },
      {
        id: 5,
        challenge_id: 2,
        prompt_en: 'Which national service portal connects citizens in Rwanda to public services online?',
        prompt_rw: 'Ni uruhe rubuga rufasha Abanyarwanda kubona serivisi za Leta kuri murandasi?',
        prompt_fr: 'Quel portail national offre les services publics en ligne au Rwanda ?',
        options_json: ['Irembo', 'KigaliMail', 'RwandaPay', 'UmugandaNet'],
        correct_option_index: 0,
        explanation_en:
          'IremboGov provides digital access to civil registration, permits, and citizen services across Rwanda.',
        explanation_rw: 'Irembo rifasha abaturage kubona serivisi za Leta mu buryo bw’ikoranabuhanga.',
        explanation_fr: 'IremboGov centralise l’accès numérique aux services publics rwandais.',
        points_weight: 25,
        sort_order: 2,
      },
      {
        id: 6,
        challenge_id: 2,
        prompt_en: 'Which lake sits along Rwanda’s western border?',
        prompt_rw: 'Ni ikihe kiyaga giherereye ku mupaka w’iburengerazuba bw’u Rwanda?',
        prompt_fr: 'Quel lac borde l’ouest du Rwanda ?',
        options_json: ['Lake Muhazi', 'Lake Kivu', 'Lake Ihema', 'Lake Rweru'],
        correct_option_index: 1,
        explanation_en: 'Lake Kivu spans the western border between Rwanda and the DRC.',
        explanation_rw: 'Ikiyaga cya Kivu giherereye mu burengerazuba bw’u Rwanda.',
        explanation_fr: 'Le lac Kivu longe la frontière occidentale du Rwanda.',
        points_weight: 25,
        sort_order: 3,
      },
      {
        id: 7,
        challenge_id: 3,
        prompt_en:
          'A craft business spends 12,000 RWF on materials and sells the product for 18,000 RWF. What is the gross profit?',
        prompt_rw:
          'Umushinga ukoresha 12,000 RWF ku bikoresho ukagurisha igicuruzwa kuri 18,000 RWF. Inyungu y’ibanze ni angahe?',
        prompt_fr:
          'Un atelier dépense 12 000 RWF et vend à 18 000 RWF. Quelle est la marge brute ?',
        options_json: ['4,000 RWF', '6,000 RWF', '12,000 RWF', '30,000 RWF'],
        correct_option_index: 1,
        explanation_en: 'Gross profit equals Revenue (18,000 RWF) minus direct cost (12,000 RWF) = 6,000 RWF.',
        explanation_rw: 'Inyungu iboneka ufashe igiciro cyo kugurisha (18,000) ugakuramo ikiguzi (12,000) = 6,000 RWF.',
        explanation_fr: '18 000 RWF - 12 000 RWF = 6 000 RWF de marge brute.',
        points_weight: 35,
        sort_order: 1,
      },
      {
        id: 8,
        challenge_id: 3,
        prompt_en: 'Why should an entrepreneur keep separate records for business money and household money?',
        prompt_rw: 'Kuki ari ngombwa gutandukanya imibare y’amafaranga y’ubucuruzi n’ay’urugo?',
        prompt_fr: 'Pourquoi séparer la comptabilité personnelle et professionnelle ?',
        options_json: [
          'To measure true profit and avoid accidentally spending business capital',
          'Because banks forbid using cash',
          'To pay higher fees',
          'It is only useful for big factories',
        ],
        correct_option_index: 0,
        explanation_en: 'Separating finances lets you see real profitability and protects working capital.',
        explanation_rw: 'Bituma umenya niba ubucuruzi bwunguka kandi bikarinda igishoro cy’umushinga.',
        explanation_fr: 'Cela permet de mesurer la rentabilité réelle et de préserver le capital.',
        points_weight: 35,
        sort_order: 2,
      },
      {
        id: 9,
        challenge_id: 4,
        prompt_en: 'A solar lamp costs 20,000 RWF and is offered at a 15% discount. What is the new price?',
        prompt_rw: 'Itara rikoresha imirasire y’izuba rigura 20,000 RWF rigabanyijweho 15%. Igiciro gishya ni ikihe?',
        prompt_fr: 'Une lampe solaire de 20 000 RWF bénéficie de 15 % de réduction. Quel est le nouveau prix ?',
        options_json: ['15,000 RWF', '17,000 RWF', '18,500 RWF', '19,000 RWF'],
        correct_option_index: 1,
        explanation_en: '15% of 20,000 is 3,000 RWF; 20,000 - 3,000 = 17,000 RWF.',
        explanation_rw: '15% bya 20,000 ni 3,000 RWF; 20,000 - 3,000 = 17,000 RWF.',
        explanation_fr: '15 % de 20 000 = 3 000 RWF, donc 17 000 RWF.',
        points_weight: 40,
        sort_order: 1,
      },
      {
        id: 10,
        challenge_id: 4,
        prompt_en: 'A bus leaves Kigali at 07:45 and reaches Musanze in 2 hours and 25 minutes. When does it arrive?',
        prompt_rw: 'Bisi ihagurutse i Kigali saa 07:45 ikamara amasaha 2 n’iminota 25. Igera i Musanze ryari?',
        prompt_fr: 'Un bus part à 07h45 pour un trajet de 2h25. À quelle heure arrive-t-il ?',
        options_json: ['09:10', '10:00', '10:10', '10:25'],
        correct_option_index: 2,
        explanation_en: '07:45 + 2 hours = 09:45; adding 25 minutes gives 10:10.',
        explanation_rw: '07:45 + amasaha 2 = 09:45; wongeyeho iminota 25 biba saa 10:10.',
        explanation_fr: '07h45 + 2h25 = 10h10.',
        points_weight: 40,
        sort_order: 2,
      },
    ],
    challenge_submissions: [
      {
        id: 1,
        challenge_id: 1,
        user_id: 1,
        answers_json: [
          { questionId: 1, selectedOptionIndex: 1 },
          { questionId: 2, selectedOptionIndex: 2 },
          { questionId: 3, selectedOptionIndex: 0 },
        ],
        score: 60,
        max_score: 60,
        correct_count: 3,
        total_questions: 3,
        duration_seconds: 68,
        xp_awarded: 60,
        submitted_at: earlier1,
      },
      {
        id: 2,
        challenge_id: 2,
        user_id: 2,
        answers_json: [
          { questionId: 4, selectedOptionIndex: 2 },
          { questionId: 5, selectedOptionIndex: 0 },
          { questionId: 6, selectedOptionIndex: 1 },
        ],
        score: 75,
        max_score: 75,
        correct_count: 3,
        total_questions: 3,
        duration_seconds: 92,
        xp_awarded: 75,
        submitted_at: earlier2,
      },
    ],
    course_categories: [
      {
        id: 1,
        slug: 'digital-skills',
        name_en: 'Digital Skills',
        name_rw: 'Ubumenyi bw’Ikoranabuhanga',
        name_fr: 'Compétences Numériques',
        description_en: 'Core digital tools, internet safety, spreadsheets, and software development.',
        description_rw: 'Ibikoresho by’ikoranabuhanga, umutekano kuri murandasi n’imibare ku mashini.',
        description_fr: 'Outils numériques, cybersécurité, tableurs et développement logiciel.',
        is_active: 1,
        sort_order: 1,
      },
      {
        id: 2,
        slug: 'career-readiness',
        name_en: 'Career Readiness',
        name_rw: 'Kwitegura Umwuga',
        name_fr: 'Préparation Professionnelle',
        description_en: 'CV writing, interviews, professional communication, and remote work.',
        description_rw: 'Kwandika umwirondoro (CV), ikiganiro cy’akazi n’itumanaho mu kazi.',
        description_fr: 'Rédaction de CV, entretiens et travail à distance.',
        is_active: 1,
        sort_order: 2,
      },
      {
        id: 3,
        slug: 'entrepreneurship',
        name_en: 'Entrepreneurship',
        name_rw: 'Kwihangira Imirimo',
        name_fr: 'Entrepreneuriat',
        description_en: 'Turning local ideas into sustainable ventures across Rwanda.',
        description_rw: 'Guhindura igitekerezo umushinga urambye mu Rwanda.',
        description_fr: 'Transformer une idée locale en entreprise durable au Rwanda.',
        is_active: 1,
        sort_order: 3,
      },
      {
        id: 4,
        slug: 'creative-media',
        name_en: 'Creative Media & Design',
        name_rw: 'Ubuhanzi n’Itangazamakuru',
        name_fr: 'Médias Créatifs et Design',
        description_en: 'Storytelling, visual design, photography, and digital publishing.',
        description_rw: 'Kubara inkuru, gushushanya, gufata amafoto no gutangaza ibihangano.',
        description_fr: 'Narration, design visuel, photographie et publication numérique.',
        is_active: 1,
        sort_order: 4,
      },
    ],
    courses: [
      {
        id: 1,
        category_id: 1,
        slug: 'sample-practical-web-foundations',
        title_en: 'Practical Web & Digital Foundations',
        title_rw: 'Ibanze mu Gukora Imbuga za Murandasi',
        title_fr: 'Fondamentaux du Web Pratique',
        summary_en:
          'Learn how websites work, structure accessible HTML pages, and apply responsive layouts for low-bandwidth devices.',
        summary_rw:
          'Wige uko imbuga za murandasi zikora, uko zitegurwa neza ku bakoresha bose n’uko zigenda neza kuri telefoni.',
        summary_fr:
          'Comprenez le fonctionnement du web et créez des pages rapides et accessibles.',
        level: 'beginner',
        estimated_minutes: 40,
        xp_reward: 120,
        status: 'published',
        is_sample: 0,
        created_by: 3,
        created_at: earlier1,
      },
      {
        id: 2,
        category_id: 2,
        slug: 'sample-career-cv-interview-rwanda',
        title_en: 'Writing a Standout CV & Preparing for Interviews',
        title_rw: 'Kwandika Umwirondoro (CV) no Kwitegura Ikiganiro cy’Akazi',
        title_fr: 'Rédiger un CV Efficace et Réussir ses Entretiens',
        summary_en:
          'Step-by-step guidance for students and job seekers in Rwanda to present achievements clearly to local and remote employers.',
        summary_rw:
          'Inama ngiro zifasha abanyeshuri n’abashaka akazi mu Rwanda kugaragaza ubushobozi bwabo neza.',
        summary_fr:
          'Guide pratique pour valoriser vos compétences auprès des recruteurs locaux et internationaux.',
        level: 'beginner',
        estimated_minutes: 35,
        xp_reward: 100,
        status: 'published',
        is_sample: 0,
        created_by: 3,
        created_at: earlier2,
      },
      {
        id: 3,
        category_id: 3,
        slug: 'cooperative-finance-basics',
        title_en: 'Personal Savings & Cooperative Finance',
        title_rw: 'Kwizigamira n’Imari y’Amakoperative',
        title_fr: 'Épargne Personnelle et Finance Coopérative',
        summary_en:
          'Build clear monthly budgets, track cooperative ledger entries, and prepare a realistic micro-business financial plan.',
        summary_rw:
          'Tegura ingengo y’imari y’ukwezi, ukurikirane imibare y’amakoperative n’umushinga uciriritse.',
        summary_fr:
          'Élaborez un budget mensuel clair et gérez la comptabilité d’une petite entreprise.',
        level: 'intermediate',
        estimated_minutes: 45,
        xp_reward: 140,
        status: 'published',
        is_sample: 0,
        created_by: 3,
        created_at: earlier3,
      },
    ],
    course_modules: [
      {
        id: 1,
        course_id: 1,
        title_en: 'Module 1: How the Web Works',
        title_rw: 'Igice cya 1: Uko Murandasi Ikora',
        title_fr: 'Module 1 : Fonctionnement du Web',
        sort_order: 1,
      },
      {
        id: 2,
        course_id: 2,
        title_en: 'Module 1: Clear Impact on Your CV',
        title_rw: 'Igice cya 1: Kugaragaza Umusaruro wawe kuri CV',
        title_fr: 'Module 1 : Mettre en Valeur vos Résultats',
        sort_order: 1,
      },
      {
        id: 3,
        course_id: 3,
        title_en: 'Module 1: Budgeting & Record Keeping',
        title_rw: 'Igice cya 1: Gucunga Umutungo n’Inyandiko',
        title_fr: 'Module 1 : Budget et Tenue de Livres',
        sort_order: 1,
      },
    ],
    course_lessons: [
      {
        id: 1,
        module_id: 1,
        course_id: 1,
        title_en: 'Browsers, Servers, and Fast Loading',
        title_rw: 'Mushakisha, Seriveri n’Umuvuduko wo Gufunguka',
        title_fr: 'Navigateurs, Serveurs et Performance',
        content_en:
          'Every time you open a website on your phone in Kigali or upcountry, your browser sends a request to a server. Keeping images compressed and pages clean ensures learners with limited data bundles can study smoothly.',
        content_rw:
          'Iyo ufunguye urubuga kuri telefoni yawe, mushakisha yohereza ubusabe kuri seriveri. Kugabanya uburemere bw’amafoto bituma urubuga rufunguka vuba kandi ntirutware amainternet menshi.',
        content_fr:
          'Lorsque vous ouvrez un site, votre navigateur interroge un serveur. Des images légères garantissent un accès fluide même avec une connexion limitée.',
        duration_minutes: 10,
        xp_reward: 30,
        assessment_question_json: {
          question: 'Why should web images be compressed before uploading?',
          options: [
            'To reduce data usage and load pages faster on mobile networks',
            'To make text impossible to read',
            'To disable HTTPS security',
          ],
          correctIndex: 0,
          explanation: 'Compressed images load significantly faster and save mobile data for users.',
        },
        sort_order: 1,
      },
      {
        id: 2,
        module_id: 1,
        course_id: 1,
        title_en: 'Accessible Headings and Clear Forms',
        title_rw: 'Imitwe y’Inyandiko n’Imbonerahamwe Zisobanutse',
        title_fr: 'Titres Accessibles et Formulaires Clairs',
        content_en:
          'Good digital products work for everyone, including older adults and screen reader users. Use clear labels above every input field, high color contrast, and plain everyday wording.',
        content_rw:
          'Ikoranabuhanga ryiza rifasha buri wese. Koresha amagambo yoroshye kumva, amabara agaragara neza n’ubusobanuro buri hejuru ya buri kazu ko kwandikamo.',
        content_fr:
          'Une interface accessible utilise des étiquettes claires, un bon contraste et un langage simple.',
        duration_minutes: 15,
        xp_reward: 30,
        assessment_question_json: {
          question: 'What helps screen-reader users and first-time users complete a form accurately?',
          options: [
            'Visible labels and clear error messages',
            'Removing all labels',
            'Using low-contrast gray text on gray backgrounds',
          ],
          correctIndex: 0,
          explanation: 'Explicit labels and clear error messages make forms usable for everyone.',
        },
        sort_order: 2,
      },
      {
        id: 3,
        module_id: 2,
        course_id: 2,
        title_en: 'Action Verbs and Measurable Results',
        title_rw: 'Ibikorwa Bifatika n’Imibare Igaragara',
        title_fr: 'Verbes d’Action et Résultats Chiffrés',
        content_en:
          'Instead of writing "Responsible for social media", describe what you achieved: "Grew community workshop attendance by 40% over 3 months through weekly updates." Keep your CV to 1–2 crisp pages.',
        content_rw:
          'Aho kwandika gusa ngo "Nakoraga itumanaho", garagaza ibyo wagezeho mu mibare: "Nazamuye ubwitabire bw’amahugurwa ku kigero cya 40% mu mezi 3."',
        content_fr:
          'Privilégiez des réalisations concrètes et mesurables sur une à deux pages bien structurées.',
        duration_minutes: 15,
        xp_reward: 40,
        assessment_question_json: {
          question: 'Which CV bullet point is strongest?',
          options: [
            'Helped customers at shop',
            'Organized inventory for 120 products and reduced stock errors by 25%',
            'Worked hard every day',
          ],
          correctIndex: 1,
          explanation: 'Specific actions paired with measurable outcomes help employers immediately understand your impact.',
        },
        sort_order: 1,
      },
      {
        id: 4,
        module_id: 2,
        course_id: 2,
        title_en: 'Structuring STAR Interview Answers',
        title_rw: 'Gutegura Ibisubizo mu Kiganiro cy’Akazi (STAR)',
        title_fr: 'Structurer ses Réponses d’Entretien (Méthode STAR)',
        content_en:
          'When an interviewer asks about a challenge you solved, walk through Situation, Task, Action, and Result in 90 seconds. Highlight what you personally contributed and what improved afterward.',
        content_rw:
          'Iyo ubajijwe ikibazo wakemuye, sobanura uko byari bimeze, inshingano yawe, igikorwa wakoze n’umusaruro wavuyemo mu buryo buvunaguye.',
        content_fr:
          'Décrivez la Situation, la Tâche, l’Action menée et le Résultat obtenu en moins de 2 minutes.',
        duration_minutes: 20,
        xp_reward: 40,
        assessment_question_json: {
          question: 'What does the R stand for in the STAR interview framework?',
          options: ['Resume', 'Result', 'Research'],
          correctIndex: 1,
          explanation: 'STAR stands for Situation, Task, Action, and Result — focusing on measurable outcomes.',
        },
        sort_order: 2,
      },
      {
        id: 5,
        module_id: 3,
        course_id: 3,
        title_en: 'Separating Working Capital from Daily Profit',
        title_rw: 'Gutandukanya Igishoro n’Inyungu ya Buri Munsi',
        title_fr: 'Séparer le Fonds de Roulement du Bénéfice',
        content_en:
          'Before paying yourself from daily sales, set aside restocking money first. Recording every inflow and outflow in a notebook or spreadsheet keeps cooperative reserves healthy.',
        content_rw:
          'Mbere yo gukoresha amafaranga yinjiye buri munsi, banza ubike ayo kugura ibicuruzwa bishya. Kwandika ibyinjira n’ibisohoka birinda igishoro.',
        content_fr:
          'Réservez d’abord le capital nécessaire au réapprovisionnement avant de prélever vos bénéfices.',
        duration_minutes: 20,
        xp_reward: 45,
        assessment_question_json: {
          question: 'What is the main risk of spending total daily sales without tracking costs?',
          options: [
            'Depleting the working capital needed to restock',
            'Increasing product quality too fast',
            'Earning higher interest rates',
          ],
          correctIndex: 0,
          explanation: 'Without tracking costs separately, owners often spend restocking capital as if it were profit.',
        },
        sort_order: 1,
      },
      {
        id: 6,
        module_id: 3,
        course_id: 3,
        title_en: 'Setting a Practical 3-Month Emergency Reserve',
        title_rw: 'Gushyiraho Ikigega cy’Ingoboka cy’Amezi 3',
        title_fr: 'Constituer une Réserve d’Urgence de 3 Mois',
        content_en:
          'Saving a fixed percentage of every sale or salary into a dedicated savings account builds resilience against seasonal slowdowns without needing high-interest emergency loans.',
        content_rw:
          'Kuzigama igice gihoraho ku byo winjiza buri kwezi bikurinda gufata imyenda ihenze mu bihe bigoye.',
        content_fr:
          'Mettre de côté un pourcentage fixe protège votre activité lors des périodes plus calmes.',
        duration_minutes: 25,
        xp_reward: 45,
        assessment_question_json: {
          question: 'Why is an emergency reserve helpful for a small business or household?',
          options: [
            'It covers unexpected shocks without expensive emergency borrowing',
            'It replaces the need to keep sales records',
            'It eliminates taxes',
          ],
          correctIndex: 0,
          explanation: 'An emergency buffer cushions unexpected expenses and protects business continuity.',
        },
        sort_order: 2,
      },
    ],
    course_enrollments: [],
    lesson_progress: [],
    community_groups: [
      {
        id: 1,
        slug: 'kigali-digital-builders',
        name: 'Kigali Digital Builders',
        description: 'A friendly space for learners practicing coding, UI design, and digital problem-solving across Rwanda.',
        category: 'Technology',
        created_by: 1,
        is_private: 0,
        member_count: 2,
        is_sample: 0,
        status: 'active',
        created_at: earlier2,
      },
      {
        id: 2,
        slug: 'rwanda-youth-entrepreneurs',
        name: 'Rwanda Youth Entrepreneurs',
        description: 'Share small business ideas, market insights, and cooperative growth lessons.',
        category: 'Entrepreneurship',
        created_by: 2,
        is_private: 0,
        member_count: 2,
        is_sample: 0,
        status: 'active',
        created_at: earlier2,
      },
      {
        id: 3,
        slug: 'career-scholarship-circle',
        name: 'Scholarship & Career Readiness Circle',
        description: 'Peer CV reviews, fellowship application tips, and interview practice across all provinces.',
        category: 'Career',
        created_by: 3,
        is_private: 0,
        member_count: 1,
        is_sample: 0,
        status: 'active',
        created_at: earlier3,
      },
    ],
    group_memberships: [
      { id: 1, group_id: 1, user_id: 1, role: 'moderator', created_at: earlier2 },
      { id: 2, group_id: 1, user_id: 3, role: 'member', created_at: earlier2 },
      { id: 3, group_id: 2, user_id: 2, role: 'moderator', created_at: earlier2 },
      { id: 4, group_id: 2, user_id: 1, role: 'member', created_at: earlier2 },
      { id: 5, group_id: 3, user_id: 3, role: 'moderator', created_at: earlier3 },
    ],
    creative_posts: [
      {
        id: 1,
        user_id: 1,
        group_id: 1,
        post_type: 'create_showcase',
        category: 'Technology & Apps',
        title: 'Low-Bandwidth Kinyarwanda Study Flashcards Web App',
        body: 'Built a lightweight offline-first flashcard tool under 45 KB so students in rural districts can revise STEM terms even with slow mobile data.',
        media_url: '/src/assets/images/create_kigali_studio_1795129622622.jpg',
        media_mime: 'image/jpeg',
        likes_count: 2,
        comments_count: 1,
        moderation_status: 'approved',
        is_sample: 0,
        created_at: earlier1,
      },
      {
        id: 2,
        user_id: 2,
        group_id: 2,
        post_type: 'create_showcase',
        category: 'Entrepreneurship',
        title: 'Simple Cooperative Harvest Tracker Template',
        body: 'Shared our Huye cooperative’s one-page sheet for tracking coffee & bean inputs, transport costs, and member payouts transparently.',
        media_url: null,
        media_mime: null,
        likes_count: 1,
        comments_count: 1,
        moderation_status: 'approved',
        is_sample: 0,
        created_at: earlier2,
      },
      {
        id: 3,
        user_id: 3,
        group_id: 3,
        post_type: 'discussion',
        category: 'Community Discussion',
        title: 'What helped you most when preparing your first internship CV?',
        body: 'Share one practical improvement you made to your CV or portfolio that led to an interview call. Let us compile top tips for first-time applicants!',
        media_url: null,
        media_mime: null,
        likes_count: 1,
        comments_count: 1,
        moderation_status: 'approved',
        is_sample: 0,
        created_at: earlier1,
      },
      {
        id: 4,
        user_id: 1,
        group_id: 1,
        post_type: 'discussion',
        category: 'Community Discussion',
        title: 'Weekend Kigali Code & Accessibility Study Meetup',
        body: 'Anyone practicing responsive forms and keyboard accessibility this Saturday? Drop questions here and we can review links together.',
        media_url: null,
        media_mime: null,
        likes_count: 0,
        comments_count: 0,
        moderation_status: 'approved',
        is_sample: 0,
        created_at: earlier2,
      },
    ],
    post_reactions: [
      { id: 1, post_id: 1, user_id: 2, reaction_type: 'like', created_at: earlier1 },
      { id: 2, post_id: 1, user_id: 3, reaction_type: 'celebrate', created_at: earlier1 },
      { id: 3, post_id: 2, user_id: 1, reaction_type: 'like', created_at: earlier2 },
    ],
    post_comments: [
      {
        id: 1,
        post_id: 1,
        user_id: 2,
        body: 'Keeping the bundle under 45 KB makes a real difference for learners outside Kigali. Great work!',
        moderation_status: 'visible',
        created_at: earlier1,
      },
      {
        id: 2,
        post_id: 2,
        user_id: 3,
        body: 'Clear transparent ledgers help cooperatives build trust with youth members.',
        moderation_status: 'visible',
        created_at: earlier2,
      },
      {
        id: 3,
        post_id: 3,
        user_id: 1,
        body: 'Replacing generic duties with actual numbers (like users helped or projects shipped) made my CV twice as clear.',
        moderation_status: 'visible',
        created_at: earlier1,
      },
    ],
    user_follows: [
      { id: 1, follower_id: 1, following_id: 3, created_at: earlier2 },
      { id: 2, follower_id: 2, following_id: 1, created_at: earlier2 },
    ],
    user_blocks: [],
    content_reports: [],
    opportunity_categories: [
      { id: 1, slug: 'scholarships', name_en: 'Scholarships & Fellowships', name_rw: 'Buruse n’Amahugurwa', name_fr: 'Bourses d’Études', sort_order: 1 },
      { id: 2, slug: 'internships', name_en: 'Internships & Apprenticeships', name_rw: 'Kwimenyereza Umwuga', name_fr: 'Stages Professionnels', sort_order: 2 },
      { id: 3, slug: 'jobs-remote', name_en: 'Jobs & Remote Careers', name_rw: 'Akazi n’Akazi ko Kure', name_fr: 'Emplois et Télétravail', sort_order: 3 },
      { id: 4, slug: 'grants-impact', name_en: 'Grants & Youth Innovation', name_rw: 'Inkunga z’Imishinga', name_fr: 'Subventions et Projets', sort_order: 4 },
      { id: 5, slug: 'volunteering', name_en: 'Volunteering & Community', name_rw: 'Ubushake n’Umuganda', name_fr: 'Bénévolat', sort_order: 5 },
    ],
    opportunities: [
      {
        id: 1,
        category_id: 1,
        opportunity_type: 'scholarship',
        title: 'Rwanda Digital Talent Scholarship',
        organization_name: 'Kigali Innovation Academy',
        location: 'Kigali, Rwanda',
        is_remote: 0,
        summary:
          'Full tuition support for Rwandan youth pursuing software engineering, data analysis, and civic technology tracks.',
        eligibility: 'Rwandan residents aged 18–28 with secondary school completion.',
        application_url: 'https://www.minict.gov.rw',
        deadline_at: daysFromNowIso(60),
        approval_status: 'approved',
        verified_status: 'verified',
        is_featured: 1,
        is_sample: 0,
        submitted_by: 3,
        approved_by: 3,
        created_at: earlier2,
      },
      {
        id: 2,
        category_id: 2,
        opportunity_type: 'internship',
        title: 'Junior Product & Web Support Internship',
        organization_name: 'Norrsken East Africa Partner Hub',
        location: 'Kigali, Rwanda',
        is_remote: 0,
        summary:
          '6-month paid learning internship supporting community startups with documentation, QA testing, and web design.',
        eligibility: 'University students or recent graduates with foundational HTML/CSS knowledge.',
        application_url: 'https://www.norrsken.org',
        deadline_at: daysFromNowIso(45),
        approval_status: 'approved',
        verified_status: 'verified',
        is_featured: 1,
        is_sample: 0,
        submitted_by: 3,
        approved_by: 3,
        created_at: earlier2,
      },
      {
        id: 3,
        category_id: 3,
        opportunity_type: 'remote_job',
        title: 'Remote Junior Data Operations Associate',
        organization_name: 'East Africa Analytics Collective',
        location: 'Remote (East Africa)',
        is_remote: 1,
        summary:
          'Analyze survey datasets, maintain clean spreadsheets, and build weekly partner reports from anywhere in Rwanda.',
        eligibility: 'Strong spreadsheet skills, reliable internet access, and clear written English.',
        application_url: 'https://rdb.rw',
        deadline_at: daysFromNowIso(30),
        approval_status: 'approved',
        verified_status: 'verified',
        is_featured: 0,
        is_sample: 0,
        submitted_by: 3,
        approved_by: 3,
        created_at: earlier3,
      },
      {
        id: 4,
        category_id: 4,
        opportunity_type: 'grant',
        title: 'Community Green Innovation Micro-Grant',
        organization_name: 'Rwanda Civic Makers Fund',
        location: 'All Districts, Rwanda',
        is_remote: 0,
        summary:
          'Seed grants for youth-led sustainability, agriculture tech, and clean water solutions in local sectors.',
        eligibility: 'Teams of 2–5 members based in Rwanda with a working prototype or community pilot.',
        application_url: 'https://rema.gov.rw',
        deadline_at: daysFromNowIso(75),
        approval_status: 'approved',
        verified_status: 'verified',
        is_featured: 0,
        is_sample: 0,
        submitted_by: 3,
        approved_by: 3,
        created_at: earlier3,
      },
    ],
    saved_opportunities: [],
    organizations: [
      {
        id: 1,
        name: 'Kigali Innovation Academy',
        slug: 'kigali-innovation-academy',
        org_type: 'education',
        website_url: 'https://www.minict.gov.rw',
        verified: 1,
        description: 'Digital skills and software engineering partner hub in Kigali.',
        created_by: 3,
        created_at: earlier3,
      },
      {
        id: 2,
        name: 'Rwanda Civic Makers Fund',
        slug: 'rwanda-civic-makers-fund',
        org_type: 'nonprofit',
        website_url: 'https://rema.gov.rw',
        verified: 1,
        description: 'Supporting district-level youth climate and innovation pilots.',
        created_by: 3,
        created_at: earlier3,
      },
    ],
    achievements: [
      {
        id: 1,
        slug: 'first-challenge',
        title_en: 'First Challenge Complete',
        title_rw: 'Igikorwa cya Mbere Cyagenze Neza',
        title_fr: 'Premier Défi Réussi',
        description_en: 'Completed your first knowledge challenge on LEVELUP RWANDA.',
        description_rw: 'Warangije igikorwa cyawe cya mbere cy’ubumenyi kuri LEVELUP RWANDA.',
        description_fr: 'Vous avez terminé votre premier défi sur LEVELUP RWANDA.',
        icon_name: 'Trophy',
        badge_tier: 'bronze',
        xp_bonus: 25,
        rule_type: 'challenges_completed',
        rule_threshold: 1,
        is_active: 1,
      },
      {
        id: 2,
        slug: 'streak-3',
        title_en: '3-Day Consistency',
        title_rw: 'Iminsi 3 Ikuranira',
        title_fr: 'Série de 3 Jours',
        description_en: 'Completed challenges on 3 consecutive days.',
        description_rw: 'Wakoze ibikorwa iminsi 3 ikurikirana.',
        description_fr: 'Défis terminés pendant 3 jours consécutifs.',
        icon_name: 'Flame',
        badge_tier: 'silver',
        xp_bonus: 50,
        rule_type: 'streak_days',
        rule_threshold: 3,
        is_active: 1,
      },
      {
        id: 3,
        slug: 'knowledge-seeker',
        title_en: 'Course Finisher',
        title_rw: 'Uwarangije Isomo',
        title_fr: 'Cours Terminé',
        description_en: 'Completed your first full learning course and assessments.',
        description_rw: 'Warangije isomo ryawe rya mbere n’isuzuma ryaryo.',
        description_fr: 'Vous avez terminé votre premier cours complet.',
        icon_name: 'GraduationCap',
        badge_tier: 'gold',
        xp_bonus: 75,
        rule_type: 'courses_completed',
        rule_threshold: 1,
        is_active: 1,
      },
      {
        id: 4,
        slug: 'creative-spark',
        title_en: 'Creative Contributor',
        title_rw: 'Umuhanga mu Guhanga',
        title_fr: 'Créateur Actif',
        description_en: 'Shared your first original project or story in Create.',
        description_rw: 'Watangaje igihangano cyawe cya mbere mu gice cyo Guhanga.',
        description_fr: 'Vous avez partagé votre première création.',
        icon_name: 'Palette',
        badge_tier: 'bronze',
        xp_bonus: 25,
        rule_type: 'posts_created',
        rule_threshold: 1,
        is_active: 1,
      },
      {
        id: 5,
        slug: 'xp-milestone-500',
        title_en: '500 XP Milestone',
        title_rw: 'Amanota 500 y’Uburambe',
        title_fr: 'Cap des 500 XP',
        description_en: 'Earned 500 experience points through learning and challenges.',
        description_rw: 'Wagejeje amanota 500 y’uburambe binyuze mu kwiga no gukina.',
        description_fr: 'Vous avez accumulé 500 points d’expérience.',
        icon_name: 'Award',
        badge_tier: 'gold',
        xp_bonus: 100,
        rule_type: 'total_xp',
        rule_threshold: 500,
        is_active: 1,
      },
    ],
    user_achievements: [
      { id: 1, user_id: 1, achievement_id: 1, unlocked_at: earlier1 },
      { id: 2, user_id: 1, achievement_id: 2, unlocked_at: earlier1 },
      { id: 3, user_id: 2, achievement_id: 1, unlocked_at: earlier2 },
    ],
    xp_transactions: [
      {
        id: 1,
        user_id: 1,
        source_type: 'challenge_completion',
        source_id: 1,
        idempotency_key: 'seed:1:1',
        points: 165,
        description: 'Completed challenges and learning modules',
        created_at: earlier1,
      },
      {
        id: 2,
        user_id: 1,
        source_type: 'achievement_bonus',
        source_id: 2,
        idempotency_key: 'seed:1:2',
        points: 75,
        description: 'Achievement unlocked: First Challenge & 3-Day Streak',
        created_at: earlier1,
      },
      {
        id: 3,
        user_id: 2,
        source_type: 'challenge_completion',
        source_id: 2,
        idempotency_key: 'seed:2:1',
        points: 185,
        description: 'Completed Rwanda Geography & Entrepreneurship challenges',
        created_at: earlier2,
      },
      {
        id: 4,
        user_id: 3,
        source_type: 'lesson_completion',
        source_id: 3,
        idempotency_key: 'seed:3:1',
        points: 120,
        description: 'Completed Career Readiness track',
        created_at: earlier2,
      },
    ],
    notifications: [],
    notification_preferences: [
      {
        user_id: 1,
        challenge_reminders: 1,
        learning_updates: 1,
        community_activity: 1,
        opportunity_alerts: 1,
        announcements: 1,
      },
      {
        user_id: 2,
        challenge_reminders: 1,
        learning_updates: 1,
        community_activity: 1,
        opportunity_alerts: 1,
        announcements: 1,
      },
      {
        user_id: 3,
        challenge_reminders: 1,
        learning_updates: 1,
        community_activity: 1,
        opportunity_alerts: 1,
        announcements: 1,
      },
    ],
    announcements: [
      {
        id: 1,
        title_en: 'Welcome to LEVELUP RWANDA — Play, Learn & Grow Free',
        title_rw: 'Murakaza neza muri LEVELUP RWANDA — Kina, Wige kandi Utere imbere ku Buntu',
        title_fr: 'Bienvenue sur LEVELUP RWANDA — Jouer, Apprendre et Grandir Gratuitement',
        body_en:
          'Take today’s 3-minute Safe Digital Citizen challenge, explore practical web and career courses, and bookmark verified opportunities across Rwanda.',
        body_rw:
          'Kora irushanwa ry’umunsi ry’umutekano kuri murandasi mu minota 3, wige amasomo ngiro kandi ubike amahirwe yemejwe mu Rwanda.',
        body_fr:
          'Participez au défi quotidien de 3 minutes, suivez des cours pratiques et sauvegardez des opportunités vérifiées.',
        audience: 'all',
        is_active: 1,
        starts_at: null,
        ends_at: null,
        created_by: 3,
        created_at: now,
      },
    ],
    platform_settings: [
      { setting_key: 'maintenance_mode', setting_value_json: { enabled: false }, description: 'Temporarily pause public writes', updated_by: null },
      { setting_key: 'registration_open', setting_value_json: { enabled: true }, description: 'Allow new member sign-ups', updated_by: null },
      { setting_key: 'daily_challenge_xp_cap', setting_value_json: { maxXpPerDay: 500 }, description: 'Daily XP limit from challenges', updated_by: null },
      { setting_key: 'youth_safety_mode', setting_value_json: { strictModerationForUnder18: true }, description: 'Protect youth 13-17 accounts', updated_by: null },
      { setting_key: 'enabled_languages', setting_value_json: { languages: ['rw', 'en', 'fr'] }, description: 'Enabled UI languages', updated_by: null },
    ],
    audit_logs: [],
  };
}

class LocalPlatformStore {
  private state: LocalDatabaseState | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  private getDbFilePath(): string {
    if (process.env.LEVELUP_LOCAL_DB_PATH) {
      return path.resolve(process.env.LEVELUP_LOCAL_DB_PATH);
    }
    return path.resolve(process.cwd(), '.data', 'levelup-db.json');
  }

  private loadState(): LocalDatabaseState {
    if (this.state) {
      return this.state;
    }
    const dbFile = this.getDbFilePath();
    if (fs.existsSync(dbFile)) {
      try {
        const raw = fs.readFileSync(dbFile, 'utf8');
        const parsed = JSON.parse(raw) as LocalDatabaseState;
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.users)) {
          this.state = parsed;
          return this.state;
        }
      } catch {
        // Fall through to clean re-seed if corrupted
      }
    }
    this.state = createInitialSeedState();
    this.persistSync();
    return this.state;
  }

  private persistSync(): void {
    if (!this.state) return;
    const dbFile = this.getDbFilePath();
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    const tmpFile = `${dbFile}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpFile, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmpFile, dbFile);
  }

  private async enqueueWrite<T>(fn: (db: LocalDatabaseState) => Promise<T> | T): Promise<T> {
    let result!: T;
    const nextTask = this.writeQueue.then(async () => {
      const db = this.loadState();
      result = await fn(db);
      this.persistSync();
    });
    this.writeQueue = nextTask.then(
      () => undefined,
      () => undefined,
    );
    await nextTask;
    return result;
  }

  private nextId(db: LocalDatabaseState, table: string): number {
    const current = db.nextIds[table] ?? 1;
    db.nextIds[table] = current + 1;
    return current;
  }

  private recordAudit(
    db: LocalDatabaseState,
    params: {
      actorUserId?: number | null;
      action: string;
      targetType: string;
      targetId?: string | number | null;
      metadata?: Record<string, unknown>;
      ipAddress?: string | null;
    },
  ) {
    db.audit_logs.push({
      id: this.nextId(db, 'audit_logs'),
      actor_user_id: params.actorUserId ?? null,
      action: params.action,
      target_type: params.targetType,
      target_id: params.targetId !== undefined && params.targetId !== null ? String(params.targetId) : null,
      metadata_json: params.metadata ?? {},
      ip_address: params.ipAddress ?? null,
      created_at: new Date().toISOString(),
    });
  }

  private awardXp(
    db: LocalDatabaseState,
    params: {
      userId: number;
      sourceType: string;
      sourceId: number;
      idempotencyKey: string;
      points: number;
      description: string;
    },
  ): { awarded: boolean; newTotalXp: number; newLevel: number } {
    const profile = db.user_profiles.find((p) => p.user_id === params.userId);
    if (!profile) {
      return { awarded: false, newTotalXp: 0, newLevel: 1 };
    }
    if (params.points <= 0) {
      return {
        awarded: false,
        newTotalXp: profile.total_xp,
        newLevel: profile.current_level,
      };
    }
    const existing = db.xp_transactions.find((x) => x.idempotency_key === params.idempotencyKey);
    if (existing) {
      return {
        awarded: false,
        newTotalXp: profile.total_xp,
        newLevel: profile.current_level,
      };
    }
    db.xp_transactions.push({
      id: this.nextId(db, 'xp_transactions'),
      user_id: params.userId,
      source_type: params.sourceType,
      source_id: params.sourceId,
      idempotency_key: params.idempotencyKey,
      points: params.points,
      description: params.description,
      created_at: new Date().toISOString(),
    });
    profile.total_xp += params.points;
    profile.current_level = calculateLevelFromXpLocal(profile.total_xp);
    return {
      awarded: true,
      newTotalXp: profile.total_xp,
      newLevel: profile.current_level,
    };
  }

  private updateStreak(db: LocalDatabaseState, userId: number) {
    const profile = db.user_profiles.find((p) => p.user_id === userId);
    if (!profile) return { currentStreak: 0, longestStreak: 0 };
    const today = todayDateStr();
    const diff = daysDiffFromDateStrings(today, profile.last_challenge_date);
    if (diff === null || diff > 1) {
      profile.current_streak = 1;
    } else if (diff === 1) {
      profile.current_streak += 1;
    } else if (diff === 0 && profile.current_streak === 0) {
      profile.current_streak = 1;
    }
    if (profile.current_streak > profile.longest_streak) {
      profile.longest_streak = profile.current_streak;
    }
    profile.last_challenge_date = today;
    return { currentStreak: profile.current_streak, longestStreak: profile.longest_streak };
  }

  private evaluateAchievements(db: LocalDatabaseState, userId: number) {
    const profile = db.user_profiles.find((p) => p.user_id === userId);
    if (!profile) return [];

    const chCount = db.challenge_submissions.filter((s) => s.user_id === userId).length;
    const courseCount = db.course_enrollments.filter(
      (e) => e.user_id === userId && e.status === 'completed',
    ).length;
    const postCount = db.creative_posts.filter(
      (p) => p.user_id === userId && p.moderation_status !== 'removed',
    ).length;

    const metrics: Record<string, number> = {
      challenges_completed: chCount,
      streak_days: profile.current_streak,
      courses_completed: courseCount,
      posts_created: postCount,
      total_xp: profile.total_xp,
    };

    const alreadyIds = new Set(
      db.user_achievements.filter((ua) => ua.user_id === userId).map((ua) => ua.achievement_id),
    );
    const unlocked: Array<{ slug: string; titleEn: string; xpBonus: number }> = [];

    for (const ach of db.achievements) {
      if (!ach.is_active || alreadyIds.has(ach.id)) continue;
      if ((metrics[ach.rule_type] ?? 0) >= ach.rule_threshold) {
        db.user_achievements.push({
          id: this.nextId(db, 'user_achievements'),
          user_id: userId,
          achievement_id: ach.id,
          unlocked_at: new Date().toISOString(),
        });
        if (ach.xp_bonus > 0) {
          this.awardXp(db, {
            userId,
            sourceType: 'achievement_bonus',
            sourceId: ach.id,
            idempotencyKey: `achievement:${userId}:${ach.id}`,
            points: ach.xp_bonus,
            description: `Achievement unlocked: ${ach.title_en}`,
          });
        }
        db.notifications.push({
          id: this.nextId(db, 'notifications'),
          user_id: userId,
          type: 'achievement',
          title_text: `Achievement unlocked: ${ach.title_en}`,
          body_text: `You earned the ${ach.title_en} badge (+${ach.xp_bonus} XP).`,
          link_url: '/profile',
          is_read: 0,
          read_at: null,
          created_at: new Date().toISOString(),
        });
        unlocked.push({
          slug: ach.slug,
          titleEn: ach.title_en,
          xpBonus: ach.xp_bonus,
        });
      }
    }

    return unlocked;
  }

  // ---------------------------------------------------------------------------
  // Session & Auth
  // ---------------------------------------------------------------------------
  async resolveSessionUser(token: string): Promise<{ user: AuthenticatedUser; sessionId: number } | null> {
    const db = this.loadState();
    const tokenHash = sha256Hex(token);
    const nowMs = Date.now();
    const session = db.user_sessions.find(
      (s) =>
        s.token_hash === tokenHash &&
        !s.revoked_at &&
        new Date(s.expires_at).getTime() > nowMs,
    );
    if (!session) return null;

    const u = db.users.find((x) => x.id === session.user_id);
    const p = db.user_profiles.find((x) => x.user_id === session.user_id);
    if (!u || !p || u.status === 'suspended') return null;

    return {
      sessionId: session.id,
      user: {
        id: u.id,
        email: u.email,
        phone: u.phone,
        role: u.role,
        status: u.status,
        ageGroup: u.age_group,
        preferredLanguage: u.preferred_language,
        contactVerified: Boolean(u.contact_verified),
        displayName: p.display_name,
        username: p.username,
        avatarUrl: p.avatar_url,
        totalXp: p.total_xp,
        currentLevel: p.current_level,
        currentStreak: p.current_streak,
      },
    };
  }

  async hasAnySuperAdmin(): Promise<boolean> {
    const db = this.loadState();
    return db.users.some((u) => u.role === 'super_admin');
  }

  async provisionFirstSuperAdmin(params: {
    email: string;
    displayName: string;
    username: string;
    password: string;
    ipAddress?: string;
  }) {
    const passwordHash = await hashPassword(params.password);
    return this.enqueueWrite((db) => {
      if (db.users.some((u) => u.role === 'super_admin')) {
        throw new Error('A super_admin account has already been provisioned.');
      }
      const email = params.email.toLowerCase();
      const username = params.username.toLowerCase();
      if (db.users.some((u) => u.email === email)) {
        throw new Error('Email is already registered.');
      }
      if (db.user_profiles.some((p) => p.username === username)) {
        throw new Error('Username is already taken.');
      }
      const userId = this.nextId(db, 'users');
      const now = new Date().toISOString();
      db.users.push({
        id: userId,
        email,
        phone: null,
        password_hash: passwordHash,
        role: 'super_admin',
        status: 'active',
        age_group: 'adult_18_plus',
        preferred_language: 'en',
        contact_verified: 1,
        contact_verification_token_hash: null,
        contact_verification_expires_at: null,
        password_reset_token_hash: null,
        password_reset_expires_at: null,
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: null,
        created_at: now,
      });
      db.user_profiles.push({
        user_id: userId,
        display_name: params.displayName,
        username,
        avatar_url: null,
        bio: null,
        district: null,
        interests_json: [],
        skills_json: [],
        profile_visibility: 'community',
        show_activity: 1,
        total_xp: 0,
        current_level: 1,
        current_streak: 0,
        longest_streak: 0,
        last_challenge_date: null,
      });
      db.notification_preferences.push({
        user_id: userId,
        challenge_reminders: 1,
        learning_updates: 1,
        community_activity: 1,
        opportunity_alerts: 1,
        announcements: 1,
      });
      this.recordAudit(db, {
        actorUserId: userId,
        action: 'SUPER_ADMIN_PROVISIONED',
        targetType: 'user',
        targetId: userId,
        metadata: { email, username },
        ipAddress: params.ipAddress || 'cli',
      });
      return { userId, email, username };
    });
  }

  async registerUser(params: {
    email?: string;
    phone?: string;
    displayName: string;
    username: string;
    password: string;
    ageGroup: AgeGroup;
    preferredLanguage: SupportedLanguage;
    district?: string;
    ipAddress?: string;
  }) {
    const email = params.email ? params.email.trim().toLowerCase() : null;
    const phone = params.phone ? params.phone.trim() : null;
    const username = params.username.trim().toLowerCase();
    const passwordHash = await hashPassword(params.password);
    const verificationCode = generateVerificationCode();
    const verificationCodeHash = sha256Hex(verificationCode);

    const userId = await this.enqueueWrite((db) => {
      const regSetting = db.platform_settings.find((s) => s.setting_key === 'registration_open');
      const regVal = regSetting?.setting_value_json as { enabled?: boolean } | undefined;
      if (regVal && regVal.enabled === false) {
        throw new ForbiddenError('New registrations are currently paused by an administrator.');
      }
      if (email && db.users.some((u) => u.email === email)) {
        throw new ConflictError('An account with this email address already exists.');
      }
      if (phone && db.users.some((u) => u.phone === phone)) {
        throw new ConflictError('An account with this phone number already exists.');
      }
      if (db.user_profiles.some((p) => p.username === username)) {
        throw new ConflictError('This username is already taken.');
      }

      const id = this.nextId(db, 'users');
      const now = new Date().toISOString();
      db.users.push({
        id,
        email,
        phone,
        password_hash: passwordHash,
        role: 'member',
        status: 'active',
        age_group: params.ageGroup,
        preferred_language: params.preferredLanguage,
        contact_verified: 0,
        contact_verification_token_hash: verificationCodeHash,
        contact_verification_expires_at: hoursFromNowIso(24),
        password_reset_token_hash: null,
        password_reset_expires_at: null,
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: null,
        created_at: now,
      });
      db.user_profiles.push({
        user_id: id,
        display_name: params.displayName.trim(),
        username,
        avatar_url: null,
        bio: null,
        district: params.district?.trim() || null,
        interests_json: [],
        skills_json: [],
        profile_visibility: 'community',
        show_activity: 1,
        total_xp: 0,
        current_level: 1,
        current_streak: 0,
        longest_streak: 0,
        last_challenge_date: null,
      });
      db.notification_preferences.push({
        user_id: id,
        challenge_reminders: 1,
        learning_updates: 1,
        community_activity: 1,
        opportunity_alerts: 1,
        announcements: 1,
      });
      db.notifications.push({
        id: this.nextId(db, 'notifications'),
        user_id: id,
        type: 'welcome',
        title_text: 'Welcome to LEVELUP RWANDA',
        body_text:
          'Verify your contact details and try today’s Daily Challenge to earn your first XP.',
        link_url: '/play',
        is_read: 0,
        read_at: null,
        created_at: now,
      });
      this.recordAudit(db, {
        actorUserId: id,
        action: 'USER_REGISTERED',
        targetType: 'user',
        targetId: id,
        metadata: { ageGroup: params.ageGroup, preferredLanguage: params.preferredLanguage },
        ipAddress: params.ipAddress,
      });
      return id;
    });

    return {
      userId,
      verificationPreviewCode: appConfig.isProduction ? undefined : verificationCode,
    };
  }

  async loginUser(params: {
    identifier: string;
    password: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const db = this.loadState();
    const idTrimmed = params.identifier.trim();
    const idLower = idTrimmed.toLowerCase();

    const profileMatch = db.user_profiles.find((p) => p.username === idLower);
    const user = db.users.find(
      (u) =>
        u.email === idLower ||
        u.phone === idTrimmed ||
        (profileMatch && u.id === profileMatch.user_id),
    );
    if (!user) {
      throw new UnauthorizedError('Invalid credentials.');
    }
    if (user.status === 'suspended') {
      throw new ForbiddenError('This account has been suspended. Contact support for assistance.');
    }
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      throw new ForbiddenError(
        'Too many failed sign-in attempts. Please wait 15 minutes before trying again.',
      );
    }

    const valid = await verifyPassword(params.password, user.password_hash);
    if (!valid) {
      await this.enqueueWrite((wdb) => {
        const u = wdb.users.find((x) => x.id === user.id);
        if (!u) return;
        const nextAttempts = (u.failed_login_attempts || 0) + 1;
        const shouldLock = nextAttempts >= 5;
        u.failed_login_attempts = nextAttempts;
        u.locked_until = shouldLock ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
        this.recordAudit(wdb, {
          actorUserId: u.id,
          action: 'LOGIN_FAILED',
          targetType: 'user',
          targetId: u.id,
          metadata: { attempts: nextAttempts, locked: shouldLock },
          ipAddress: params.ipAddress,
        });
      });
      throw new UnauthorizedError('Invalid credentials.');
    }

    const rawSessionToken = generateSecureToken(32);
    const tokenHash = sha256Hex(rawSessionToken);

    await this.enqueueWrite((wdb) => {
      const u = wdb.users.find((x) => x.id === user.id)!;
      const now = new Date().toISOString();
      u.failed_login_attempts = 0;
      u.locked_until = null;
      u.last_login_at = now;
      wdb.user_sessions.push({
        id: this.nextId(wdb, 'user_sessions'),
        user_id: u.id,
        token_hash: tokenHash,
        ip_address: params.ipAddress?.slice(0, 64) || null,
        user_agent: params.userAgent?.slice(0, 255) || null,
        expires_at: hoursFromNowIso(appConfig.sessionTtlHours),
        revoked_at: null,
        created_at: now,
      });
      this.recordAudit(wdb, {
        actorUserId: u.id,
        action: 'LOGIN_SUCCESS',
        targetType: 'user',
        targetId: u.id,
        ipAddress: params.ipAddress,
      });
    });

    return { sessionToken: rawSessionToken, userId: user.id };
  }

  async logoutSession(sessionId: number, userId: number, ipAddress?: string): Promise<void> {
    await this.enqueueWrite((db) => {
      const session = db.user_sessions.find((s) => s.id === sessionId);
      if (session) {
        session.revoked_at = new Date().toISOString();
      }
      this.recordAudit(db, {
        actorUserId: userId,
        action: 'LOGOUT',
        targetType: 'session',
        targetId: sessionId,
        ipAddress,
      });
    });
  }

  async verifyUserContact(identifier: string, code: string): Promise<void> {
    const idTrimmed = identifier.trim();
    const idLower = idTrimmed.toLowerCase();
    const codeHash = sha256Hex(code.trim());

    await this.enqueueWrite((db) => {
      const profileMatch = db.user_profiles.find((p) => p.username === idLower);
      const user = db.users.find(
        (u) =>
          u.email === idLower ||
          u.phone === idTrimmed ||
          (profileMatch && u.id === profileMatch.user_id),
      );
      if (!user) throw new NotFoundError('Account not found.');
      if (
        !user.contact_verification_token_hash ||
        user.contact_verification_token_hash !== codeHash ||
        !user.contact_verification_expires_at ||
        new Date(user.contact_verification_expires_at).getTime() < Date.now()
      ) {
        throw new ValidationError('Invalid or expired verification code.');
      }
      user.contact_verified = 1;
      user.contact_verification_token_hash = null;
      user.contact_verification_expires_at = null;
    });
  }

  async requestPasswordReset(identifier: string, ipAddress?: string) {
    const idTrimmed = identifier.trim();
    const idLower = idTrimmed.toLowerCase();
    const resetToken = generateVerificationCode();
    const resetHash = sha256Hex(resetToken);

    const found = await this.enqueueWrite((db) => {
      const profileMatch = db.user_profiles.find((p) => p.username === idLower);
      const user = db.users.find(
        (u) =>
          u.email === idLower ||
          u.phone === idTrimmed ||
          (profileMatch && u.id === profileMatch.user_id),
      );
      if (!user) return false;
      user.password_reset_token_hash = resetHash;
      user.password_reset_expires_at = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      this.recordAudit(db, {
        actorUserId: user.id,
        action: 'PASSWORD_RESET_REQUESTED',
        targetType: 'user',
        targetId: user.id,
        ipAddress,
      });
      return true;
    });

    if (!found) return { requested: true };
    return {
      requested: true,
      resetPreviewCode: appConfig.isProduction ? undefined : resetToken,
    };
  }

  async confirmPasswordReset(params: {
    identifier: string;
    token: string;
    newPassword: string;
    ipAddress?: string;
  }) {
    const idTrimmed = params.identifier.trim();
    const idLower = idTrimmed.toLowerCase();
    const tokenHash = sha256Hex(params.token.trim());
    const newPasswordHash = await hashPassword(params.newPassword);

    await this.enqueueWrite((db) => {
      const profileMatch = db.user_profiles.find((p) => p.username === idLower);
      const user = db.users.find(
        (u) =>
          u.email === idLower ||
          u.phone === idTrimmed ||
          (profileMatch && u.id === profileMatch.user_id),
      );
      if (
        !user ||
        !user.password_reset_token_hash ||
        user.password_reset_token_hash !== tokenHash ||
        !user.password_reset_expires_at ||
        new Date(user.password_reset_expires_at).getTime() < Date.now()
      ) {
        throw new ValidationError('Invalid or expired password reset code.');
      }
      user.password_hash = newPasswordHash;
      user.password_reset_token_hash = null;
      user.password_reset_expires_at = null;
      user.failed_login_attempts = 0;
      user.locked_until = null;
      const now = new Date().toISOString();
      for (const s of db.user_sessions) {
        if (s.user_id === user.id && !s.revoked_at) {
          s.revoked_at = now;
        }
      }
      this.recordAudit(db, {
        actorUserId: user.id,
        action: 'PASSWORD_RESET_COMPLETED',
        targetType: 'user',
        targetId: user.id,
        ipAddress: params.ipAddress,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Challenges & Leaderboard
  // ---------------------------------------------------------------------------
  async listChallengeCategories() {
    const db = this.loadState();
    return db.challenge_categories
      .filter((c) => c.is_active === 1)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  async listChallenges(params: {
    categorySlug?: string;
    difficulty?: string;
    challengeType?: string;
    search?: string;
    userId?: number;
  }) {
    const db = this.loadState();
    const catById = new Map(db.challenge_categories.map((c) => [c.id, c]));

    return db.challenges
      .filter((c) => {
        if (c.status !== 'published') return false;
        const cat = catById.get(c.category_id);
        if (!cat) return false;
        if (params.categorySlug && cat.slug !== params.categorySlug) return false;
        if (params.difficulty && c.difficulty !== params.difficulty) return false;
        if (params.challengeType && c.challenge_type !== params.challengeType) return false;
        if (params.search && params.search.trim()) {
          const q = params.search.trim().toLowerCase();
          const hay = `${c.title_en} ${c.title_rw} ${c.title_fr} ${c.description_en}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (b.is_featured !== a.is_featured) return b.is_featured - a.is_featured;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })
      .map((c) => {
        const cat = catById.get(c.category_id)!;
        const qCount = db.challenge_questions.filter((q) => q.challenge_id === c.id).length;
        const sub = params.userId
          ? db.challenge_submissions.find((s) => s.challenge_id === c.id && s.user_id === params.userId)
          : undefined;
        return {
          ...c,
          category_slug: cat.slug,
          category_name_en: cat.name_en,
          category_name_rw: cat.name_rw,
          category_name_fr: cat.name_fr,
          question_count: qCount,
          ...(params.userId
            ? {
                submission_id: sub?.id ?? null,
                user_score: sub?.score ?? null,
                user_max_score: sub?.max_score ?? null,
                user_xp_awarded: sub?.xp_awarded ?? null,
                user_submitted_at: sub?.submitted_at ?? null,
              }
            : {}),
        };
      });
  }

  async getChallengeDetail(slug: string, userId?: number) {
    const db = this.loadState();
    const challenge = db.challenges.find((c) => c.slug === slug && c.status === 'published');
    if (!challenge) throw new NotFoundError('Challenge not found.');

    const cat = db.challenge_categories.find((c) => c.id === challenge.category_id)!;
    const sub = userId
      ? db.challenge_submissions.find((s) => s.challenge_id === challenge.id && s.user_id === userId) ||
        null
      : null;

    const questions = db.challenge_questions
      .filter((q) => q.challenge_id === challenge.id)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
      .map((q) => ({
        id: q.id,
        prompt_en: q.prompt_en,
        prompt_rw: q.prompt_rw,
        prompt_fr: q.prompt_fr,
        options: q.options_json,
        points_weight: q.points_weight,
        sort_order: q.sort_order,
        ...(sub
          ? {
              correct_option_index: q.correct_option_index,
              explanation_en: q.explanation_en,
              explanation_rw: q.explanation_rw,
              explanation_fr: q.explanation_fr,
            }
          : {}),
      }));

    return {
      challenge: {
        ...challenge,
        category_slug: cat.slug,
        category_name_en: cat.name_en,
        category_name_rw: cat.name_rw,
        category_name_fr: cat.name_fr,
      },
      questions,
      userSubmission: sub ? { ...sub, answers: sub.answers_json } : null,
    };
  }

  async submitChallengeAttempt(
    params: {
      slug: string;
      userId: number;
      answers: Array<{ questionId: number; selectedOptionIndex: number }>;
      durationSeconds: number;
    },
    evaluateFn: (
      questions: Array<{
        id: number;
        correctOptionIndex: number;
        pointsWeight: number;
        explanationEn: string;
        explanationRw: string;
        explanationFr: string;
      }>,
      answers: Array<{ questionId: number; selectedOptionIndex: number }>,
      xpReward: number,
    ) => {
      score: number;
      maxScore: number;
      correctCount: number;
      totalQuestions: number;
      xpAwarded: number;
      breakdown: any[];
    },
  ) {
    return this.enqueueWrite((db) => {
      const challenge = db.challenges.find(
        (c) => c.slug === params.slug && c.status === 'published',
      );
      if (!challenge) throw new NotFoundError('Challenge not found.');

      const existing = db.challenge_submissions.find(
        (s) => s.challenge_id === challenge.id && s.user_id === params.userId,
      );
      if (existing) {
        throw new ConflictError('You have already submitted an attempt for this challenge.');
      }

      const qRows = db.challenge_questions
        .filter((q) => q.challenge_id === challenge.id)
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

      if (qRows.length === 0) {
        throw new ValidationError('This challenge does not have questions yet.');
      }

      const evaluation = evaluateFn(
        qRows.map((q) => ({
          id: q.id,
          correctOptionIndex: q.correct_option_index,
          pointsWeight: q.points_weight,
          explanationEn: q.explanation_en,
          explanationRw: q.explanation_rw,
          explanationFr: q.explanation_fr,
        })),
        params.answers,
        challenge.xp_reward,
      );

      db.challenge_submissions.push({
        id: this.nextId(db, 'challenge_submissions'),
        challenge_id: challenge.id,
        user_id: params.userId,
        answers_json: params.answers,
        score: evaluation.score,
        max_score: evaluation.maxScore,
        correct_count: evaluation.correctCount,
        total_questions: evaluation.totalQuestions,
        duration_seconds: Math.min(params.durationSeconds, challenge.time_limit_seconds + 60),
        xp_awarded: evaluation.xpAwarded,
        submitted_at: new Date().toISOString(),
      });

      const xpRes = this.awardXp(db, {
        userId: params.userId,
        sourceType: 'challenge_completion',
        sourceId: challenge.id,
        idempotencyKey: `challenge:${params.userId}:${challenge.id}`,
        points: evaluation.xpAwarded,
        description: `Completed challenge: ${challenge.title_en}`,
      });

      const streakRes = this.updateStreak(db, params.userId);
      const unlockedAchievements = this.evaluateAchievements(db, params.userId);

      return {
        ...evaluation,
        newTotalXp: xpRes.newTotalXp,
        newLevel: xpRes.newLevel,
        currentStreak: streakRes.currentStreak,
        unlockedAchievements,
      };
    });
  }

  async getLeaderboard(period: 'daily' | 'weekly' | 'monthly' | 'all') {
    const db = this.loadState();
    const activeUsers = new Set(db.users.filter((u) => u.status === 'active').map((u) => u.id));

    if (period === 'all') {
      return db.user_profiles
        .filter((p) => activeUsers.has(p.user_id) && p.profile_visibility !== 'private')
        .sort((a, b) => b.total_xp - a.total_xp || b.current_streak - a.current_streak)
        .slice(0, 25)
        .map((p) => ({
          user_id: p.user_id,
          display_name: p.display_name,
          username: p.username,
          avatar_url: p.avatar_url,
          district: p.district,
          period_xp: p.total_xp,
          current_level: p.current_level,
          current_streak: p.current_streak,
        }));
    }

    const now = Date.now();
    const startMs =
      period === 'daily'
        ? new Date(`${todayDateStr()}T00:00:00Z`).getTime()
        : period === 'weekly'
          ? now - 7 * 24 * 60 * 60 * 1000
          : now - 30 * 24 * 60 * 60 * 1000;

    const xpByUser = new Map<number, number>();
    for (const xt of db.xp_transactions) {
      if (new Date(xt.created_at).getTime() >= startMs) {
        xpByUser.set(xt.user_id, (xpByUser.get(xt.user_id) ?? 0) + xt.points);
      }
    }

    return db.user_profiles
      .filter(
        (p) =>
          activeUsers.has(p.user_id) &&
          p.profile_visibility !== 'private' &&
          (xpByUser.get(p.user_id) ?? 0) > 0,
      )
      .map((p) => ({
        user_id: p.user_id,
        display_name: p.display_name,
        username: p.username,
        avatar_url: p.avatar_url,
        district: p.district,
        period_xp: xpByUser.get(p.user_id) ?? 0,
        current_level: p.current_level,
        current_streak: p.current_streak,
      }))
      .sort((a, b) => b.period_xp - a.period_xp)
      .slice(0, 25);
  }

  // ---------------------------------------------------------------------------
  // Courses & Learning
  // ---------------------------------------------------------------------------
  async listCourseCategories() {
    const db = this.loadState();
    return db.course_categories
      .filter((c) => c.is_active === 1)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  async listCourses(params: {
    categorySlug?: string;
    level?: string;
    search?: string;
    userId?: number;
  }) {
    const db = this.loadState();
    const catById = new Map(db.course_categories.map((c) => [c.id, c]));

    return db.courses
      .filter((c) => {
        if (c.status !== 'published') return false;
        const cat = catById.get(c.category_id);
        if (!cat) return false;
        if (params.categorySlug && cat.slug !== params.categorySlug) return false;
        if (params.level && c.level !== params.level) return false;
        if (params.search && params.search.trim()) {
          const q = params.search.trim().toLowerCase();
          const hay = `${c.title_en} ${c.title_rw} ${c.title_fr} ${c.summary_en}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((c) => {
        const cat = catById.get(c.category_id)!;
        const lessonCount = db.course_lessons.filter((l) => l.course_id === c.id).length;
        const enrollment = params.userId
          ? db.course_enrollments.find((e) => e.course_id === c.id && e.user_id === params.userId)
          : undefined;
        return {
          ...c,
          category_slug: cat.slug,
          category_name_en: cat.name_en,
          category_name_rw: cat.name_rw,
          category_name_fr: cat.name_fr,
          lesson_count: lessonCount,
          ...(params.userId
            ? {
                enrollment_status: enrollment?.status ?? null,
                enrollment_progress: enrollment?.progress_percent ?? null,
              }
            : {}),
        };
      });
  }

  async getCourseDetail(slug: string, userId?: number) {
    const db = this.loadState();
    const course = db.courses.find((c) => c.slug === slug && c.status === 'published');
    if (!course) throw new NotFoundError('Course not found.');

    const cat = db.course_categories.find((c) => c.id === course.category_id)!;
    const modules = db.course_modules
      .filter((m) => m.course_id === course.id)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const lessonsRaw = db.course_lessons
      .filter((l) => l.course_id === course.id)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

    const enrollment = userId
      ? db.course_enrollments.find((e) => e.course_id === course.id && e.user_id === userId) || null
      : null;

    const completedLessonIds = new Set(
      enrollment
        ? db.lesson_progress
            .filter((lp) => lp.enrollment_id === enrollment.id && lp.completed === 1)
            .map((lp) => lp.lesson_id)
        : [],
    );

    const lessons = lessonsRaw.map((l) => {
      const isCompleted = completedLessonIds.has(l.id);
      const assessment = l.assessment_question_json;
      return {
        id: l.id,
        moduleId: l.module_id,
        titleEn: l.title_en,
        titleRw: l.title_rw,
        titleFr: l.title_fr,
        contentEn: l.content_en,
        contentRw: l.content_rw,
        contentFr: l.content_fr,
        durationMinutes: l.duration_minutes,
        xpReward: l.xp_reward,
        sortOrder: l.sort_order,
        completed: isCompleted,
        assessment: assessment
          ? {
              question: assessment.question,
              options: assessment.options,
              ...(isCompleted
                ? { correctIndex: assessment.correctIndex, explanation: assessment.explanation }
                : {}),
            }
          : null,
      };
    });

    return {
      course: {
        ...course,
        category_slug: cat.slug,
        category_name_en: cat.name_en,
        category_name_rw: cat.name_rw,
        category_name_fr: cat.name_fr,
      },
      modules,
      lessons,
      enrollment,
    };
  }

  async enrollInCourse(slug: string, userId: number) {
    return this.enqueueWrite((db) => {
      const course = db.courses.find((c) => c.slug === slug && c.status === 'published');
      if (!course) throw new NotFoundError('Course not found.');

      let enrollment = db.course_enrollments.find(
        (e) => e.course_id === course.id && e.user_id === userId,
      );
      if (!enrollment) {
        enrollment = {
          id: this.nextId(db, 'course_enrollments'),
          course_id: course.id,
          user_id: userId,
          status: 'enrolled',
          progress_percent: 0,
          enrolled_at: new Date().toISOString(),
          completed_at: null,
        };
        db.course_enrollments.push(enrollment);
      }
      return enrollment;
    });
  }

  async completeLesson(params: {
    slug: string;
    lessonId: number;
    userId: number;
    selectedOptionIndex?: number;
  }) {
    return this.enqueueWrite((db) => {
      const course = db.courses.find((c) => c.slug === params.slug && c.status === 'published');
      if (!course) throw new NotFoundError('Course not found.');

      const lesson = db.course_lessons.find(
        (l) => l.id === params.lessonId && l.course_id === course.id,
      );
      if (!lesson) throw new NotFoundError('Lesson not found in this course.');

      let enrollment = db.course_enrollments.find(
        (e) => e.course_id === course.id && e.user_id === params.userId,
      );
      if (!enrollment) {
        enrollment = {
          id: this.nextId(db, 'course_enrollments'),
          course_id: course.id,
          user_id: params.userId,
          status: 'enrolled',
          progress_percent: 0,
          enrolled_at: new Date().toISOString(),
          completed_at: null,
        };
        db.course_enrollments.push(enrollment);
      }

      const assessment = lesson.assessment_question_json;
      let explanation: string | undefined;
      if (assessment && Array.isArray(assessment.options) && assessment.options.length > 0) {
        if (params.selectedOptionIndex === undefined) {
          throw new ValidationError('Please select an answer to the lesson check question.');
        }
        explanation = assessment.explanation;
        if (params.selectedOptionIndex !== assessment.correctIndex) {
          return {
            passed: false,
            explanation,
            xpAwarded: 0,
            courseCompleted: false,
            progressPercent: enrollment.progress_percent,
          };
        }
      }

      const existingLp = db.lesson_progress.find(
        (lp) => lp.enrollment_id === enrollment!.id && lp.lesson_id === lesson.id,
      );
      if (!existingLp) {
        db.lesson_progress.push({
          id: this.nextId(db, 'lesson_progress'),
          enrollment_id: enrollment.id,
          lesson_id: lesson.id,
          user_id: params.userId,
          completed: 1,
          assessment_passed: 1,
          assessment_score: 100,
        });
      }

      const lessonXpRes = this.awardXp(db, {
        userId: params.userId,
        sourceType: 'lesson_completion',
        sourceId: lesson.id,
        idempotencyKey: `lesson:${params.userId}:${lesson.id}`,
        points: lesson.xp_reward || 20,
        description: `Completed lesson: ${lesson.title_en}`,
      });

      const totalLessons = Math.max(
        1,
        db.course_lessons.filter((l) => l.course_id === course.id).length,
      );
      const doneLessons = db.lesson_progress.filter(
        (lp) => lp.enrollment_id === enrollment!.id && lp.completed === 1,
      ).length;

      const progressPercent = Math.min(100, Math.round((doneLessons / totalLessons) * 100));
      const isNowComplete = doneLessons >= totalLessons;
      enrollment.progress_percent = progressPercent;
      enrollment.status = isNowComplete ? 'completed' : 'enrolled';
      if (isNowComplete && !enrollment.completed_at) {
        enrollment.completed_at = new Date().toISOString();
      }

      let courseXpAwarded = 0;
      if (isNowComplete) {
        const courseXpRes = this.awardXp(db, {
          userId: params.userId,
          sourceType: 'course_completion',
          sourceId: course.id,
          idempotencyKey: `course:${params.userId}:${course.id}`,
          points: course.xp_reward || 100,
          description: `Completed course: ${course.title_en}`,
        });
        if (courseXpRes.awarded) {
          courseXpAwarded = course.xp_reward || 100;
        }
      }

      const unlockedAchievements = this.evaluateAchievements(db, params.userId);

      return {
        passed: true,
        explanation,
        xpAwarded: (lessonXpRes.awarded ? lesson.xp_reward || 20 : 0) + courseXpAwarded,
        courseCompleted: isNowComplete,
        progressPercent,
        unlockedAchievements,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Community (Posts, Reactions, Comments, Groups, Safety)
  // ---------------------------------------------------------------------------
  async listPosts(params: {
    postType?: 'create_showcase' | 'discussion';
    category?: string;
    groupId?: number;
    search?: string;
    viewerUserId?: number;
    limit?: number;
    offset?: number;
  }) {
    const db = this.loadState();
    const userById = new Map(db.users.map((u) => [u.id, u]));
    const profileById = new Map(db.user_profiles.map((p) => [p.user_id, p]));
    const groupById = new Map(db.community_groups.map((g) => [g.id, g]));
    const blockedIds = new Set(
      params.viewerUserId
        ? db.user_blocks.filter((b) => b.blocker_id === params.viewerUserId).map((b) => b.blocked_id)
        : [],
    );

    const limit = Math.min(50, Math.max(1, params.limit ?? 20));
    const offset = Math.max(0, params.offset ?? 0);

    return db.creative_posts
      .filter((p) => {
        const author = userById.get(p.user_id);
        if (!author || author.status !== 'active') return false;
        if (p.moderation_status !== 'approved') return false;
        if (params.postType && p.post_type !== params.postType) return false;
        if (params.category && p.category !== params.category) return false;
        if (params.groupId && p.group_id !== params.groupId) return false;
        if (blockedIds.has(p.user_id)) return false;
        if (params.search && params.search.trim()) {
          const q = params.search.trim().toLowerCase();
          if (!`${p.title} ${p.body}`.toLowerCase().includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(offset, offset + limit)
      .map((p) => {
        const prof = profileById.get(p.user_id);
        const grp = p.group_id ? groupById.get(p.group_id) : undefined;
        const reaction = params.viewerUserId
          ? db.post_reactions.find((r) => r.post_id === p.id && r.user_id === params.viewerUserId)
          : undefined;
        return {
          ...p,
          author_name: prof?.display_name ?? 'Member',
          author_username: prof?.username ?? 'member',
          author_avatar: prof?.avatar_url ?? null,
          group_name: grp?.name ?? null,
          ...(params.viewerUserId ? { user_reaction: reaction?.reaction_type ?? null } : {}),
        };
      });
  }

  async createPost(params: {
    userId: number;
    postType: 'create_showcase' | 'discussion';
    category: string;
    title: string;
    body: string;
    groupId?: number | null;
    mediaUrl?: string | null;
    mediaMime?: string | null;
  }) {
    return this.enqueueWrite((db) => {
      if (params.groupId) {
        const grp = db.community_groups.find(
          (g) => g.id === params.groupId && g.status === 'active',
        );
        if (!grp) throw new NotFoundError('Group not found.');
      }

      const postId = this.nextId(db, 'creative_posts');
      db.creative_posts.push({
        id: postId,
        user_id: params.userId,
        group_id: params.groupId ?? null,
        post_type: params.postType,
        category: params.category,
        title: params.title,
        body: params.body,
        media_url: params.mediaUrl ?? null,
        media_mime: params.mediaMime ?? null,
        likes_count: 0,
        comments_count: 0,
        moderation_status: 'approved',
        is_sample: 0,
        created_at: new Date().toISOString(),
      });

      const todayStartMs = new Date(`${todayDateStr()}T00:00:00Z`).getTime();
      const todayPosts = db.xp_transactions.filter(
        (xt) =>
          xt.user_id === params.userId &&
          xt.source_type === 'community_post' &&
          new Date(xt.created_at).getTime() >= todayStartMs,
      ).length;

      if (todayPosts < 3) {
        this.awardXp(db, {
          userId: params.userId,
          sourceType: 'community_post',
          sourceId: postId,
          idempotencyKey: `post:${params.userId}:${postId}`,
          points: 15,
          description: `Published community post: ${params.title}`,
        });
      }

      this.evaluateAchievements(db, params.userId);
      return { id: postId };
    });
  }

  async togglePostReaction(params: {
    postId: number;
    userId: number;
    reactionType: 'like' | 'celebrate' | 'helpful';
  }) {
    return this.enqueueWrite((db) => {
      const post = db.creative_posts.find(
        (p) => p.id === params.postId && p.moderation_status === 'approved',
      );
      if (!post) throw new NotFoundError('Post not found.');

      const idx = db.post_reactions.findIndex(
        (r) => r.post_id === params.postId && r.user_id === params.userId,
      );
      let activeReaction: string | null = params.reactionType;

      if (idx >= 0 && db.post_reactions[idx].reaction_type === params.reactionType) {
        db.post_reactions.splice(idx, 1);
        activeReaction = null;
      } else if (idx >= 0) {
        db.post_reactions[idx].reaction_type = params.reactionType;
      } else {
        db.post_reactions.push({
          id: this.nextId(db, 'post_reactions'),
          post_id: params.postId,
          user_id: params.userId,
          reaction_type: params.reactionType,
          created_at: new Date().toISOString(),
        });
      }

      const likesCount = db.post_reactions.filter((r) => r.post_id === params.postId).length;
      post.likes_count = likesCount;
      return { likesCount, activeReaction };
    });
  }

  async listComments(postId: number, viewerUserId?: number) {
    const db = this.loadState();
    const profileById = new Map(db.user_profiles.map((p) => [p.user_id, p]));
    const blockedIds = new Set(
      viewerUserId
        ? db.user_blocks.filter((b) => b.blocker_id === viewerUserId).map((b) => b.blocked_id)
        : [],
    );

    return db.post_comments
      .filter(
        (c) =>
          c.post_id === postId &&
          c.moderation_status === 'visible' &&
          !blockedIds.has(c.user_id),
      )
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((c) => {
        const prof = profileById.get(c.user_id);
        return {
          ...c,
          author_name: prof?.display_name ?? 'Member',
          author_username: prof?.username ?? 'member',
          author_avatar: prof?.avatar_url ?? null,
        };
      });
  }

  async addComment(params: { postId: number; userId: number; body: string }) {
    return this.enqueueWrite((db) => {
      const post = db.creative_posts.find(
        (p) => p.id === params.postId && p.moderation_status === 'approved',
      );
      if (!post) throw new NotFoundError('Post not found.');

      const id = this.nextId(db, 'post_comments');
      db.post_comments.push({
        id,
        post_id: params.postId,
        user_id: params.userId,
        body: params.body,
        moderation_status: 'visible',
        created_at: new Date().toISOString(),
      });

      const commentsCount = db.post_comments.filter(
        (c) => c.post_id === params.postId && c.moderation_status === 'visible',
      ).length;
      post.comments_count = commentsCount;

      if (post.user_id !== params.userId) {
        db.notifications.push({
          id: this.nextId(db, 'notifications'),
          user_id: post.user_id,
          type: 'comment',
          title_text: 'New comment on your post',
          body_text: `Someone commented on "${post.title}".`,
          link_url: post.post_type === 'create_showcase' ? '/create' : '/connect',
          is_read: 0,
          read_at: null,
          created_at: new Date().toISOString(),
        });
      }

      return { id, commentsCount };
    });
  }

  async listGroups(viewerUserId?: number) {
    const db = this.loadState();
    const joinedSet = new Set(
      viewerUserId
        ? db.group_memberships.filter((m) => m.user_id === viewerUserId).map((m) => m.group_id)
        : [],
    );

    return db.community_groups
      .filter((g) => g.status === 'active')
      .sort((a, b) => b.member_count - a.member_count || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((g) => ({
        ...g,
        ...(viewerUserId ? { is_member: joinedSet.has(g.id) ? 1 : 0 } : {}),
      }));
  }

  async createGroup(params: {
    userId: number;
    name: string;
    description: string;
    category: string;
    isPrivate: boolean;
  }) {
    const baseSlug = params.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 70);
    const slug = `${baseSlug || 'group'}-${Date.now().toString(36)}`;

    return this.enqueueWrite((db) => {
      const groupId = this.nextId(db, 'community_groups');
      const now = new Date().toISOString();
      db.community_groups.push({
        id: groupId,
        slug,
        name: params.name,
        description: params.description,
        category: params.category,
        created_by: params.userId,
        is_private: params.isPrivate ? 1 : 0,
        member_count: 1,
        is_sample: 0,
        status: 'active',
        created_at: now,
      });
      db.group_memberships.push({
        id: this.nextId(db, 'group_memberships'),
        group_id: groupId,
        user_id: params.userId,
        role: 'moderator',
        created_at: now,
      });
      return { id: groupId, slug };
    });
  }

  async toggleGroupMembership(groupId: number, userId: number) {
    return this.enqueueWrite((db) => {
      const group = db.community_groups.find((g) => g.id === groupId && g.status === 'active');
      if (!group) throw new NotFoundError('Group not found.');

      const idx = db.group_memberships.findIndex(
        (m) => m.group_id === groupId && m.user_id === userId,
      );
      let joined = false;
      if (idx >= 0) {
        db.group_memberships.splice(idx, 1);
        joined = false;
      } else {
        db.group_memberships.push({
          id: this.nextId(db, 'group_memberships'),
          group_id: groupId,
          user_id: userId,
          role: 'member',
          created_at: new Date().toISOString(),
        });
        joined = true;
      }
      const memberCount = db.group_memberships.filter((m) => m.group_id === groupId).length;
      group.member_count = memberCount;
      return { joined, memberCount };
    });
  }

  async toggleFollowUser(followerId: number, targetUserId: number) {
    if (followerId === targetUserId) {
      throw new ForbiddenError('You cannot follow yourself.');
    }
    return this.enqueueWrite((db) => {
      const idx = db.user_follows.findIndex(
        (f) => f.follower_id === followerId && f.following_id === targetUserId,
      );
      if (idx >= 0) {
        db.user_follows.splice(idx, 1);
        return { following: false };
      }
      db.user_follows.push({
        id: this.nextId(db, 'user_follows'),
        follower_id: followerId,
        following_id: targetUserId,
        created_at: new Date().toISOString(),
      });
      return { following: true };
    });
  }

  async blockUser(blockerId: number, blockedId: number, reason?: string) {
    if (blockerId === blockedId) {
      throw new ForbiddenError('You cannot block yourself.');
    }
    await this.enqueueWrite((db) => {
      const exists = db.user_blocks.some(
        (b) => b.blocker_id === blockerId && b.blocked_id === blockedId,
      );
      if (!exists) {
        db.user_blocks.push({
          id: this.nextId(db, 'user_blocks'),
          blocker_id: blockerId,
          blocked_id: blockedId,
          reason: reason ?? null,
          created_at: new Date().toISOString(),
        });
      }
      db.user_follows = db.user_follows.filter(
        (f) =>
          !(
            (f.follower_id === blockerId && f.following_id === blockedId) ||
            (f.follower_id === blockedId && f.following_id === blockerId)
          ),
      );
    });
  }

  async unblockUser(blockerId: number, blockedId: number) {
    await this.enqueueWrite((db) => {
      db.user_blocks = db.user_blocks.filter(
        (b) => !(b.blocker_id === blockerId && b.blocked_id === blockedId),
      );
    });
  }

  async createContentReport(params: {
    reporterId: number;
    targetType: 'post' | 'comment' | 'user' | 'opportunity';
    targetId: number;
    reason: string;
    details?: string;
  }) {
    return this.enqueueWrite((db) => {
      const dup = db.content_reports.some(
        (r) =>
          r.reporter_id === params.reporterId &&
          r.target_type === params.targetType &&
          r.target_id === params.targetId &&
          (r.status === 'open' || r.status === 'reviewing'),
      );
      if (dup) {
        throw new ConflictError('You have already submitted an active report for this item.');
      }
      const id = this.nextId(db, 'content_reports');
      db.content_reports.push({
        id,
        reporter_id: params.reporterId,
        target_type: params.targetType,
        target_id: params.targetId,
        reason: params.reason,
        details: params.details ?? null,
        status: 'open',
        reviewed_by: null,
        resolution_note: null,
        created_at: new Date().toISOString(),
      });
      return { id };
    });
  }

  // ---------------------------------------------------------------------------
  // Opportunities
  // ---------------------------------------------------------------------------
  async listOpportunityCategories() {
    const db = this.loadState();
    return [...db.opportunity_categories].sort((a, b) => a.sort_order - b.sort_order);
  }

  async listOpportunities(params: {
    type?: string;
    categorySlug?: string;
    remoteOnly?: boolean;
    verifiedOnly?: boolean;
    includeExpired?: boolean;
    search?: string;
    userId?: number;
  }) {
    const db = this.loadState();
    const catById = new Map(db.opportunity_categories.map((c) => [c.id, c]));
    const savedSet = new Set(
      params.userId
        ? db.saved_opportunities.filter((s) => s.user_id === params.userId).map((s) => s.opportunity_id)
        : [],
    );
    const nowMs = Date.now();

    return db.opportunities
      .filter((o) => {
        if (o.approval_status !== 'approved') return false;
        const cat = catById.get(o.category_id);
        if (!cat) return false;
        if (params.type && o.opportunity_type !== params.type) return false;
        if (params.categorySlug && cat.slug !== params.categorySlug) return false;
        if (params.remoteOnly && !o.is_remote) return false;
        if (params.verifiedOnly && o.verified_status !== 'verified') return false;
        if (!params.includeExpired && o.deadline_at && new Date(o.deadline_at).getTime() < nowMs) {
          return false;
        }
        if (params.search && params.search.trim()) {
          const q = params.search.trim().toLowerCase();
          const hay = `${o.title} ${o.organization_name} ${o.summary} ${o.location}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (b.is_featured !== a.is_featured) return b.is_featured - a.is_featured;
        if (a.deadline_at && !b.deadline_at) return -1;
        if (!a.deadline_at && b.deadline_at) return 1;
        if (a.deadline_at && b.deadline_at) {
          return new Date(a.deadline_at).getTime() - new Date(b.deadline_at).getTime();
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })
      .map((o) => {
        const cat = catById.get(o.category_id)!;
        const isExpired = Boolean(o.deadline_at && new Date(o.deadline_at).getTime() < nowMs);
        return {
          ...o,
          is_expired: isExpired ? 1 : 0,
          category_slug: cat.slug,
          category_name_en: cat.name_en,
          category_name_rw: cat.name_rw,
          category_name_fr: cat.name_fr,
          ...(params.userId ? { is_saved: savedSet.has(o.id) ? 1 : 0 } : {}),
        };
      });
  }

  async submitOpportunity(params: {
    userId: number;
    categoryId: number;
    opportunityType: string;
    title: string;
    organizationName: string;
    location: string;
    isRemote: boolean;
    summary: string;
    eligibility: string;
    applicationUrl: string;
    deadlineAt?: string | null;
    autoApprove?: boolean;
  }) {
    return this.enqueueWrite((db) => {
      const id = this.nextId(db, 'opportunities');
      db.opportunities.push({
        id,
        category_id: params.categoryId,
        opportunity_type: params.opportunityType,
        title: params.title,
        organization_name: params.organizationName,
        location: params.location,
        is_remote: params.isRemote ? 1 : 0,
        summary: params.summary,
        eligibility: params.eligibility,
        application_url: params.applicationUrl,
        deadline_at: params.deadlineAt || null,
        approval_status: params.autoApprove ? 'approved' : 'pending',
        verified_status: params.autoApprove ? 'verified' : 'unverified',
        is_featured: 0,
        is_sample: 0,
        submitted_by: params.userId,
        approved_by: params.autoApprove ? params.userId : null,
        created_at: new Date().toISOString(),
      });
      return { id, status: params.autoApprove ? 'approved' : 'pending' };
    });
  }

  async toggleSavedOpportunity(opportunityId: number, userId: number) {
    return this.enqueueWrite((db) => {
      const opp = db.opportunities.find((o) => o.id === opportunityId);
      if (!opp) throw new NotFoundError('Opportunity not found.');

      const idx = db.saved_opportunities.findIndex(
        (s) => s.opportunity_id === opportunityId && s.user_id === userId,
      );
      if (idx >= 0) {
        db.saved_opportunities.splice(idx, 1);
        return { saved: false };
      }
      db.saved_opportunities.push({
        id: this.nextId(db, 'saved_opportunities'),
        opportunity_id: opportunityId,
        user_id: userId,
        created_at: new Date().toISOString(),
      });
      return { saved: true };
    });
  }

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------
  async getUnifiedDashboard(userId?: number) {
    const db = this.loadState();
    const [challenges, courses, posts, opportunities] = await Promise.all([
      this.listChallenges({ userId }),
      this.listCourses({ userId }),
      this.listPosts({ viewerUserId: userId, limit: 4 }),
      this.listOpportunities({ userId }),
    ]);

    const nowMs = Date.now();
    const announcements = db.announcements
      .filter((a) => {
        if (!a.is_active) return false;
        if (a.starts_at && new Date(a.starts_at).getTime() > nowMs) return false;
        if (a.ends_at && new Date(a.ends_at).getTime() < nowMs) return false;
        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 3);

    const featuredChallenge = challenges.find((c) => c.is_featured) || challenges[0] || null;
    const recommendedCourses = courses.slice(0, 3);
    const featuredOpportunities = opportunities.slice(0, 4);

    let userSummary: Record<string, unknown> | null = null;
    let recentAchievements: any[] = [];

    if (userId) {
      userSummary = {
        challengesCompleted: db.challenge_submissions.filter((s) => s.user_id === userId).length,
        coursesCompleted: db.course_enrollments.filter(
          (e) => e.user_id === userId && e.status === 'completed',
        ).length,
        coursesInProgress: db.course_enrollments.filter(
          (e) => e.user_id === userId && e.status === 'enrolled',
        ).length,
        postsCreated: db.creative_posts.filter(
          (p) => p.user_id === userId && p.moderation_status !== 'removed',
        ).length,
        savedOpportunities: db.saved_opportunities.filter((s) => s.user_id === userId).length,
      };

      const achById = new Map(db.achievements.map((a) => [a.id, a]));
      recentAchievements = db.user_achievements
        .filter((ua) => ua.user_id === userId)
        .sort((a, b) => new Date(b.unlocked_at).getTime() - new Date(a.unlocked_at).getTime())
        .slice(0, 6)
        .map((ua) => {
          const a = achById.get(ua.achievement_id)!;
          return {
            slug: a.slug,
            title_en: a.title_en,
            title_rw: a.title_rw,
            title_fr: a.title_fr,
            badge_tier: a.badge_tier,
            icon_name: a.icon_name,
            unlocked_at: ua.unlocked_at,
          };
        });
    }

    return {
      featuredChallenge,
      recommendedCourses,
      recentCommunityActivity: posts,
      featuredOpportunities,
      announcements,
      userSummary,
      recentAchievements,
    };
  }

  // ---------------------------------------------------------------------------
  // Profile
  // ---------------------------------------------------------------------------
  async getUserProfileByUsername(
    username: string,
    viewerUserId: number | undefined,
    xpRangeFn: (level: number) => { currentLevelMinXp: number; nextLevelMinXp: number },
  ) {
    const db = this.loadState();
    const prof = db.user_profiles.find((p) => p.username === username.toLowerCase());
    if (!prof) throw new NotFoundError('User profile not found.');

    const u = db.users.find((x) => x.id === prof.user_id);
    if (!u) throw new NotFoundError('User profile not found.');

    const targetUserId = u.id;
    const isOwner = viewerUserId === targetUserId;

    if (prof.profile_visibility === 'private' && !isOwner) {
      throw new ForbiddenError('This profile is private.');
    }
    if (prof.profile_visibility === 'community' && !viewerUserId) {
      throw new ForbiddenError('Sign in to view community member profiles.');
    }

    const achById = new Map(db.achievements.map((a) => [a.id, a]));
    const achievements = db.user_achievements
      .filter((ua) => ua.user_id === targetUserId)
      .sort((a, b) => new Date(b.unlocked_at).getTime() - new Date(a.unlocked_at).getTime())
      .map((ua) => {
        const a = achById.get(ua.achievement_id)!;
        return {
          slug: a.slug,
          title_en: a.title_en,
          title_rw: a.title_rw,
          title_fr: a.title_fr,
          description_en: a.description_en,
          description_rw: a.description_rw,
          description_fr: a.description_fr,
          icon_name: a.icon_name,
          badge_tier: a.badge_tier,
          xp_bonus: a.xp_bonus,
          unlocked_at: ua.unlocked_at,
        };
      });

    const showActivity = isOwner || Boolean(prof.show_activity);
    const chById = new Map(db.challenges.map((c) => [c.id, c]));
    const courseById = new Map(db.courses.map((c) => [c.id, c]));
    const oppById = new Map(db.opportunities.map((o) => [o.id, o]));

    const challengeHistory = showActivity
      ? db.challenge_submissions
          .filter((cs) => cs.user_id === targetUserId)
          .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())
          .slice(0, 20)
          .map((cs) => {
            const ch = chById.get(cs.challenge_id);
            return {
              id: cs.id,
              score: cs.score,
              max_score: cs.max_score,
              correct_count: cs.correct_count,
              total_questions: cs.total_questions,
              xp_awarded: cs.xp_awarded,
              submitted_at: cs.submitted_at,
              slug: ch?.slug ?? '',
              title_en: ch?.title_en ?? '',
              title_rw: ch?.title_rw ?? '',
              title_fr: ch?.title_fr ?? '',
            };
          })
      : [];

    const learningProgress = showActivity
      ? db.course_enrollments
          .filter((ce) => ce.user_id === targetUserId)
          .sort((a, b) => new Date(b.enrolled_at).getTime() - new Date(a.enrolled_at).getTime())
          .map((ce) => {
            const c = courseById.get(ce.course_id);
            return {
              status: ce.status,
              progress_percent: ce.progress_percent,
              enrolled_at: ce.enrolled_at,
              completed_at: ce.completed_at,
              slug: c?.slug ?? '',
              title_en: c?.title_en ?? '',
              title_rw: c?.title_rw ?? '',
              title_fr: c?.title_fr ?? '',
            };
          })
      : [];

    const xpHistory = isOwner
      ? db.xp_transactions
          .filter((xt) => xt.user_id === targetUserId)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 30)
      : [];

    const savedOpportunities = isOwner
      ? db.saved_opportunities
          .filter((so) => so.user_id === targetUserId)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .map((so) => oppById.get(so.opportunity_id))
          .filter(Boolean)
      : [];

    const profileById = new Map(db.user_profiles.map((p) => [p.user_id, p]));
    const blockedUsers = isOwner
      ? db.user_blocks
          .filter((ub) => ub.blocker_id === targetUserId)
          .map((ub) => {
            const bp = profileById.get(ub.blocked_id);
            return {
              blocked_id: ub.blocked_id,
              display_name: bp?.display_name ?? 'Member',
              username: bp?.username ?? 'member',
              created_at: ub.created_at,
            };
          })
      : [];

    const followersCount = db.user_follows.filter((f) => f.following_id === targetUserId).length;
    const followingCount = db.user_follows.filter((f) => f.follower_id === targetUserId).length;
    const isFollowing = Boolean(
      viewerUserId &&
        !isOwner &&
        db.user_follows.some((f) => f.follower_id === viewerUserId && f.following_id === targetUserId),
    );

    return {
      profile: {
        id: targetUserId,
        role: u.role,
        ageGroup: u.age_group,
        preferredLanguage: u.preferred_language,
        contactVerified: Boolean(u.contact_verified),
        createdAt: u.created_at,
        displayName: prof.display_name,
        username: prof.username,
        avatarUrl: prof.avatar_url,
        bio: prof.bio || '',
        district: prof.district || '',
        interests: prof.interests_json,
        skills: prof.skills_json,
        profileVisibility: prof.profile_visibility,
        showActivity: Boolean(prof.show_activity),
        totalXp: prof.total_xp,
        currentLevel: prof.current_level,
        currentStreak: prof.current_streak,
        longestStreak: prof.longest_streak,
        levelProgress: xpRangeFn(prof.current_level),
        followersCount,
        followingCount,
        isFollowing,
        isOwner,
      },
      achievements,
      challengeHistory,
      learningProgress,
      xpHistory,
      savedOpportunities,
      blockedUsers,
    };
  }

  async updateOwnProfile(
    userId: number,
    data: {
      displayName: string;
      bio: string;
      district: string;
      interests: string[];
      skills: string[];
      profileVisibility: 'public' | 'community' | 'private';
      showActivity: boolean;
      preferredLanguage?: SupportedLanguage;
    },
  ) {
    await this.enqueueWrite((db) => {
      const prof = db.user_profiles.find((p) => p.user_id === userId);
      if (prof) {
        prof.display_name = data.displayName;
        prof.bio = data.bio;
        prof.district = data.district || null;
        prof.interests_json = data.interests;
        prof.skills_json = data.skills;
        prof.profile_visibility = data.profileVisibility;
        prof.show_activity = data.showActivity ? 1 : 0;
      }
      if (data.preferredLanguage) {
        const user = db.users.find((u) => u.id === userId);
        if (user) user.preferred_language = data.preferredLanguage;
      }
    });
  }

  async updateUserAvatar(userId: number, avatarUrl: string) {
    await this.enqueueWrite((db) => {
      const prof = db.user_profiles.find((p) => p.user_id === userId);
      if (prof) prof.avatar_url = avatarUrl;
    });
  }

  async updateUserLanguage(userId: number, language: SupportedLanguage) {
    await this.enqueueWrite((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (user) user.preferred_language = language;
    });
  }

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------
  async listNotifications(userId: number, limit = 30) {
    const db = this.loadState();
    const userNotifs = db.notifications
      .filter((n) => n.user_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return {
      notifications: userNotifs.slice(0, Math.min(100, limit)),
      unreadCount: userNotifs.filter((n) => !n.is_read).length,
    };
  }

  async markNotificationRead(userId: number, notificationId: number) {
    await this.enqueueWrite((db) => {
      const n = db.notifications.find((x) => x.id === notificationId && x.user_id === userId);
      if (n) {
        n.is_read = 1;
        n.read_at = new Date().toISOString();
      }
    });
  }

  async markAllNotificationsRead(userId: number) {
    await this.enqueueWrite((db) => {
      const now = new Date().toISOString();
      for (const n of db.notifications) {
        if (n.user_id === userId && !n.is_read) {
          n.is_read = 1;
          n.read_at = now;
        }
      }
    });
  }

  async getNotificationPreferences(userId: number) {
    const db = this.loadState();
    const r = db.notification_preferences.find((p) => p.user_id === userId);
    if (!r) {
      return {
        challengeReminders: true,
        learningUpdates: true,
        communityActivity: true,
        opportunityAlerts: true,
        announcements: true,
      };
    }
    return {
      challengeReminders: Boolean(r.challenge_reminders),
      learningUpdates: Boolean(r.learning_updates),
      communityActivity: Boolean(r.community_activity),
      opportunityAlerts: Boolean(r.opportunity_alerts),
      announcements: Boolean(r.announcements),
    };
  }

  async updateNotificationPreferences(
    userId: number,
    prefs: {
      challengeReminders: boolean;
      learningUpdates: boolean;
      communityActivity: boolean;
      opportunityAlerts: boolean;
      announcements: boolean;
    },
  ) {
    await this.enqueueWrite((db) => {
      let r = db.notification_preferences.find((p) => p.user_id === userId);
      if (!r) {
        r = {
          user_id: userId,
          challenge_reminders: 1,
          learning_updates: 1,
          community_activity: 1,
          opportunity_alerts: 1,
          announcements: 1,
        };
        db.notification_preferences.push(r);
      }
      r.challenge_reminders = prefs.challengeReminders ? 1 : 0;
      r.learning_updates = prefs.learningUpdates ? 1 : 0;
      r.community_activity = prefs.communityActivity ? 1 : 0;
      r.opportunity_alerts = prefs.opportunityAlerts ? 1 : 0;
      r.announcements = prefs.announcements ? 1 : 0;
    });
  }

  // ---------------------------------------------------------------------------
  // Media Access Check
  // ---------------------------------------------------------------------------
  async authorizeMediaAccess(input: {
    folder: 'posts' | 'avatars';
    filename: string;
    viewerUserId?: number;
    viewerRole?: UserRole;
  }): Promise<{ visibility: 'public' | 'community' | 'private' }> {
    const db = this.loadState();
    const canonicalUrl = `/api/v1/media/${input.folder}/${input.filename}`;
    const legacyUrl = `/uploads/${input.folder}/${input.filename}`;
    const isStaff =
      input.viewerRole === 'moderator' ||
      input.viewerRole === 'admin' ||
      input.viewerRole === 'super_admin';

    if (input.folder === 'posts') {
      const post = db.creative_posts.find(
        (p) => p.media_url === canonicalUrl || p.media_url === legacyUrl,
      );
      if (!post) throw new NotFoundError('Media attachment not found');
      const isOwner = Boolean(input.viewerUserId && post.user_id === input.viewerUserId);
      if (post.moderation_status !== 'approved' && !isOwner && !isStaff) {
        throw new ForbiddenError('This post image is not publicly available.');
      }
      const grp = post.group_id
        ? db.community_groups.find((g) => g.id === post.group_id)
        : undefined;
      if (grp?.is_private && !isOwner && !isStaff) {
        if (!input.viewerUserId) {
          throw new UnauthorizedError('Authentication required to view private group media.');
        }
        const member = db.group_memberships.some(
          (m) => m.group_id === grp.id && m.user_id === input.viewerUserId,
        );
        if (!member) {
          throw new ForbiddenError('Only members of this private group can view this media.');
        }
        return { visibility: 'private' };
      }
      return { visibility: post.moderation_status === 'approved' ? 'public' : 'private' };
    }

    const prof = db.user_profiles.find(
      (p) => p.avatar_url === canonicalUrl || p.avatar_url === legacyUrl,
    );
    if (!prof) throw new NotFoundError('Avatar not found');
    const isOwner = Boolean(input.viewerUserId && prof.user_id === input.viewerUserId);
    const visibility = prof.profile_visibility;
    if (visibility === 'private' && !isOwner && !isStaff) {
      throw new ForbiddenError('This profile avatar is private.');
    }
    if (visibility === 'community' && !input.viewerUserId && !isStaff) {
      throw new UnauthorizedError('Sign in to view community-only member avatars.');
    }
    return { visibility };
  }

  // ---------------------------------------------------------------------------
  // Admin Console
  // ---------------------------------------------------------------------------
  async getAdminOverview() {
    const db = this.loadState();
    const xpBySource = new Map<string, { count: number; total_points: number }>();
    for (const xt of db.xp_transactions) {
      const cur = xpBySource.get(xt.source_type) ?? { count: 0, total_points: 0 };
      cur.count += 1;
      cur.total_points += xt.points;
      xpBySource.set(xt.source_type, cur);
    }
    return {
      counts: {
        users: db.users.length,
        challenges: db.challenges.length,
        submissions: db.challenge_submissions.length,
        courses: db.courses.length,
        enrollments: db.course_enrollments.length,
        posts: db.creative_posts.length,
        openReports: db.content_reports.filter(
          (r) => r.status === 'open' || r.status === 'reviewing',
        ).length,
        pendingOpportunities: db.opportunities.filter((o) => o.approval_status === 'pending')
          .length,
      },
      xpBreakdown: Array.from(xpBySource.entries()).map(([source_type, val]) => ({
        source_type,
        count: val.count,
        total_points: val.total_points,
      })),
    };
  }

  async listUsersAdmin(search?: string) {
    const db = this.loadState();
    const profById = new Map(db.user_profiles.map((p) => [p.user_id, p]));
    const q = search?.trim().toLowerCase();

    return db.users
      .map((u) => {
        const p = profById.get(u.id);
        return {
          id: u.id,
          email: u.email,
          phone: u.phone,
          role: u.role,
          status: u.status,
          age_group: u.age_group,
          contact_verified: u.contact_verified,
          last_login_at: u.last_login_at,
          created_at: u.created_at,
          display_name: p?.display_name ?? 'Member',
          username: p?.username ?? 'member',
          district: p?.district ?? null,
          total_xp: p?.total_xp ?? 0,
          current_level: p?.current_level ?? 1,
        };
      })
      .filter((row) => {
        if (!q) return true;
        return `${row.email || ''} ${row.username} ${row.display_name}`.toLowerCase().includes(q);
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 100);
  }

  async updateUserRoleOrStatusAdmin(params: {
    actorUserId: number;
    actorRole: UserRole;
    targetUserId: number;
    role?: UserRole;
    status?: 'active' | 'suspended';
    ipAddress?: string;
  }) {
    if (params.actorUserId === params.targetUserId && params.status === 'suspended') {
      throw new ForbiddenError('You cannot suspend your own administrator account.');
    }
    if (params.role === 'super_admin' && params.actorRole !== 'super_admin') {
      throw new ForbiddenError('Only a super_admin can assign the super_admin role.');
    }
    await this.enqueueWrite((db) => {
      const target = db.users.find((u) => u.id === params.targetUserId);
      if (!target) throw new NotFoundError('User not found.');
      if (target.role === 'super_admin' && params.actorRole !== 'super_admin') {
        throw new ForbiddenError('Only a super_admin can modify another super_admin.');
      }
      if (params.role) target.role = params.role;
      if (params.status) {
        target.status = params.status;
        if (params.status === 'suspended') {
          const now = new Date().toISOString();
          for (const s of db.user_sessions) {
            if (s.user_id === target.id && !s.revoked_at) s.revoked_at = now;
          }
        }
      }
      this.recordAudit(db, {
        actorUserId: params.actorUserId,
        action: 'ADMIN_USER_UPDATED',
        targetType: 'user',
        targetId: params.targetUserId,
        metadata: { role: params.role, status: params.status },
        ipAddress: params.ipAddress,
      });
    });
  }

  async listAllChallengesAdmin() {
    const db = this.loadState();
    const catById = new Map(db.challenge_categories.map((c) => [c.id, c]));
    return [...db.challenges]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((c) => ({
        ...c,
        category_name: catById.get(c.category_id)?.name_en ?? 'General',
        question_count: db.challenge_questions.filter((q) => q.challenge_id === c.id).length,
      }));
  }

  async createChallengeAdmin(
    actorUserId: number,
    data: {
      categoryId: number;
      slug: string;
      titleEn: string;
      titleRw: string;
      titleFr: string;
      descriptionEn: string;
      descriptionRw: string;
      descriptionFr: string;
      difficulty: string;
      challengeType: string;
      timeLimitSeconds: number;
      xpReward: number;
      activeDate?: string | null;
      isFeatured: boolean;
      status: string;
    },
    ipAddress?: string,
  ) {
    return this.enqueueWrite((db) => {
      if (db.challenges.some((c) => c.slug === data.slug)) {
        throw new ConflictError('A challenge with this URL slug already exists.');
      }
      const id = this.nextId(db, 'challenges');
      db.challenges.push({
        id,
        category_id: data.categoryId,
        slug: data.slug,
        title_en: data.titleEn,
        title_rw: data.titleRw,
        title_fr: data.titleFr,
        description_en: data.descriptionEn,
        description_rw: data.descriptionRw,
        description_fr: data.descriptionFr,
        difficulty: data.difficulty,
        challenge_type: data.challengeType,
        time_limit_seconds: data.timeLimitSeconds,
        xp_reward: data.xpReward,
        active_date: data.activeDate || null,
        is_featured: data.isFeatured ? 1 : 0,
        is_sample: 0,
        status: data.status as 'draft' | 'published' | 'archived',
        created_by: actorUserId,
        created_at: new Date().toISOString(),
      });
      this.recordAudit(db, {
        actorUserId,
        action: 'ADMIN_CHALLENGE_CREATED',
        targetType: 'challenge',
        targetId: id,
        metadata: { slug: data.slug },
        ipAddress,
      });
      return { id };
    });
  }

  async addQuestionAdmin(
    actorUserId: number,
    data: {
      challengeId: number;
      promptEn: string;
      promptRw: string;
      promptFr: string;
      options: string[];
      correctOptionIndex: number;
      explanationEn: string;
      explanationRw: string;
      explanationFr: string;
      pointsWeight: number;
      sortOrder: number;
    },
    ipAddress?: string,
  ) {
    return this.enqueueWrite((db) => {
      const ch = db.challenges.find((c) => c.id === data.challengeId);
      if (!ch) throw new NotFoundError('Challenge not found.');
      const id = this.nextId(db, 'challenge_questions');
      db.challenge_questions.push({
        id,
        challenge_id: data.challengeId,
        prompt_en: data.promptEn,
        prompt_rw: data.promptRw,
        prompt_fr: data.promptFr,
        options_json: data.options,
        correct_option_index: data.correctOptionIndex,
        explanation_en: data.explanationEn,
        explanation_rw: data.explanationRw,
        explanation_fr: data.explanationFr,
        points_weight: data.pointsWeight,
        sort_order: data.sortOrder,
      });
      this.recordAudit(db, {
        actorUserId,
        action: 'ADMIN_QUESTION_ADDED',
        targetType: 'challenge',
        targetId: data.challengeId,
        ipAddress,
      });
      return { id };
    });
  }

  async createCourseAdmin(
    actorUserId: number,
    data: {
      categoryId: number;
      slug: string;
      titleEn: string;
      titleRw: string;
      titleFr: string;
      summaryEn: string;
      summaryRw: string;
      summaryFr: string;
      level: string;
      estimatedMinutes: number;
      xpReward: number;
      status: string;
    },
    ipAddress?: string,
  ) {
    return this.enqueueWrite((db) => {
      if (db.courses.some((c) => c.slug === data.slug)) {
        throw new ConflictError('A course with this slug already exists.');
      }
      const courseId = this.nextId(db, 'courses');
      db.courses.push({
        id: courseId,
        category_id: data.categoryId,
        slug: data.slug,
        title_en: data.titleEn,
        title_rw: data.titleRw,
        title_fr: data.titleFr,
        summary_en: data.summaryEn,
        summary_rw: data.summaryRw,
        summary_fr: data.summaryFr,
        level: data.level,
        estimated_minutes: data.estimatedMinutes,
        xp_reward: data.xpReward,
        status: data.status as 'draft' | 'published' | 'archived',
        is_sample: 0,
        created_by: actorUserId,
        created_at: new Date().toISOString(),
      });
      db.course_modules.push({
        id: this.nextId(db, 'course_modules'),
        course_id: courseId,
        title_en: 'Module 1: Core Foundations',
        title_rw: 'Igice cya 1: Ibanze',
        title_fr: 'Module 1 : Fondamentaux',
        sort_order: 1,
      });
      this.recordAudit(db, {
        actorUserId,
        action: 'ADMIN_COURSE_CREATED',
        targetType: 'course',
        targetId: courseId,
        metadata: { slug: data.slug },
        ipAddress,
      });
      return { id: courseId };
    });
  }

  async listAllCoursesAdmin() {
    const db = this.loadState();
    const catById = new Map(db.course_categories.map((c) => [c.id, c]));
    return [...db.courses]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((c) => ({
        ...c,
        category_name: catById.get(c.category_id)?.name_en ?? 'General',
        lesson_count: db.course_lessons.filter((l) => l.course_id === c.id).length,
      }));
  }

  async addLessonAdmin(
    actorUserId: number,
    data: {
      courseId: number;
      titleEn: string;
      titleRw: string;
      titleFr: string;
      contentEn: string;
      contentRw: string;
      contentFr: string;
      durationMinutes: number;
      xpReward: number;
      assessmentQuestion?: string;
      assessmentOptions?: string[];
      correctOptionIndex?: number;
      assessmentExplanation?: string;
    },
    ipAddress?: string,
  ) {
    return this.enqueueWrite((db) => {
      const course = db.courses.find((c) => c.id === data.courseId);
      if (!course) throw new NotFoundError('Course not found.');
      let mod = db.course_modules.find((m) => m.course_id === course.id);
      if (!mod) {
        mod = {
          id: this.nextId(db, 'course_modules'),
          course_id: course.id,
          title_en: 'Module 1: Core Foundations',
          title_rw: 'Igice cya 1: Ibanze',
          title_fr: 'Module 1 : Fondamentaux',
          sort_order: 1,
        };
        db.course_modules.push(mod);
      }
      const existingLessons = db.course_lessons.filter((l) => l.course_id === course.id).length;
      const lessonId = this.nextId(db, 'course_lessons');
      db.course_lessons.push({
        id: lessonId,
        module_id: mod.id,
        course_id: course.id,
        title_en: data.titleEn,
        title_rw: data.titleRw,
        title_fr: data.titleFr,
        content_en: data.contentEn,
        content_rw: data.contentRw,
        content_fr: data.contentFr,
        duration_minutes: data.durationMinutes,
        xp_reward: data.xpReward,
        assessment_question_json:
          data.assessmentQuestion && data.assessmentOptions && data.assessmentOptions.length >= 2
            ? {
                question: data.assessmentQuestion,
                options: data.assessmentOptions,
                correctIndex: data.correctOptionIndex ?? 0,
                explanation: data.assessmentExplanation || 'Good check!',
              }
            : null,
        sort_order: existingLessons + 1,
      });
      this.recordAudit(db, {
        actorUserId,
        action: 'ADMIN_LESSON_ADDED',
        targetType: 'course',
        targetId: course.id,
        ipAddress,
      });
      return { id: lessonId };
    });
  }

  async listModerationQueueAdmin() {
    const db = this.loadState();
    const profById = new Map(db.user_profiles.map((p) => [p.user_id, p]));
    const statusOrder = { open: 0, reviewing: 1, resolved: 2, dismissed: 3 };

    const reports = [...db.content_reports]
      .sort(
        (a, b) =>
          statusOrder[a.status] - statusOrder[b.status] ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .slice(0, 100)
      .map((r) => {
        const rep = profById.get(r.reporter_id);
        return {
          ...r,
          reporter_username: rep?.username ?? 'member',
          reporter_name: rep?.display_name ?? 'Member',
        };
      });

    const posts = [...db.creative_posts]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 60)
      .map((p) => {
        const auth = profById.get(p.user_id);
        return {
          id: p.id,
          title: p.title,
          post_type: p.post_type,
          category: p.category,
          moderation_status: p.moderation_status,
          created_at: p.created_at,
          author_username: auth?.username ?? 'member',
          author_name: auth?.display_name ?? 'Member',
        };
      });

    return { reports, posts };
  }

  async moderatePostAdmin(
    actorUserId: number,
    postId: number,
    status: 'approved' | 'hidden' | 'removed',
    ipAddress?: string,
  ) {
    await this.enqueueWrite((db) => {
      const post = db.creative_posts.find((p) => p.id === postId);
      if (post) post.moderation_status = status;
      this.recordAudit(db, {
        actorUserId,
        action: 'ADMIN_POST_MODERATED',
        targetType: 'post',
        targetId: postId,
        metadata: { status },
        ipAddress,
      });
    });
  }

  async resolveReportAdmin(
    actorUserId: number,
    reportId: number,
    status: 'reviewing' | 'resolved' | 'dismissed',
    resolutionNote?: string,
    ipAddress?: string,
  ) {
    await this.enqueueWrite((db) => {
      const rep = db.content_reports.find((r) => r.id === reportId);
      if (rep) {
        rep.status = status;
        rep.reviewed_by = actorUserId;
        rep.resolution_note = resolutionNote || null;
      }
      this.recordAudit(db, {
        actorUserId,
        action: 'ADMIN_REPORT_UPDATED',
        targetType: 'report',
        targetId: reportId,
        metadata: { status, resolutionNote },
        ipAddress,
      });
    });
  }

  async listAllOpportunitiesAdmin() {
    const db = this.loadState();
    const catById = new Map(db.opportunity_categories.map((c) => [c.id, c]));
    const statusOrder = { pending: 0, approved: 1, rejected: 2, expired: 3 };
    return [...db.opportunities]
      .sort(
        (a, b) =>
          statusOrder[a.approval_status] - statusOrder[b.approval_status] ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .map((o) => ({
        ...o,
        category_name: catById.get(o.category_id)?.name_en ?? 'General',
      }));
  }

  async updateOpportunityStatusAdmin(
    actorUserId: number,
    opportunityId: number,
    params: {
      approvalStatus?: 'pending' | 'approved' | 'rejected' | 'expired';
      verifiedStatus?: 'unverified' | 'verified';
    },
    ipAddress?: string,
  ) {
    await this.enqueueWrite((db) => {
      const opp = db.opportunities.find((o) => o.id === opportunityId);
      if (opp) {
        if (params.approvalStatus) {
          opp.approval_status = params.approvalStatus;
          opp.approved_by = actorUserId;
        }
        if (params.verifiedStatus) {
          opp.verified_status = params.verifiedStatus;
        }
      }
      this.recordAudit(db, {
        actorUserId,
        action: 'ADMIN_OPPORTUNITY_UPDATED',
        targetType: 'opportunity',
        targetId: opportunityId,
        metadata: params,
        ipAddress,
      });
    });
  }

  async listOrganizationsAdmin() {
    const db = this.loadState();
    return [...db.organizations].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }

  async createOrganizationAdmin(
    actorUserId: number,
    data: { name: string; orgType: string; websiteUrl?: string; description?: string; verified: boolean },
    ipAddress?: string,
  ) {
    const slug =
      data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 75) +
      '-' +
      Date.now().toString(36);
    return this.enqueueWrite((db) => {
      const id = this.nextId(db, 'organizations');
      db.organizations.push({
        id,
        name: data.name,
        slug,
        org_type: data.orgType,
        website_url: data.websiteUrl || null,
        verified: data.verified ? 1 : 0,
        description: data.description || null,
        created_by: actorUserId,
        created_at: new Date().toISOString(),
      });
      this.recordAudit(db, {
        actorUserId,
        action: 'ADMIN_ORGANIZATION_CREATED',
        targetType: 'organization',
        targetId: id,
        ipAddress,
      });
      return { id };
    });
  }

  async listAnnouncementsAdmin() {
    const db = this.loadState();
    return [...db.announcements].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }

  async createAnnouncementAdmin(
    actorUserId: number,
    data: {
      titleEn: string;
      titleRw: string;
      titleFr: string;
      bodyEn: string;
      bodyRw: string;
      bodyFr: string;
      audience: string;
      isActive: boolean;
    },
    ipAddress?: string,
  ) {
    return this.enqueueWrite((db) => {
      const id = this.nextId(db, 'announcements');
      db.announcements.push({
        id,
        title_en: data.titleEn,
        title_rw: data.titleRw,
        title_fr: data.titleFr,
        body_en: data.bodyEn,
        body_rw: data.bodyRw,
        body_fr: data.bodyFr,
        audience: data.audience,
        is_active: data.isActive ? 1 : 0,
        starts_at: null,
        ends_at: null,
        created_by: actorUserId,
        created_at: new Date().toISOString(),
      });
      this.recordAudit(db, {
        actorUserId,
        action: 'ADMIN_ANNOUNCEMENT_CREATED',
        targetType: 'announcement',
        targetId: id,
        ipAddress,
      });
      return { id };
    });
  }

  async listAuditLogsAdmin() {
    const db = this.loadState();
    const profById = new Map(db.user_profiles.map((p) => [p.user_id, p]));
    return [...db.audit_logs]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 100)
      .map((al) => ({
        ...al,
        actor_username: al.actor_user_id ? profById.get(al.actor_user_id)?.username ?? null : null,
      }));
  }

  async listSettingsAdmin() {
    const db = this.loadState();
    return [...db.platform_settings].sort((a, b) => a.setting_key.localeCompare(b.setting_key));
  }

  async updateSettingAdmin(actorUserId: number, key: string, valueObj: unknown, ipAddress?: string) {
    await this.enqueueWrite((db) => {
      const existing = db.platform_settings.find((s) => s.setting_key === key);
      if (existing) {
        existing.setting_value_json = valueObj;
        existing.updated_by = actorUserId;
      } else {
        db.platform_settings.push({
          setting_key: key,
          setting_value_json: valueObj,
          description: null,
          updated_by: actorUserId,
        });
      }
      this.recordAudit(db, {
        actorUserId,
        action: 'ADMIN_SETTING_UPDATED',
        targetType: 'setting',
        targetId: key,
        metadata: { valueObj },
        ipAddress,
      });
    });
  }
}

export const localStore = new LocalPlatformStore();
