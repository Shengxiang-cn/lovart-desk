"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  KeyRound,
  Loader2,
  MessageSquare,
  PanelRight,
  RefreshCcw,
  Send,
  Sparkles,
  Wand2
} from "lucide-react";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  {
    ssr: false,
    loading: () => <div className="excalidraw-holder" />
  }
);

type ChatRole = "assistant" | "user" | "system";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

type AgentMode = "heavy" | "fast";

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

type AgentOutboundMessage = {
  role: "user" | "assistant";
  content: string | AgentContentPart[];
};

type AgentSettings = {
  baseUrl: string;
  model: string;
  apiKey: string;
  mode: AgentMode;
};

type SavedScene = {
  elements: readonly ExcalidrawElement[];
  appState?: Partial<AppState>;
  files?: BinaryFiles;
};

const SCENE_STORAGE_KEY = "lovart-desk-scene-v1";
const SETTINGS_STORAGE_KEY = "lovart-desk-agent-settings-v1";
const KIMI_BASE_URL = "https://api.moonshot.cn/v1";
const KIMI_MODEL = "kimi-k2.5";

const DEFAULT_SETTINGS: AgentSettings = {
  baseUrl: KIMI_BASE_URL,
  model: KIMI_MODEL,
  apiKey: "",
  mode: "heavy"
};

const CAPTURE_IMMEDIATELY = "IMMEDIATELY";

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function liveElements(elements: readonly ExcalidrawElement[]) {
  return elements.filter((element) => !element.isDeleted);
}

function getText(element: ExcalidrawElement) {
  if (element.type !== "text") {
    return "";
  }

  const textElement = element as ExcalidrawElement & {
    text?: string;
    rawText?: string;
  };

  return (textElement.rawText || textElement.text || "").trim();
}

function selectedElements(
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState> | null
) {
  const selected = appState?.selectedElementIds || {};
  const selectedIds = new Set(
    Object.entries(selected)
      .filter(([, value]) => value)
      .map(([id]) => id)
  );

  if (selectedIds.size === 0) {
    return [];
  }

  return liveElements(elements).filter((element) => selectedIds.has(element.id));
}

function describeElement(element: ExcalidrawElement, index: number) {
  const common = `#${index + 1} ${element.type} at (${Math.round(element.x)}, ${Math.round(
    element.y
  )}), size ${Math.round(element.width)}x${Math.round(element.height)}`;

  if (element.type === "text") {
    return `${common}: "${getText(element)}"`;
  }

  return common;
}

function buildCanvasSummary(
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState> | null
) {
  const current = liveElements(elements);
  const selection = selectedElements(elements, appState);
  const counts = current.reduce<Record<string, number>>((acc, element) => {
    acc[element.type] = (acc[element.type] || 0) + 1;
    return acc;
  }, {});
  const textNotes = current
    .map(getText)
    .filter(Boolean)
    .slice(0, 16);
  const selectedLines = selection.slice(0, 20).map(describeElement);
  const annotationCount =
    (counts.ellipse || 0) +
    (counts.arrow || 0) +
    (counts.line || 0) +
    (counts.freedraw || 0) +
    (counts.rectangle || 0);

  const lines = [
    `画布元素：${current.length}`,
    `图片：${counts.image || 0}`,
    `文字：${counts.text || 0}`,
    `标注/圈选/箭头/涂鸦：${annotationCount}`,
    `当前选中：${selection.length || 0}`,
    textNotes.length ? `文字备注：\n${textNotes.map((text) => `- ${text}`).join("\n")}` : "",
    selectedLines.length
      ? `选中元素：\n${selectedLines.map((line) => `- ${line}`).join("\n")}`
      : "选中元素：无"
  ];

  return lines.filter(Boolean).join("\n");
}

