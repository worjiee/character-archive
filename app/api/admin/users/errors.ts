import { UserManagementError } from "../../../../src/lib/users/access-management";

const MAX_USER_MANAGEMENT_BODY_BYTES = 16 * 1024;

export async function readUserManagementJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_USER_MANAGEMENT_BODY_BYTES) {
    throw new UserManagementError("INVALID_REQUEST", "The request body is too large.", 413);
  }
  try {
    const text = await readBoundedText(request);
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof UserManagementError) throw error;
    throw new UserManagementError("INVALID_REQUEST", "The request body must be valid JSON.");
  }
}

export async function assertEmptyUserManagementBody(request: Request): Promise<void> {
  if (!request.body) return;
  const text = await readBoundedText(request);
  if (!text.trim()) return;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0) return;
  } catch {
    // The controlled error below covers malformed and non-empty payloads alike.
  }
  throw new UserManagementError("INVALID_REQUEST", "This action does not accept request fields.");
}

export function userManagementErrorResponse(error: unknown): Response {
  if (error instanceof UserManagementError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return Response.json(
    {
      error: {
        code: "USER_MANAGEMENT_FAILED",
        message: "The user-management operation could not be completed.",
      },
    },
    { status: 500 },
  );
}

async function readBoundedText(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_USER_MANAGEMENT_BODY_BYTES) {
      await reader.cancel();
      throw new UserManagementError("INVALID_REQUEST", "The request body is too large.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
