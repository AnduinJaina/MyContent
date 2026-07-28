import { Router } from 'express';
import type { ContentInput } from '../types/content';
import * as contentStore from '../store/contentStore';

export const contentRouter = Router();

contentRouter.get('/', async (_req, res) => {
  const items = await contentStore.listContent();
  res.json(items);
});

contentRouter.get('/:id', async (req, res) => {
  const item = await contentStore.getContent(req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Content not found' });
    return;
  }
  res.json(item);
});

contentRouter.post('/', async (req, res) => {
  const { title, body } = req.body ?? {};
  if (typeof title !== 'string' || typeof body !== 'string') {
    res.status(400).json({ error: 'title and body are required strings' });
    return;
  }
  const item = await contentStore.createContent({ title, body });
  res.status(201).json(item);
});

contentRouter.put('/:id', async (req, res) => {
  const { title, body } = req.body ?? {};
  if (title !== undefined && typeof title !== 'string') {
    res.status(400).json({ error: 'title must be a string' });
    return;
  }
  if (body !== undefined && typeof body !== 'string') {
    res.status(400).json({ error: 'body must be a string' });
    return;
  }

  const update: Partial<ContentInput> = {};
  if (title !== undefined) update.title = title;
  if (body !== undefined) update.body = body;

  const item = await contentStore.updateContent(req.params.id, update);
  if (!item) {
    res.status(404).json({ error: 'Content not found' });
    return;
  }
  res.json(item);
});

contentRouter.delete('/:id', async (req, res) => {
  const deleted = await contentStore.deleteContent(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Content not found' });
    return;
  }
  res.status(204).send();
});
