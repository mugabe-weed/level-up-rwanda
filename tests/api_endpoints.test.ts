import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
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
