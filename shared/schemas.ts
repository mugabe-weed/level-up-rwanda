import { z } from 'zod';

export const SUPPORTED_LANGUAGES = ['rw', 'en', 'fr'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const USER_ROLES = ['member', 'educator', 'moderator', 'admin', 'super_admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const AGE_GROUPS = ['youth_13_17', 'adult_18_plus'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

export const CHALLENGE_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;
export const CHALLENGE_TYPES = ['daily', 'weekly', 'practice'] as const;
export const OPPORTUNITY_TYPES = [
  'scholarship',
  'internship',
  'job',
  'remote_job',
  'fellowship',
  'grant',
  'volunteering',
  'online_course',
] as const;

export const strongPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .refine((val) => /[a-z]/.test(val), 'Password must include a lowercase letter')
  .refine((val) => /[A-Z]/.test(val), 'Password must include an uppercase letter')
  .refine((val) => /\d/.test(val), 'Password must include a number');

export const registerSchema = z
  .object({
    email: z.string().trim().email('Enter a valid email address').max(190).optional().or(z.literal('')),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9]{9,15}$/, 'Enter a valid phone number (e.g. +250788000000)')
      .optional()
      .or(z.literal('')),
    displayName: z.string().trim().min(2, 'Display name is required').max(80),
    username: z
      .string()
      .trim()
      .min(3, 'Username must be at least 3 characters')
      .max(32)
      .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
    password: strongPasswordSchema,
    ageGroup: z.enum(AGE_GROUPS).default('adult_18_plus'),
    preferredLanguage: z.enum(SUPPORTED_LANGUAGES).default('en'),
    district: z.string().trim().max(80).optional(),
  })
  .refine((data) => Boolean(data.email || data.phone), {
    message: 'Provide either an email address or a phone number',
    path: ['email'],
  });

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Email, phone, or username is required').max(190),
  password: z.string().min(1, 'Password is required').max(128),
});

export const verifyContactSchema = z.object({
  identifier: z.string().trim().min(3).max(190),
  code: z.string().trim().min(6).max(64),
});

export const requestPasswordResetSchema = z.object({
  identifier: z.string().trim().min(3, 'Email or phone is required').max(190),
});

export const confirmPasswordResetSchema = z.object({
  identifier: z.string().trim().min(3).max(190),
  token: z.string().trim().min(6).max(128),
  newPassword: strongPasswordSchema,
});

export const bootstrapAdminSchema = z.object({
  bootstrapToken: z.string().trim().min(16, 'Bootstrap token is required'),
  email: z.string().trim().email().max(190),
  displayName: z.string().trim().min(2).max(80),
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z
    .string()
    .min(12, 'Administrator password must be at least 12 characters')
    .max(128)
    .refine((val) => /[a-z]/.test(val) && /[A-Z]/.test(val) && /\d/.test(val), {
      message: 'Administrator password must include upper, lower, and numeric characters',
    }),
});

export const challengeSubmissionSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.number().int().positive(),
        selectedOptionIndex: z.number().int().min(0).max(10),
      }),
    )
    .min(1, 'Select at least one answer'),
  durationSeconds: z.number().int().min(1).max(7200),
});

export const lessonCompletionSchema = z.object({
  selectedOptionIndex: z.number().int().min(0).max(10).optional(),
});

export const createPostSchema = z.object({
  postType: z.enum(['create_showcase', 'discussion']).default('create_showcase'),
  category: z.string().trim().min(2).max(60),
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(140),
  body: z.string().trim().min(10, 'Share at least 10 characters').max(4000),
  groupId: z.number().int().positive().nullable().optional(),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(2, 'Comment is too short').max(1500),
});

export const createGroupSchema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().min(10).max(600),
  category: z.string().trim().min(2).max(60),
  isPrivate: z.boolean().default(false),
});

export const reportContentSchema = z.object({
  targetType: z.enum(['post', 'comment', 'user', 'opportunity']),
  targetId: z.number().int().positive(),
  reason: z.enum([
    'spam',
    'harassment',
    'misinformation',
    'inappropriate_for_youth',
    'scam_or_fraud',
    'other',
  ]),
  details: z.string().trim().max(1000).optional(),
});

