import { database } from "./postgres";
import { withRequest } from "./database-context";
import { after } from "next/server";
import { withSystem } from "./database-context";
export function observe(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    const started = performance.now(),
      requestId = crypto.randomUUID();
    const path = new URL(request.url).pathname;
    const route = path
      .replace(/\/[0-9a-f-]{20,}|\/(?:pay|wallet|fx)-[0-9a-f]+/gi, "/:id")
      .slice(0, 150);
    let response: Response;
    try {
      response = await withRequest(requestId, () => handler(request));
    } catch (error) {
      if (
        error instanceof Error &&
        /MANAGED_MOVEMENT_IMMUTABLE|CLOSED_INVOICE_IMMUTABLE/.test(
          error.message,
        )
      )
        return Response.json(
          {
            error:
              "Movimentação protegida. Registre um ajuste ou estorno na tela de origem.",
            requestId,
          },
          { status: 409 },
        );
      console.error(
        JSON.stringify({
          event: "request_error",
          requestId,
          route,
          code: error instanceof Error ? error.name : "Error",
        }),
      );
      response = Response.json(
        { error: "Não foi possível concluir. Tente novamente.", requestId },
        { status: 500 },
      );
    }
    const duration = Math.round(performance.now() - started);
    response.headers.set("X-Request-ID", requestId);
    response.headers.set("Server-Timing", `app;dur=${duration}`);
    console.info(
      JSON.stringify({
        event: "request",
        requestId,
        route,
        method: request.method,
        status: response.status,
        durationMs: duration,
      }),
    );
    // Persist actionable failures and slow requests; routine timings stay in provider logs.
    if (response.status >= 500 || duration >= 1500) {
      try {
        await database
          .prepare(
            "INSERT INTO operation_events(created,request_id,route,status,duration_ms,code) VALUES(?,?,?,?,?,?)",
          )
          .bind(
            Date.now(),
            requestId,
            route,
            response.status,
            duration,
            response.status >= 500 ? "HTTP_ERROR" : "SLOW_REQUEST",
          )
          .run();
      } catch {
        console.error(
          JSON.stringify({
            event: "monitoring_storage_unavailable",
            requestId,
          }),
        );
      }
    }
    if (
      !process.env.WZY_TEST_SCHEMA &&
      response.status === 200 &&
      route === "/api/workspace/snapshot"
    )
      after(async () => {
        try {
          const { dailyMaintenance } =
            await import("./modules/backups/maintenance");
          await withSystem(() =>
            dailyMaintenance({
              register: false,
              maxUsers: 5,
              timeBudget: 8000,
            }),
          );
        } catch {
          console.error(
            JSON.stringify({ event: "maintenance_resume_failed", requestId }),
          );
        }
      });
    return response;
  };
}
