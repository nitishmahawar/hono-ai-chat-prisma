import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { auth } from "@/lib/auth";
import chat from "@/chat";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

app.get("/", (c) => {
  return c.text("Hono AI Chat API!");
});

app.use("*", logger(), async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    c.set("user", null);
    c.set("session", null);
    return next();
  }

  c.set("user", session.user);
  c.set("session", session.session);
  return next();
});

app.use(
  "/api/auth/**", // or replace with "*" to enable cors for all routes
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  })
);

app.on(["POST", "GET"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
});

app
  .use(async (c, next) => {
    const user = c.get("user");
    const session = c.get("session");
    if (!user || !session) {
      throw new HTTPException(401, { message: "Unauthorized!" });
    }
    return next();
  })
  .route("/api/chat", chat);

app.notFound((c) => {
  return c.json({
    success: false,
    error: "Requested endpoint not found!",
  });
});

app.onError((error, c) => {
  console.log("ON ERROR");
  if (error instanceof HTTPException) {
    return c.json({
      success: false,
      error: error.message,
    });
  }

  if (error instanceof ZodError) {
    return c.json(
      { success: false, error: fromZodError(error).toString() },
      400
    );
  }

  return c.json(
    {
      success: false,
      error: "Internal Server Error!",
    },
    500
  );
});

const port = 3000;
console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
