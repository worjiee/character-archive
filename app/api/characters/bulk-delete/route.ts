import { requireAdminApiSession } from '@/src/lib/auth';
import { bulkSoftDeleteCharacters } from '@/src/lib/characters/management';
import { ownerErrorResponse, readOwnerJson } from '../../owner-errors';

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await readOwnerJson(request);
    const result = await bulkSoftDeleteCharacters(body.characterIds);
    return Response.json(result);
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
