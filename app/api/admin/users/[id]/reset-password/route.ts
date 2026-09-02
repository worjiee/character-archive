import { requireAdminApiSession } from "@/src/lib/auth";
import { resetMemberPassword } from "@/src/lib/users/access-management";
import { readUserManagementJson, userManagementErrorResponse } from "../../errors";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    return Response.json({
      user: await resetMemberPassword(id, await readUserManagementJson(request)),
    });
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}