function makeEditBrief(
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState> | null,
  userIntent: string
) {
  const summary = buildCanvasSummary(elements, appState);
  const selected = selectedElements(elements, appState);
  const scope =
    selected.length > 0
      ? "优先参考我当前选中的元素，以及附近的圆圈、箭头、文字备注。"
      : "请参考整张画布里的圆圈、箭头、文字备注和图片摆放关系。";

  return [
    "请根据我的画布标注，帮我修改这张图片。",
    "",
    "修改目标：",
    userIntent.trim() || "把我标注出来的位置按备注进行修改，保持主体、构图和已有优点不变。",
    "",
    "画布上下文：",
    summary,
    "",
    "执行要求：",
    `- ${scope}`,
    "- 只修改被标注或明确提到的区域，不要重绘整张图。",
    "- 保留原始风格、光线、透视、主体身份和构图关系。",
    "- 如果有多个圈注，请逐项处理，并让修改结果自然融合。",
    "- 输出一版可直接生成/编辑图片的清晰提示词。"
  ].join("\n");
}

function loadScene(): SavedScene | null {
  try {
    const raw = localStorage.getItem(SCENE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as SavedScene;
  } catch {
    return null;
  }
}

function loadSettings(): AgentSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const saved = {
      ...DEFAULT_SETTINGS,
      ...(JSON.parse(raw) as Partial<AgentSettings>)
    };

    if (!saved.baseUrl || saved.baseUrl === "https://api.example.com/v1") {
      saved.baseUrl = KIMI_BASE_URL;
    }

    if (!saved.model || saved.model === "your-chat-model") {
      saved.model = KIMI_MODEL;
    }

    if (saved.mode !== "heavy" && saved.mode !== "fast") {
      saved.mode = "heavy";
    }

    return saved;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to serialize canvas snapshot"));
    reader.readAsDataURL(blob);
  });
}

async function exportCanvasSnapshot(options: {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState> | null;
  files: BinaryFiles;
}) {
  const current = liveElements(options.elements);

  if (!current.length) {
    return null;
  }

  const { exportToBlob } = await import("@excalidraw/excalidraw");
  const blob = await exportToBlob({
    elements: current,
    appState: {
      ...options.appState,
      exportBackground: true,
      viewBackgroundColor: options.appState?.viewBackgroundColor || "#fffaf0"
    },
    files: options.files,
    mimeType: "image/png",
    maxWidthOrHeight: 1800,
    exportPadding: 64
  } as Parameters<typeof exportToBlob>[0]);

  return blobToDataUrl(blob);
}

function buildAgentPrompt(options: {
  userIntent: string;
  canvasSummary: string;
  hasSnapshot: boolean;
}) {
  return [
    `用户当前要求：${options.userIntent}`,
    "",
    options.hasSnapshot
      ? "我随消息附上了当前画布截图。截图里包含原图、参考图、圈选、箭头、文字备注和摆放关系，请以截图为主进行判断。"
      : "当前没有可用画布截图，请基于文字摘要判断；如果信息不足，请明确要求我补充截图或标注。",
    "",
    "画布结构化摘要：",
    options.canvasSummary,
    "",
    "请输出：",
    "1. 我看到了什么：只说和修改有关的视觉事实。",
    "2. 修改判断：推断我真正想改的区域和目标。",
    "3. 可复制修改提示词：一段可以直接粘回 ChatGPT 图片编辑或其他图片模型的中文提示词。",
    "4. 不要改动：列出需要保留的主体、构图、风格、光线、身份、材质。",
    "5. 下一步建议：如果还需要我圈选/补图，给最小动作。"
  ].join("\n");
}

function buildOutboundContent(prompt: string, snapshotDataUrl: string | null) {
  if (!snapshotDataUrl) {
    return prompt;
  }

  return [
    {
      type: "image_url",
      image_url: {
        url: snapshotDataUrl
      }
    },
    {
      type: "text",
      text: prompt
    }
  ] satisfies AgentContentPart[];
}

function getImageSize(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        width: image.naturalWidth || image.width || 720,
        height: image.naturalHeight || image.height || 720
      });
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = src;
  });
}

