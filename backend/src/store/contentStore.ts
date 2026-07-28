import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Content, ContentInput } from '../types/content';

const DATA_FILE =
  process.env.CONTENT_DATA_FILE ?? path.join(__dirname, '..', '..', 'data', 'content.json');

async function readAll(): Promise<Content[]> {
  const raw = await fs.readFile(DATA_FILE, 'utf-8');
  return JSON.parse(raw) as Content[];
}

async function writeAll(items: Content[]): Promise<void> {
  await fs.writeFile(DATA_FILE, JSON.stringify(items, null, 2));
}

export async function listContent(): Promise<Content[]> {
  return readAll();
}

export async function getContent(id: string): Promise<Content | undefined> {
  const items = await readAll();
  return items.find((item) => item.id === id);
}

export async function createContent(input: ContentInput): Promise<Content> {
  const items = await readAll();
  const now = new Date().toISOString();
  const item: Content = {
    id: randomUUID(),
    title: input.title,
    body: input.body,
    createdAt: now,
    updatedAt: now,
  };
  items.push(item);
  await writeAll(items);
  return item;
}

export async function updateContent(
  id: string,
  input: Partial<ContentInput>,
): Promise<Content | undefined> {
  const items = await readAll();
  const index = items.findIndex((item) => item.id === id);
  const existing = items[index];
  if (index === -1 || !existing) return undefined;

  const updated: Content = {
    ...existing,
    ...input,
    updatedAt: new Date().toISOString(),
  };
  items[index] = updated;
  await writeAll(items);
  return updated;
}

export async function deleteContent(id: string): Promise<boolean> {
  const items = await readAll();
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return false;
  items.splice(index, 1);
  await writeAll(items);
  return true;
}
