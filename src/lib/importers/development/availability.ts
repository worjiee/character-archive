export const LIVE_IMPORT_UNAVAILABLE_MESSAGE =
  "Live source importing is currently under development.";

export function developmentImportUnavailableResponse(): Response {
  return Response.json(
    {
      error: {
        code: "IMPORT_UNAVAILABLE",
        message: LIVE_IMPORT_UNAVAILABLE_MESSAGE,
      },
    },
    { status: 501 },
  );
}

export function isDevelopmentFixtureEnabled(
  environment: Pick<NodeJS.ProcessEnv, "NODE_ENV"> = process.env,
): boolean {
  return environment.NODE_ENV !== "production";
}
