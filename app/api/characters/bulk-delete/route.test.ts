import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  requireAdminApiSession: vi.fn(),
}));

const management = vi.hoisted(() => ({
  bulkSoftDeleteCharacters: vi.fn(),
}));

const errors = vi.hoisted(() => ({
  readOwnerJson: vi.fn((request: Request) => request.json()),
  ownerErrorResponse: vi.fn((error: unknown) => Response.json({ error: String(error) }, { status: 400 })),
}));

vi.mock('@/src/lib/auth', () => auth);
vi.mock('@/src/lib/characters/management', () => management);
vi.mock('../../owner-errors', () => errors);

import { POST } from './route';

describe('POST /api/characters/bulk-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireAdminApiSession.mockResolvedValue(null);
    management.bulkSoftDeleteCharacters.mockResolvedValue({
      success: true,
      deletedCount: 2,
      deletedIds: ['char-1', 'char-2'],
      alreadyDeletedIds: [],
    });
  });

  it('rejects non-admin or unauthenticated access', async () => {
    auth.requireAdminApiSession.mockResolvedValue(
      Response.json({ error: 'Administrator access required.' }, { status: 403 }),
    );

    const response = await POST(new Request('http://localhost/api/characters/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterIds: ['char-1'] }),
    }));

    expect(response.status).toBe(403);
    expect(management.bulkSoftDeleteCharacters).not.toHaveBeenCalled();
  });

  it('executes bulk delete for authorized admin', async () => {
    const response = await POST(new Request('http://localhost/api/characters/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterIds: ['char-1', 'char-2'] }),
    }));

    expect(response.status).toBe(200);
    expect(management.bulkSoftDeleteCharacters).toHaveBeenCalledWith(['char-1', 'char-2']);
    const data = await response.json();
    expect(data).toEqual({
      success: true,
      deletedCount: 2,
      deletedIds: ['char-1', 'char-2'],
      alreadyDeletedIds: [],
    });
  });
});
