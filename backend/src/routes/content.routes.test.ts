import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataFile = path.join(os.tmpdir(), `content-test-${process.pid}-${Date.now()}.json`);
process.env.CONTENT_DATA_FILE = dataFile;

const request = require('supertest');
const { createApp } = require('../app');

const app = createApp();

beforeEach(() => {
  fs.writeFileSync(dataFile, '[]');
});

afterAll(() => {
  fs.rmSync(dataFile, { force: true });
});

describe('GET /api/content', () => {
  it('returns an empty list initially', async () => {
    const res = await request(app).get('/api/content');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns created items', async () => {
    await request(app).post('/api/content').send({ title: 'A', body: 'B' });
    const res = await request(app).get('/api/content');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ title: 'A', body: 'B' });
  });
});

describe('POST /api/content', () => {
  it('creates content with generated id and timestamps', async () => {
    const res = await request(app).post('/api/content').send({ title: 'Hello', body: 'World' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Hello', body: 'World' });
    expect(typeof res.body.id).toBe('string');
    expect(typeof res.body.createdAt).toBe('string');
    expect(res.body.createdAt).toBe(res.body.updatedAt);
  });

  it('rejects missing title/body', async () => {
    const res = await request(app).post('/api/content').send({ title: 'only title' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('rejects non-string fields', async () => {
    const res = await request(app).post('/api/content').send({ title: 1, body: 2 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/content/:id', () => {
  it('returns the matching item', async () => {
    const created = await request(app).post('/api/content').send({ title: 'A', body: 'B' });
    const res = await request(app).get(`/api/content/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(created.body);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get('/api/content/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/content/:id', () => {
  it('updates only the provided fields', async () => {
    const created = await request(app).post('/api/content').send({ title: 'A', body: 'B' });
    const res = await request(app).put(`/api/content/${created.body.id}`).send({ title: 'A2' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('A2');
    expect(res.body.body).toBe('B');
    expect(res.body.updatedAt).not.toBe(created.body.createdAt);
  });

  it('rejects a non-string field', async () => {
    const created = await request(app).post('/api/content').send({ title: 'A', body: 'B' });
    const res = await request(app).put(`/api/content/${created.body.id}`).send({ title: 42 });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).put('/api/content/does-not-exist').send({ title: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/content/:id', () => {
  it('deletes an existing item', async () => {
    const created = await request(app).post('/api/content').send({ title: 'A', body: 'B' });
    const del = await request(app).delete(`/api/content/${created.body.id}`);
    expect(del.status).toBe(204);

    const get = await request(app).get(`/api/content/${created.body.id}`);
    expect(get.status).toBe(404);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).delete('/api/content/does-not-exist');
    expect(res.status).toBe(404);
  });
});
