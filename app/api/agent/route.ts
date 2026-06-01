import { NextResponse } from "next/server";

type AgentContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    };

type AgentMessage = {
  role: "system" | "user" | "assistant";
  content: string | AgentContentPart[];
};

type AgentRequest = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  mode?: "fast" | "heavy";
  messages?: AgentMessage[];
  canvasSummary?: string;
};

const DEFAULT_AGENT_BASE_URL = "https://api.moonshot.cn/v1";
const DEFAULT_AGENT_MODEL = "kimi-k2.5";

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as AgentRequest | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const baseUrl = normalizeBaseUrl(
    body.baseUrl || process.env.AGENT_BASE_URL || DEFAULT_AGENT_BASE_URL
  );
  const apiKey = body.apiKey || process.env.AGENT_API_KEY || "";
  const model = body.model || process.env.AGENT_MODEL || DEFAULT_AGENT_MODEL;
  const messages = body.messages || [];
  const mode = body.mode || "heavy";

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Missing provider settings",
        content:
          "还没有配置 Agent API Key。请在本机 .env.local 写入 AGENT_API_KEY，或在右侧 API 设置里填入 API Key；画布仍可继续用于拖图、圈注和复制修改指令。"
      },
      { status: 400 }
    );
  }

  const systemMessage: AgentMessage = {
    role: "system",
    content: [
      "你是一个运行在个人无限画布旁边的高级视觉设计 Agent。",
      "用户会把 AI 生成图、参考图或草图拖进画布，并用圆圈、箭头、文字、涂鸦、矩形框标注要修改的地方。",
      "如果用户上传了画布截图，你必须先观察截图里的图片、标注、空间关系和文字备注，再回答。",
      "你的目标不是闲聊，也不是泛泛描述图片，而是把画布转化为下一步可执行的视觉编辑方案。",
      "回答要像一个资深图片编辑导演：先判断用户真正想改什么，再给出可复制到图片编辑模型里的提示词。",
      "固定输出结构：1. 我看到了什么；2. 修改判断；3. 可复制修改提示词；4. 不要改动；5. 下一步建议。",
      "如果画布信息不足，直接指出缺口，并给用户一个最小补充动作。不要装作看见了不存在的细节。",
      body.canvasSummary ? `当前画布摘要：\n${body.canvasSummary}` : ""
    ]
      .filter(Boolean)
      .join("\n\n")
  };

  try {
    const requestBody: Record<string, unknown> = {
      model,
      messages: [systemMessage, ...messages],
      stream: false
    };

    if (model === DEFAULT_AGENT_MODEL) {
      requestBody.temperature = 1.0;
      requestBody.max_tokens = mode === "heavy" ? 8192 : 4096;
      requestBody.thinking =
        mode === "heavy" ? { type: "enabled" } : { type: "disabled" };
    }

    const upstream = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    const data = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      return NextResponse.json(
        {
          error: data?.error?.message || data?.message || upstream.statusText,
          raw: data
        },
        { status: upstream.status }
      );
    }

    const content =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      data?.output_text ||
      "";

    return NextResponse.json({ content, raw: data });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Agent request failed"
      },
      { status: 500 }
    );
  }
}
