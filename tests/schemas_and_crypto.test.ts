import { describe, expect, it } from 'vitest';
import {
  adminCreateChallengeSchema,
  createOpportunitySchema,
  registerSchema,
} from '../shared/schemas.ts';
import { calculateLevelFromXp, xpRangeForLevel } from '../server/services/gamificationService.ts';
import { detectImageExtensionFromMagicBytes } from '../server/uploads.ts';
import { hashPassword, timingSafeEqualsString, verifyPassword } from '../server/utils/crypto.ts';

describe('Cryptography & Password Security', () => {
  it('hashes and verifies strong passwords with unique salts', async () => {
    const hash1 = await hashPassword('KigaliStrong2026!');
    const hash2 = await hashPassword('KigaliStrong2026!');
    expect(hash1).not.toBe(hash2);
    expect(hash1.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('KigaliStrong2026!', hash1)).toBe(true);
    expect(await verifyPassword('WrongPassword1!', hash1)).toBe(false);
  });

  it('performs timing-safe string comparisons', () => {
    expect(timingSafeEqualsString('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqualsString('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqualsString('abc123', 'abc12')).toBe(false);
  });
});

describe('File Upload Magic-Byte Verification', () => {
  it('accepts valid JPEG, PNG, and WebP signatures and rejects spoofed files', () => {
    const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const webpBuf = Buffer.from('RIFF1234WEBP', 'ascii');
    const fakeScriptBuf = Buffer.from('<script>alert(1)</script>', 'utf8');

    expect(detectImageExtensionFromMagicBytes(jpegBuf)).toBe('jpg');
    expect(detectImageExtensionFromMagicBytes(pngBuf)).toBe('png');
    expect(detectImageExtensionFromMagicBytes(webpBuf)).toBe('webp');
    expect(detectImageExtensionFromMagicBytes(fakeScriptBuf)).toBeNull();
  });
});

describe('Zod Request Validation Schemas', () => {
  it('requires at least email or phone and enforces password strength on registration', () => {
    const missingContact = registerSchema.safeParse({
      displayName: 'Aline Uwase',
      username: 'aline_u',
      password: 'Password123',
    });
    expect(missingContact.success).toBe(false);

    const valid = registerSchema.safeParse({
      email: 'aline@example.rw',
      displayName: 'Aline Uwase',
      username: 'aline_u',
      password: 'Password123',
      ageGroup: 'adult_18_plus',
      preferredLanguage: 'rw',
    });
    expect(valid.success).toBe(true);
  });

  it('validates opportunity URLs and admin challenge slugs', () => {
    expect(
      createOpportunitySchema.safeParse({
        categoryId: 1,
        opportunityType: 'scholarship',
        title: 'Rwanda Tech Scholarship',
        organizationName: 'Kigali Hub',
        location: 'Kigali',
        summary: 'Full tuition scholarship for young software engineers in Rwanda.',
        eligibility: 'Residents aged 18-28',
        applicationUrl: 'not-a-url',
      }).success,
    ).toBe(false);

    expect(
      adminCreateChallengeSchema.safeParse({
        categoryId: 1,
        slug: 'INVALID SLUG!',
        titleEn: 'Test',
        titleRw: 'Test',
        titleFr: 'Test',
        descriptionEn: 'Description long enough',
        descriptionRw: 'Description long enough',
        descriptionFr: 'Description long enough',
        difficulty: 'beginner',
        challengeType: 'daily',
        timeLimitSeconds: 180,
        xpReward: 50,
      }).success,
    ).toBe(false);
  });
});

describe('Gamification Level Calculation', () => {
  it('computes levels and boundaries deterministically', () => {
    expect(calculateLevelFromXp(0)).toBe(1);
    expect(calculateLevelFromXp(99)).toBe(1);
    expect(calculateLevelFromXp(100)).toBe(2);
    expect(calculateLevelFromXp(400)).toBe(3);
    expect(xpRangeForLevel(2)).toEqual({ currentLevelMinXp: 100, nextLevelMinXp: 400 });
  });
});
