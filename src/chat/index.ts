import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  generateTitleFromUserMessage,
  getMostRecentUserMessage,
} from "@/lib/utils";
import { convertToCoreMessages, Message, streamText } from "ai";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import {
  createConversationSchema,
  getConversationSchema,
  patchConversationSchema,
} from "./schema";
import { Conversation } from "@prisma/client";
import { groq } from "@ai-sdk/groq";

const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user;
    session: typeof auth.$Infer.Session.session;
  };
}>();

app
  .post("/", zValidator("json", createConversationSchema), async (c) => {
    const user = c.get("user");
    const { conversationId, messages } = c.req.valid("json");

    const coreMessages = convertToCoreMessages(messages);
    const userMessage = getMostRecentUserMessage(messages);

    if (!userMessage) {
      throw new HTTPException(400, { message: "User message not found!" });
    }

    let conversation: Conversation | null = null;

    if (conversationId) {
      conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });

      if (!conversation) {
        throw new HTTPException(404, { message: "Conversation not found!" });
      }
    } else {
      const chatTitle = await generateTitleFromUserMessage({
        message: userMessage,
      });

      conversation = await prisma.conversation.create({
        data: { title: chatTitle, userId: user.id },
      });
    }

    const result = streamText({
      model: groq("llama-3.3-70b-versatile"),
      messages: coreMessages,
      onFinish: async (e) => {
        await prisma.message.createMany({
          data: [
            {
              content: userMessage.content.toString(),
              role: "user",
              conversationId: conversation.id,
            },
            {
              content: e.text,
              role: "assistant",
              conversationId: conversation.id,
            },
          ],
        });
      },
    });

    return result.toDataStreamResponse();
  })
  .get("/", zValidator("query", getConversationSchema), async (c) => {
    const user = c.get("user");
    const { limit, page } = c.req.valid("query");

    const offset = (page - 1) * limit;

    const [conversationCount, conversations] = await Promise.all([
      prisma.conversation.count({ where: { userId: user.id } }),
      prisma.conversation.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
    ]);

    const totalPages = Math.ceil(conversationCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    return c.json({
      success: true,
      data: conversations,
      message: "Conversations fetched successfully!",
      pagination: {
        page,
        limit,
        totalPages,
        totalItems: conversationCount,
        hasNextPage,
        hasPreviousPage,
        nextPage: hasNextPage ? page + 1 : null,
        previousPage: hasPreviousPage ? page - 1 : null,
      },
    });
  })
  .get("/:id", async (c) => {
    const user = c.get("user");
    const { id } = c.req.param();

    const conversation = await prisma.conversation.findUnique({
      where: { id, userId: user.id },
    });

    if (!conversation) {
      throw new HTTPException(404, { message: "Conversation not found!" });
    }

    return c.json({
      success: true,
      data: conversation,
      message: "Conversation fetched successfully!",
    });
  })
  .patch("/:id", zValidator("json", patchConversationSchema), async (c) => {
    const user = c.get("user");
    const { id } = c.req.param();
    const { title } = c.req.valid("json");

    const conversation = await prisma.conversation.findUnique({
      where: { id, userId: user.id },
    });

    if (!conversation) {
      throw new HTTPException(404, { message: "Conversation not found!" });
    }

    const updatedConversation = await prisma.conversation.update({
      where: { id, userId: user.id },
      data: { title },
    });

    return c.json({
      success: true,
      data: updatedConversation,
      message: "Conversation title updated!",
    });
  })
  .delete("/:id", async (c) => {
    const { id } = c.req.param();
    const user = c.get("user");

    const conversation = await prisma.conversation.delete({
      where: { id, userId: user.id },
    });

    return c.json({
      success: true,
      data: conversation,
      message: "Conversation deleted!",
    });
  })
  .get("/:id/messages", async (c) => {
    const user = c.get("user");
    const { id } = c.req.param();

    const conversation = await prisma.conversation.findUnique({
      where: { id, userId: user.id },
    });

    if (!conversation) {
      throw new HTTPException(404, { message: "Conversation not found!" });
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
    });

    return c.json({
      success: true,
      data: messages,
      message: "Messages fetched successfully!",
    });
  });

export default app;
