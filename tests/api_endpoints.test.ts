import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../server/app.ts';
import { getMysqlConfigStatus } from '../server/db/config.ts';
import { runMigrations } from '../server/db/migrator.ts';
import { closePool } from '../server/db/pool.ts';
import { runSeeds } from '../server/db/seed.ts';

const app = createApiApp();
const mysqlConfigured = getMysqlConfigStatus().configured;

describe('REST API Health, Security, and Auth Enforcement', () => {
  it('returns healthy status from /api/v1/health', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe('levelup-rwanda');
  });

  it('reports honest readiness status on /api/v1/ready', async () => {
    const res = await request(app).get('/api/v1/ready');
    if (!mysqlConfigured) {
      expect(res.status).toBe(503);
      expect(res.body.ready).toBe(false);
      expect(res.body.database.configured).toBe(false);
    } else {
      expect([200, 503]).toContain(res.status);
    }
  });

  it('blocks unauthenticated access to protected user and admin routes', async () => {
    const protectedEndpoints = [
      { method: 'put' as const, path: '/api/v1/profile/me' },
      { method: 'get' as const, path: '/api/v1/notifications' },
      { method: 'get' as const, path: '/api/v1/admin/overview' },
      { method: 'post' as const, path: '/api/v1/challenges/sample-digital-safety-rwanda-daily/submit' },
      { method: 'post' as const, path: '/api/v1/courses/sample-practical-web-foundations/enroll' },
      { method: 'post' as const, path: '/api/v1/community/reports' },
    ];

    for (const ep of protectedEndpoints) {
      const res = await request(app)[ep.method](ep.path).send({});
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    }
  });

  it('rejects state-changing requests with session cookie when CSRF header is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', ['levelup_session=fake_cookie_val; levelup_csrf=token_123'])
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('returns 400 validation errors on invalid registration payloads', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      displayName: 'A',
      username: 'invalid user!',
      password: '123',
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 JSON on unknown /api routes', async () => {
    const res = await request(app).get('/api/v1/nonexistent-endpoint');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

describe.skipIf(mysqlConfigured)('Integrated Local Store End-to-End Platform Workflows', () => {
  const tempDbFile = path.join(os.tmpdir(), `levelup-rwanda-test-${process.pid}-${Date.now()}.json`);
  const prevDbPath = process.env.LEVELUP_LOCAL_DB_PATH;

  beforeAll(() => {
    process.env.LEVELUP_LOCAL_DB_PATH = tempDbFile;
  });

  afterAll(() => {
    if (prevDbPath === undefined) {
      delete process.env.LEVELUP_LOCAL_DB_PATH;
    } else {
      process.env.LEVELUP_LOCAL_DB_PATH = prevDbPath;
    }
    if (fs.existsSync(tempDbFile)) {
      fs.unlinkSync(tempDbFile);
    }
  });

  function extractCookies(setCookieHeader: string[] | string | undefined): Record<string, string> {
    const list = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : setCookieHeader
        ? [setCookieHeader]
        : [];
    const cookies: Record<string, string> = {};
    for (const raw of list) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
      }
    }
    return cookies;
  }

  it('serves dashboard, challenges, courses, opportunities, and community feeds out of the box', async () => {
    const [dashRes, chRes, courseRes, oppRes, postRes, groupRes] = await Promise.all([
      request(app).get('/api/v1/dashboard'),
      request(app).get('/api/v1/challenges'),
      request(app).get('/api/v1/courses'),
      request(app).get('/api/v1/opportunities'),
      request(app).get('/api/v1/community/posts'),
      request(app).get('/api/v1/community/groups'),
    ]);

    expect(dashRes.status).toBe(200);
    expect(dashRes.body.data.featuredChallenge).toBeTruthy();
    expect(chRes.status).toBe(200);
    expect(chRes.body.data.length).toBeGreaterThanOrEqual(3);
    expect(chRes.body.data[0].title_en).not.toContain('[Sample]');
    expect(courseRes.status).toBe(200);
    expect(courseRes.body.data.length).toBeGreaterThanOrEqual(2);
    expect(oppRes.status).toBe(200);
    expect(oppRes.body.data.length).toBeGreaterThanOrEqual(2);
    expect(postRes.status).toBe(200);
    expect(postRes.body.data.length).toBeGreaterThanOrEqual(2);
    expect(groupRes.status).toBe(200);
    expect(groupRes.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('supports register, contact verify, login, daily challenge quiz, course enroll, post creation, opportunity save, and logout', async () => {
    const uniqueSuffix = `${Date.now().toString(36)}`;
    const email = `learner.${uniqueSuffix}@levelup.rw`;
    const username = `learner_${uniqueSuffix}`;

    const regRes = await request(app).post('/api/v1/auth/register').send({
      displayName: 'Keza Aline',
      username,
      email,
      password: 'Password123!',
      ageGroup: 'adult_18_plus',
      preferredLanguage: 'en',
      district: 'Gasabo',
    });
    expect(regRes.status).toBe(201);
    const verificationCode = regRes.body.data.verificationPreviewCode;
    expect(typeof verificationCode).toBe('string');

    const verifyRes = await request(app).post('/api/v1/auth/verify-contact').send({
      identifier: email,
      code: verificationCode,
    });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.verified).toBe(true);

    const loginRes = await request(app).post('/api/v1/auth/login').send({
      identifier: email,
      password: 'Password123!',
    });
    expect(loginRes.status).toBe(200);

    const cookies = extractCookies(loginRes.headers['set-cookie']);
    expect(cookies.levelup_session).toBeTruthy();
    expect(cookies.levelup_csrf).toBeTruthy();
    const cookieHeader = `levelup_session=${cookies.levelup_session}; levelup_csrf=${cookies.levelup_csrf}`;
    const csrfToken = cookies.levelup_csrf;

    const meRes = await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.username).toBe(username);

    const detailRes = await request(app)
      .get('/api/v1/challenges/sample-digital-safety-rwanda-daily')
      .set('Cookie', cookieHeader);
    expect(detailRes.status).toBe(200);
    const questions = detailRes.body.data.questions as Array<{ id: number }>;
    expect(questions.length).toBeGreaterThan(0);

    const sampleCorrectChoices = [1, 2, 0];
    const submitRes = await request(app)
      .post('/api/v1/challenges/sample-digital-safety-rwanda-daily/submit')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({
        answers: questions.map((q, idx) => ({
          questionId: q.id,
          selectedOptionIndex: sampleCorrectChoices[idx] ?? 0,
        })),
        durationSeconds: 30,
      });
    expect(submitRes.status).toBe(201);
    expect(submitRes.body.data.xpAwarded).toBeGreaterThan(0);

    const enrollRes = await request(app)
      .post('/api/v1/courses/sample-practical-web-foundations/enroll')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(enrollRes.status).toBe(201);

    const postCreateRes = await request(app)
      .post('/api/v1/community/posts')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({
        postType: 'discussion',
        category: 'Community Discussion',
        title: 'Studying coding in Kigali',
        body: 'Looking for study partners for the web foundations course.',
      });
    expect(postCreateRes.status).toBe(201);

    const saveOppRes = await request(app)
      .post('/api/v1/opportunities/1/save')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(saveOppRes.status).toBe(200);

    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(logoutRes.status).toBe(200);

    const afterLogoutMe = await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader);
    expect(afterLogoutMe.body.data.user).toBeNull();
  });
});

describe.skipIf(!mysqlConfigured)('Live MySQL 8 End-to-End Integration Suite', () => {
  afterAll(async () => {
    await closePool();
  });

  it('runs idempotent migrations and seed data cleanly', async () => {
    const mig = await runMigrations();
    expect(Array.isArray(mig.applied)).toBe(true);
    const seed = await runSeeds();
    expect(seed.seededSections).toContain('challenge_categories');
    expect(seed.seededSections).toContain('achievements');
  });
});