export const createOpportunitySchema = z.object({
  categoryId: z.number().int().positive(),
  opportunityType: z.enum(OPPORTUNITY_TYPES),
  title: z.string().trim().min(5).max(160),
  organizationName: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(120),
  isRemote: z.boolean().default(false),
  summary: z.string().trim().min(20).max(3000),
  eligibility: z.string().trim().min(5).max(1500),
  applicationUrl: z.string().trim().url('Provide a valid https:// application link').max(500),
  deadlineAt: z.string().trim().optional().nullable(),
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  bio: z.string().trim().max(500).optional().default(''),
  district: z.string().trim().max(80).optional().default(''),
  interests: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  skills: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  profileVisibility: z.enum(['public', 'community', 'private']).default('community'),
  showActivity: z.boolean().default(true),
  preferredLanguage: z.enum(SUPPORTED_LANGUAGES).optional(),
});

export const updateNotificationPrefsSchema = z.object({
  challengeReminders: z.boolean(),
  learningUpdates: z.boolean(),
  communityActivity: z.boolean(),
  opportunityAlerts: z.boolean(),
  announcements: z.boolean(),
});

export const adminCreateChallengeSchema = z.object({
  categoryId: z.number().int().positive(),
  slug: z.string().trim().min(3).max(90).regex(/^[a-z0-9-]+$/),
  titleEn: z.string().trim().min(3).max(160),
  titleRw: z.string().trim().min(3).max(160),
  titleFr: z.string().trim().min(3).max(160),
  descriptionEn: z.string().trim().min(10).max(2000),
  descriptionRw: z.string().trim().min(10).max(2000),
  descriptionFr: z.string().trim().min(10).max(2000),
  difficulty: z.enum(CHALLENGE_DIFFICULTIES),
  challengeType: z.enum(CHALLENGE_TYPES),
  timeLimitSeconds: z.number().int().min(30).max(3600),
  xpReward: z.number().int().min(10).max(500),
  activeDate: z.string().trim().optional().nullable(),
  isFeatured: z.boolean().default(false),
  status: z.enum(['draft', 'published', 'archived']).default('published'),
});

export const adminCreateQuestionSchema = z.object({
  challengeId: z.number().int().positive(),
  promptEn: z.string().trim().min(5).max(1000),
  promptRw: z.string().trim().min(5).max(1000),
  promptFr: z.string().trim().min(5).max(1000),
  options: z.array(z.string().trim().min(1).max(300)).min(2).max(6),
  correctOptionIndex: z.number().int().min(0).max(5),
  explanationEn: z.string().trim().min(5).max(1000),
  explanationRw: z.string().trim().min(5).max(1000),
  explanationFr: z.string().trim().min(5).max(1000),
  pointsWeight: z.number().int().min(1).max(100).default(10),
  sortOrder: z.number().int().min(1).max(100).default(1),
});

export const adminCreateCourseSchema = z.object({
  categoryId: z.number().int().positive(),
  slug: z.string().trim().min(3).max(90).regex(/^[a-z0-9-]+$/),
  titleEn: z.string().trim().min(3).max(160),
  titleRw: z.string().trim().min(3).max(160),
  titleFr: z.string().trim().min(3).max(160),
  summaryEn: z.string().trim().min(10).max(2000),
  summaryRw: z.string().trim().min(10).max(2000),
  summaryFr: z.string().trim().min(10).max(2000),
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  estimatedMinutes: z.number().int().min(5).max(2000),
  xpReward: z.number().int().min(20).max(1000),
  status: z.enum(['draft', 'published', 'archived']).default('published'),
});

export const adminCreateAnnouncementSchema = z.object({
  titleEn: z.string().trim().min(3).max(160),
  titleRw: z.string().trim().min(3).max(160),
  titleFr: z.string().trim().min(3).max(160),
  bodyEn: z.string().trim().min(5).max(2000),
  bodyRw: z.string().trim().min(5).max(2000),
  bodyFr: z.string().trim().min(5).max(2000),
  audience: z.enum(['all', 'learners', 'moderators']).default('all'),
  isActive: z.boolean().default(true),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
