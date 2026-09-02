export class BridgeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.status = status;
  }
}

export function bridgeErrorResponse(error: unknown): Response {
  if (error instanceof BridgeError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  console.error("Browser bridge request failed", error);
  return Response.json(
    { error: { code: "BRIDGE_FAILED", message: "The bridge request could not be completed." } },
    { status: 500 },
  );
}