function scaleToFit(width: number, height: number, maxSize = 560) {
  const ratio = Math.min(1, maxSize / Math.max(width, height));
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio)
  };
}

function makeImageElement(options: {
  fileId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
}) {
  return {
    id: createId(),
    type: "image",
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    angle: 0,
    fileId: options.fileId,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    boundElements: null,
    seed: Math.floor(Math.random() * 2_000_000_000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2_000_000_000),
    isDeleted: false,
    updated: Date.now(),
    link: null,
    locked: false,
    status: "saved",
    scale: [1, 1],
    crop: null,
    customData: {
      source: "chatgpt-drop",
      title: options.title
    }
  } as unknown as ExcalidrawElement;
}

function viewportToScenePoint(
  clientX: number,
  clientY: number,
  appState: AppState
) {
  return {
    x: (clientX - appState.offsetLeft) / appState.zoom.value - appState.scrollX,
    y: (clientY - appState.offsetTop) / appState.zoom.value - appState.scrollY
  };
}

export function CreativeDesk() {
  const excalidrawRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const saveTimer = useRef<number | null>(null);
  const elementsRef = useRef<readonly ExcalidrawElement[]>([]);
  const filesRef = useRef<BinaryFiles>({});
  const appStateRef = useRef<Partial<AppState> | null>(null);

  const [initialData, setInitialData] = useState<SavedScene | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [elements, setElements] = useState<readonly ExcalidrawElement[]>([]);
  const [files, setFiles] = useState<BinaryFiles>({});
  const [appState, setAppState] = useState<Partial<AppState> | null>(null);
  const [tab, setTab] = useState<"chat" | "settings">("chat");
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isDropActive, setIsDropActive] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: createId(),
      role: "assistant",
      content:
        "我会根据画布里的图片、圈注、箭头和文字备注，帮你整理下一轮可复制到 ChatGPT 的修改指令。"
    }
  ]);

  useEffect(() => {
    setInitialData(loadScene());
    setSettings(loadSettings());
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const metrics = useMemo(() => {
    const current = liveElements(elements);
    const counts = current.reduce<Record<string, number>>((acc, element) => {
      acc[element.type] = (acc[element.type] || 0) + 1;
      return acc;
    }, {});

    return {
      images: counts.image || 0,
      notes: counts.text || 0,
      marks:
        (counts.ellipse || 0) +
        (counts.arrow || 0) +
        (counts.line || 0) +
        (counts.freedraw || 0) +
        (counts.rectangle || 0)
    };
  }, [elements]);

  const currentSummary = useMemo(
    () => buildCanvasSummary(elements, appState),
    [elements, appState]
  );

  const handleChange = useCallback(
    (
      nextElements: readonly ExcalidrawElement[],
      nextAppState: AppState,
      nextFiles: BinaryFiles
    ) => {
      elementsRef.current = nextElements;
      appStateRef.current = nextAppState;
      filesRef.current = nextFiles;
      setElements(nextElements);
      setAppState(nextAppState);
      setFiles(nextFiles);

      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }

      saveTimer.current = window.setTimeout(() => {
        const snapshot: SavedScene = {
          elements: elementsRef.current,
          appState: {
            viewBackgroundColor: appStateRef.current?.viewBackgroundColor,
            gridSize: appStateRef.current?.gridSize,
            currentItemStrokeColor: appStateRef.current?.currentItemStrokeColor,
            currentItemBackgroundColor:
              appStateRef.current?.currentItemBackgroundColor,
            currentItemFillStyle: appStateRef.current?.currentItemFillStyle,
            currentItemStrokeWidth: appStateRef.current?.currentItemStrokeWidth,
            currentItemRoughness: appStateRef.current?.currentItemRoughness,
            currentItemOpacity: appStateRef.current?.currentItemOpacity
          },
          files: filesRef.current
        };
        localStorage.setItem(SCENE_STORAGE_KEY, JSON.stringify(snapshot));
      }, 450);
    },
    []
  );

  const copyText = useCallback(async (text: string, success: string) => {
    await navigator.clipboard.writeText(text);
    setToast(success);
  }, []);

  const handleCompose = useCallback(async () => {
    const brief = makeEditBrief(elementsRef.current, appStateRef.current, draft);
    setMessages((prev) => [
      ...prev,
      { id: createId(), role: "assistant", content: brief }
    ]);
    await copyText(brief, "修改指令已复制");
  }, [copyText, draft]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: text
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");

    if (!settings.baseUrl || !settings.model) {
      const brief = makeEditBrief(elementsRef.current, appStateRef.current, text);
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: "assistant",
          content: brief
        }
      ]);
      setToast("未配置 API，已生成本地修改指令");
      return;
    }

    setIsSending(true);
    try {
      const canvasSummary = buildCanvasSummary(
        elementsRef.current,
        appStateRef.current
      );
      let snapshotDataUrl: string | null = null;

      if (settings.mode === "heavy") {
        setToast("重模式正在读取画布");
        snapshotDataUrl = await exportCanvasSnapshot({
          elements: elementsRef.current,
          appState: appStateRef.current,
          files: filesRef.current
        }).catch(() => null);
      }

      const prompt = buildAgentPrompt({
        userIntent: text,
        canvasSummary,
        hasSnapshot: Boolean(snapshotDataUrl)
      });
      const outboundMessages: AgentOutboundMessage[] = nextMessages
        .filter(
          (
            message
          ): message is ChatMessage & { role: "user" | "assistant" } =>
            message.role === "user" || message.role === "assistant"
        )
        .map(({ role, content }) => ({ role, content }));

      outboundMessages[outboundMessages.length - 1] = {
        role: "user",
        content: buildOutboundContent(prompt, snapshotDataUrl)
      };

      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          canvasSummary,
          messages: outboundMessages
        })
      });
      const data = (await response.json()) as { content?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Agent request failed");
      }
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: "assistant",
          content: data.content || "Agent 没有返回内容。"
        }
      ]);
      if (snapshotDataUrl) {
        setToast("已发送带标注画布给 Kimi 2.5");
      }
    } catch (error) {
      const brief = makeEditBrief(elementsRef.current, appStateRef.current, text);
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: "system",
          content: `${error instanceof Error ? error.message : "Agent 调用失败"}\n\n${brief}`
        }
      ]);
    } finally {
      setIsSending(false);
    }
  }, [draft, isSending, messages, settings]);

  const handleClear = useCallback(() => {
    if (!window.confirm("Clear the current canvas?")) {
      return;
    }
    excalidrawRef.current?.resetScene();
    localStorage.removeItem(SCENE_STORAGE_KEY);
    setToast("画布已清空");
  }, []);

  const handleExport = useCallback(() => {
    downloadJson(`lovart-desk-${new Date().toISOString().slice(0, 10)}.json`, {
      type: "lovart-desk-scene",
      elements: elementsRef.current,
      appState: appStateRef.current,
      files: filesRef.current
    });
    setToast("画布 JSON 已导出");
  }, []);

  const handleResetView = useCallback(() => {
    const api = excalidrawRef.current;
    if (!api) {
      return;
    }
    const visible = liveElements(api.getSceneElements());
    if (visible.length) {
      api.scrollToContent(visible, { fitToContent: true });
    }
  }, []);

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLElement>) => {
      const imageFiles = Array.from(event.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/")
      );

      if (imageFiles.length === 0) {
        return;
      }

      event.preventDefault();
      setIsDropActive(false);

      const api = excalidrawRef.current;
      if (!api) {
        return;
      }

      const state = api.getAppState();
      const point = viewportToScenePoint(event.clientX, event.clientY, state);

      const addedElements: ExcalidrawElement[] = [];
      const addedFiles: BinaryFileData[] = [];
      let cursorY = point.y;

      for (const file of imageFiles) {
        const dataURL = await readAsDataUrl(file);
        const natural = await getImageSize(dataURL);
        const size = scaleToFit(natural.width, natural.height);
        const fileId = createId();

        addedFiles.push({
          id: fileId as BinaryFileData["id"],
          dataURL: dataURL as BinaryFileData["dataURL"],
          mimeType: file.type as BinaryFileData["mimeType"],
          created: Date.now(),
          lastRetrieved: Date.now()
        });
        addedElements.push(
          makeImageElement({
            fileId,
            x: point.x,
            y: cursorY,
            width: size.width,
            height: size.height,
            title: file.name
          })
        );
        cursorY += size.height + 32;
      }

      api.addFiles(addedFiles);
      api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), ...addedElements],
        captureUpdate: CAPTURE_IMMEDIATELY
      });
      api.scrollToContent(addedElements, { fitToContent: true });
      setToast(`${addedElements.length} 张图片已放入画布`);
    },
    []
  );

  if (!isLoaded) {
    return <main className="desk" />;
  }

  return (
    <main className="desk">
      <section
        className={`canvas-shell ${isDropActive ? "drop-active" : ""}`}
        onDragEnter={(event) => {
          if (Array.from(event.dataTransfer.items).some((item) => item.type.startsWith("image/"))) {
            setIsDropActive(true);
          }
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) {
            setIsDropActive(false);
          }
        }}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.items).some((item) => item.type.startsWith("image/"))) {
            event.preventDefault();
          }
        }}
        onDrop={handleDrop}
      >
        <div className="canvas-topbar">
          <div className="brand-strip">
            <div className="brand-mark">
              <Sparkles size={17} />
            </div>
            <div className="brand-title">
              <strong>Lovart Desk</strong>
              <span>ChatGPT 会员图片工作台</span>
            </div>
          </div>

          <div className="canvas-actions">
            <div className="status-chip">
              {metrics.images} 图 / {metrics.marks} 标注 / {metrics.notes} 备注
            </div>
            <button
              className="icon-button"
              onClick={handleResetView}
              title="Fit to content"
              type="button"
            >
              <RefreshCcw size={16} />
            </button>
            <button
              className="icon-button"
              onClick={handleExport}
              title="Export scene"
              type="button"
            >
              <Download size={16} />
            </button>
            <button
              className="icon-button"
              onClick={handleClear}
              title="Clear canvas"
              type="button"
            >
              <Eraser size={16} />
            </button>
          </div>
        </div>

        <div className="excalidraw-holder">
          <Excalidraw
            excalidrawAPI={(api) => {
              excalidrawRef.current = api;
            }}
            initialData={{
              elements: initialData?.elements || [],
              appState: {
                viewBackgroundColor: "#fffaf0",
                gridSize: 20,
                ...(initialData?.appState || {})
              },
              files: initialData?.files || {}
            }}
            onChange={handleChange}
            UIOptions={{
              canvasActions: {
                loadScene: true,
                saveToActiveFile: true,
                export: { saveFileToDisk: true },
                saveAsImage: true
              }
            }}
          />
        </div>
        {isDropActive ? <div className="drop-hint">Drop image</div> : null}
        {toast ? <div className="toast">{toast}</div> : null}
      </section>

      <aside className="agent-panel">
        <header className="panel-header">
          <div className="panel-heading">
            <Bot size={20} />
            <div>
              <h1>Canvas Agent</h1>
              <p>整理标注，生成下一轮修改指令</p>
            </div>
          </div>
          <a
            className="icon-button"
            href="https://chatgpt.com/"
            rel="noreferrer"
            target="_blank"
            title="Open ChatGPT"
          >
            <ExternalLink size={16} />
          </a>
        </header>

        <div className="tabs">
          <button
            className={`tab ${tab === "chat" ? "active" : ""}`}
            onClick={() => setTab("chat")}
            type="button"
          >
            <MessageSquare size={14} /> Chat
          </button>
          <button
            className={`tab ${tab === "settings" ? "active" : ""}`}
            onClick={() => setTab("settings")}
            type="button"
          >
            <KeyRound size={14} /> API
          </button>
        </div>

        {tab === "chat" ? (
          <div className="panel-body">
            <section className="summary-card">
              <h2>画布状态</h2>
              <div className="summary-grid">
                <div className="metric">
                  <strong>{metrics.images}</strong>
                  <span>图片</span>
                </div>
                <div className="metric">
                  <strong>{metrics.marks}</strong>
                  <span>标注</span>
                </div>
                <div className="metric">
                  <strong>{metrics.notes}</strong>
                  <span>备注</span>
                </div>
              </div>
              <div className="agent-mode-line">
                {settings.mode === "heavy"
                  ? "重模式：发送带标注画布截图 + Kimi 2.5 思考"
                  : "快模式：仅发送文字摘要"}
              </div>
            </section>

            <section className="messages">
              {messages.map((message) => (
                <article className={`message ${message.role}`} key={message.id}>
                  {message.content}
                </article>
              ))}
            </section>

            <div className="composer">
              <textarea
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    void handleSend();
                  }
                }}
                placeholder="例：把红圈里的手改自然一点，背景不要变；箭头指到的 logo 去掉。"
                value={draft}
              />
              <div className="composer-row">
                <div className="composer-actions">
                  <button
                    className="text-button"
                    onClick={handleCompose}
                    type="button"
                  >
                    <Copy size={14} /> 复制指令
                  </button>
                  <button
                    className="text-button"
                    onClick={() => copyText(currentSummary, "画布摘要已复制")}
                    type="button"
                  >
                    <PanelRight size={14} /> 摘要
                  </button>
                </div>
                <button
                  className="text-button primary"
                  disabled={isSending || !draft.trim()}
                  onClick={handleSend}
                  type="button"
                >
                  {isSending ? <Loader2 className="spin" size={14} /> : <Send size={14} />}
                  发送
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="settings">
            <section className="settings-section">
              <h2>第三方 Agent API</h2>
              <div className="field">
                <label>Agent 模式</label>
                <div className="mode-control">
                  <button
                    className={settings.mode === "heavy" ? "active" : ""}
                    onClick={() =>
                      setSettings((prev) => ({ ...prev, mode: "heavy" }))
                    }
                    type="button"
                  >
                    重模式
                  </button>
                  <button
                    className={settings.mode === "fast" ? "active" : ""}
                    onClick={() =>
                      setSettings((prev) => ({ ...prev, mode: "fast" }))
                    }
                    type="button"
                  >
                    快模式
                  </button>
                </div>
              </div>
              <div className="field">
                <label htmlFor="base-url">Base URL</label>
                <input
                  id="base-url"
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, baseUrl: event.target.value }))
                  }
                  placeholder={KIMI_BASE_URL}
                  value={settings.baseUrl}
                />
              </div>
              <div className="field">
                <label htmlFor="model">Model</label>
                <input
                  id="model"
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, model: event.target.value }))
                  }
                  placeholder={KIMI_MODEL}
                  value={settings.model}
                />
              </div>
              <div className="field">
                <label htmlFor="api-key">API Key</label>
                <input
                  id="api-key"
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, apiKey: event.target.value }))
                  }
                  placeholder="sk-..."
                  type="password"
                  value={settings.apiKey}
                />
              </div>
              <p className="settings-note">
                默认接中国站 Kimi 2.5。重模式会发送当前画布截图并启用思考；API Key 可留空，服务端会优先读取本机 .env.local。
              </p>
            </section>

            <section className="settings-section">
              <h2>Agent 指令底稿</h2>
              <div className="field">
                <label htmlFor="brief-preview">当前摘要</label>
                <textarea id="brief-preview" readOnly value={currentSummary} />
              </div>
              <button
                className="text-button hot"
                onClick={() =>
                  copyText(
                    makeEditBrief(elementsRef.current, appStateRef.current, draft),
                    "完整底稿已复制"
                  )
                }
                type="button"
              >
                <Wand2 size={14} /> 复制完整底稿
              </button>
            </section>
          </div>
        )}
      </aside>
    </main>
  );
}
