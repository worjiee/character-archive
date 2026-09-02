import { requireAdminApiSession } from "@/src/lib/auth";
import { createMember, listManagedUsers } from "@/src/lib/users/access-management";
import { readUserManagementJson, userManagementErrorResponse } from "./errors";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const response = Response.json({ users: await listManagedUsers() });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    return Response.json(
      { user: await createMember(await readUserManagementJson(request)) },
      { status: 201 },
    );
  } catch (error) {
    return userManagementErrorResponse(error);
  }
}
