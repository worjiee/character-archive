import { requireAdminApiSession } from "@/src/lib/auth";
import { revokeMember } from "@/src/lib/users/access-management";
import { assertEmptyUserManagementBody, userManagementErrorResponse } from "../../errors";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    await assertEmptyUserManagementBody(request);
    return Response.json({ user: await revokeMember(id) });
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}
