export async function healthHandler(_params: Record<string, unknown>) {
  return { status: "ok", service: "bookgen-mcp", version: "0.1.0" };
}

