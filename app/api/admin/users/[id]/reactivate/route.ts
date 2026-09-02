import { requireAdminApiSession } from "@/src/lib/auth";
import { reactivateMember } from "@/src/lib/users/access-management";
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
    return Response.json({ user: await reactivateMember(id) });
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}
