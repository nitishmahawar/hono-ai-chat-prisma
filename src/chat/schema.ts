import z from "zod";

export const conversationMessagesSchema = z
  .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
  .min(1, { message: "Messages are required!" });

export const createConversationSchema = z.object({
  conversationId: z.string().optional(),
  messages: conversationMessagesSchema,
});

export const patchConversationSchema = z.object({
  title: z.string().min(1, { message: "Title is required" }),
});

export const getConversationSchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().min(10).max(50).default(15),
});
