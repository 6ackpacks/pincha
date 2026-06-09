"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import DOMPurify from "dompurify";
import { ChatCircle, CaretLeft, CaretRight, PaperPlaneTilt, CircleNotch, Plus, ClockCounterClockwise, Trash } from "@phosphor-icons/react";
import { useAtom, useSetAtom } from "jotai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { streamWikiAsk, getMe, listConversations, createConversation, updateConversation, deleteConversation, type KBConversation } from "@/lib/api";
import { cn } from "@/lib/utils";
import { mascotAnimStateAtom } from "@/atoms/mascot";
import { activeKbIdAtom } from "@/atoms/kb";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const EXAMPLE_QUESTIONS = [
  "我留下过哪些关于 AI Agent 的线索？",
  "不同来源对 Transformer 有什么不同观点？",
  "整理一下我知识库里关于强化学习的内容",
];

function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-[3px] py-1">
      <span className="w-[5px] h-[5px] rounded-full bg-zinc-400 animate-[bounce_1.2s_ease-in-out_infinite]" />
      <span className="w-[5px] h-[5px] rounded-full bg-zinc-400 animate-[bounce_1.2s_ease-in-out_0.15s_infinite]" />
      <span className="w-[5px] h-[5px] rounded-full bg-zinc-400 animate-[bounce_1.2s_ease-in-out_0.3s_infinite]" />
    </span>
  );
}

function AiAvatar() {
  return (
    <div className="w-7 h-7 rounded-full shrink-0 mt-0.5 flex items-center justify-center bg-gradient-to-br from-emerald-400 to-teal-500 shadow-sm">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-white">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

function UserAvatar({ avatarUrl, nickname }: { avatarUrl?: string | null; nickname?: string | null }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={nickname ?? "用户"} className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5 shadow-sm" />;
  }
  return (
    <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
      <span className="text-[11px] font-semibold text-white">{(nickname ?? "U")[0].toUpperCase()}</span>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const rendered = useMemo(() => {
    let html = content;
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) =>
      `<pre class="bg-zinc-800 text-zinc-100 text-[11px] leading-relaxed rounded-lg px-3 py-2 my-1.5 overflow-x-auto font-mono"><code>${code.trim()}</code></pre>`
    );
    html = html.replace(/`([^`]+)`/g, '<code class="bg-zinc-100 text-zinc-700 text-[11px] px-1 py-0.5 rounded font-mono">$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/\n/g, '<br/>');
    return html;
  }, [content]);

  return (
    <div
      className="text-[13px] leading-[1.7] text-zinc-700 [&_pre]:whitespace-pre-wrap [&_strong]:text-zinc-900"
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(rendered) }}
    />
  );
}

interface KnowledgeQAPanelProps {
  defaultCollapsed?: boolean;
}

export function KnowledgeQAPanel({ defaultCollapsed = false }: KnowledgeQAPanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeKbId] = useAtom(activeKbIdAtom);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const activeConvoIdRef = useRef<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prevKbIdRef = useRef<string | null | undefined>(undefined);
  const setMascotAnim = useSetAtom(mascotAnimStateAtom);
  const queryClient = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe, retry: false, staleTime: 30 * 60 * 1000 });

  const prevDefaultCollapsed = useRef(defaultCollapsed);
  if (prevDefaultCollapsed.current !== defaultCollapsed) {
    prevDefaultCollapsed.current = defaultCollapsed;
    setCollapsed(defaultCollapsed);
  }
  useEffect(() => { activeConvoIdRef.current = activeConvoId; }, [activeConvoId]);

  const { data: conversations, isLoading: convosLoading } = useQuery({
    queryKey: ["kb-conversations", activeKbId],
    queryFn: () => listConversations(activeKbId!),
    enabled: !!activeKbId,
    staleTime: 30 * 1000,
  });

  // When KB changes, reset state and load conversations
  // eslint-disable-next-line react-hooks/set-state-in-effect -- state machine: KB switch triggers reset
  useEffect(() => {
    if (activeKbId === prevKbIdRef.current) return;
    prevKbIdRef.current = activeKbId;
    abortRef.current?.abort();
    setActiveConvoId(null);
    setMessages([]);
    setStreaming(false);
    setInitializing(true);
  }, [activeKbId]);

  // Abort streaming on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Once conversations load, auto-select or create
  // eslint-disable-next-line react-hooks/set-state-in-effect -- state machine: sync from query result
  useEffect(() => {
    if (!activeKbId || !initializing || convosLoading) return;
    if (conversations === undefined) return;

    if (conversations.length > 0) {
      const sorted = [...conversations].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      const latest = sorted[0];
      setActiveConvoId(latest.id);
      setMessages((latest.messages || []).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })));
      setInitializing(false);
    } else {
      createConversation(activeKbId, "新追问").then((convo) => {
        setActiveConvoId(convo.id);
        queryClient.invalidateQueries({ queryKey: ["kb-conversations", activeKbId] });
      }).catch(() => {}).finally(() => {
        setInitializing(false);
      });
    }
  }, [activeKbId, conversations, convosLoading, initializing, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => { if (animTimerRef.current) clearTimeout(animTimerRef.current); };
  }, []);

  const saveMessages = useCallback(async (msgs: Message[]) => {
    const kbId = activeKbId;
    let convoId = activeConvoIdRef.current;
    if (!kbId || msgs.length === 0) return;

    // If no conversation exists yet (race condition fallback), create one now
    if (!convoId) {
      try {
        const convo = await createConversation(kbId, "新追问");
        convoId = convo.id;
        setActiveConvoId(convo.id);
      } catch (e) {
        console.error("[QA] Failed to create conversation for save:", e);
        return;
      }
    }

    const firstUserMsg = msgs.find((m) => m.role === "user");
    const title = firstUserMsg
      ? firstUserMsg.content.slice(0, 20) + (firstUserMsg.content.length > 20 ? "…" : "")
      : "新追问";
    try {
      await updateConversation(kbId, convoId, {
        title,
        messages: msgs.map((m) => ({ role: m.role, content: m.content })),
      });
      queryClient.invalidateQueries({ queryKey: ["kb-conversations", kbId] });
    } catch (e) {
      console.error("[QA] Failed to save conversation:", e);
    }
  }, [activeKbId, queryClient]);

  const handleNewConversation = async () => {
    if (!activeKbId) return;
    try {
      const convo = await createConversation(activeKbId, "新追问");
      setActiveConvoId(convo.id);
      setMessages([]);
      queryClient.invalidateQueries({ queryKey: ["kb-conversations", activeKbId] });
    } catch {
      setMessages([]);
    }
    setShowHistory(false);
  };

  const handleSelectConversation = (convo: KBConversation) => {
    setActiveConvoId(convo.id);
    setMessages((convo.messages || []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })));
    setShowHistory(false);
  };

  const handleDeleteConversation = async (convoId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeKbId) return;
    try {
      await deleteConversation(activeKbId, convoId);
      if (activeConvoId === convoId) {
        setActiveConvoId(null);
        setMessages([]);
        setInitializing(true);
      }
      queryClient.invalidateQueries({ queryKey: ["kb-conversations", activeKbId] });
    } catch {}
  };

  const sendMessage = async (question: string) => {
    if (!question.trim() || streaming) return;
    const q = question.trim();
    setInput("");

    const userMessages: Message[] = [...messages, { role: "user", content: q }];
    const updatedMessages: Message[] = [
      ...userMessages,
      { role: "assistant", content: "" },
    ];
    setMessages(updatedMessages);
    setStreaming(true);
    setMascotAnim("thinking");
    if (animTimerRef.current) clearTimeout(animTimerRef.current);

    // Track assistant response outside React state to avoid batching issues
    let assistantMsg = "";
    let aborted = false;

    try {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const recentHistory = messages.slice(-6);
      const stream = await streamWikiAsk(q, undefined, recentHistory, { signal: controller.signal });
      const reader = stream.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6);
          if (raw === "[DONE]") break;
          let token = raw;
          try { token = JSON.parse(raw).delta ?? ""; } catch {}
          assistantMsg += token;
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", content: assistantMsg };
            return copy;
          });
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        aborted = true;
        return;
      }
      assistantMsg = "抱歉，回答时遇到了问题。请稍后再试。";
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: assistantMsg };
        return copy;
      });
    } finally {
      setStreaming(false);
      setMascotAnim("answer");
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
      animTimerRef.current = setTimeout(() => setMascotAnim("idle"), 3000);
      // Build final messages from the tracked assistantMsg (not from React state
      // which may not have flushed its updater queue yet due to batching)
      if (!aborted) {
        const finalMessages: Message[] = [
          ...userMessages,
          { role: "assistant", content: assistantMsg },
        ];
        saveMessages(finalMessages);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const canSend = input.trim().length > 0 && !streaming && !initializing;

  if (collapsed) {
    return (
      <div className="w-10 min-w-[40px] flex flex-col items-center py-4 gap-3 border-r border-zinc-100 bg-white">
        <button onClick={() => setCollapsed(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 transition-colors" title="展开追问面板">
          <CaretRight size={15} weight="bold" className="text-zinc-400" />
        </button>
        <div className="flex-1 flex items-center justify-center">
          <ChatCircle size={14} weight="bold" className="text-zinc-300" style={{ writingMode: "vertical-rl" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="w-[360px] min-w-[360px] flex flex-col border-r border-zinc-100 bg-[#fafafa]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-zinc-100">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-md bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="text-white">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-sm font-semibold text-zinc-800">知识追问</span>
          {streaming && <span className="text-[10px] text-emerald-500 font-medium animate-pulse">回答中</span>}
        </div>
        <button onClick={() => setCollapsed(true)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 transition-colors">
          <CaretLeft size={14} weight="bold" className="text-zinc-400" />
        </button>
      </div>

      {/* Conversation toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-zinc-100">
        <button onClick={handleNewConversation} className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-zinc-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors">
          <Plus size={12} weight="bold" />
          新追问
        </button>
        <div className="relative">
          <button onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 rounded-md transition-colors">
            <ClockCounterClockwise size={12} weight="bold" />
            历史
          </button>
          {showHistory && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowHistory(false)} />
              <div className="absolute left-0 top-full mt-1 z-50 w-64 bg-white rounded-xl border border-zinc-200 shadow-lg overflow-hidden">
                <div className="max-h-60 overflow-y-auto py-1">
                  {(conversations ?? []).length === 0 ? (
                    <p className="text-xs text-zinc-400 text-center py-4">暂无历史追问</p>
                  ) : (
                    [...(conversations ?? [])].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).map((c) => (
                      <div
                        key={c.id}
                        onClick={() => handleSelectConversation(c)}
                        className={cn("group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-50 transition-colors", c.id === activeConvoId && "bg-emerald-50")}
                      >
                        <div className="flex-1 min-w-0">
                          <p className={cn("text-xs truncate", c.id === activeConvoId ? "font-semibold text-emerald-700" : "text-zinc-700")}>{c.title}</p>
                          <p className="text-[10px] text-zinc-400">{new Date(c.updated_at).toLocaleDateString()}</p>
                        </div>
                        <button onClick={(e) => handleDeleteConversation(c.id, e)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 transition-all">
                          <Trash size={12} className="text-zinc-400 hover:text-red-500" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {initializing ? (
          <div className="flex justify-center py-10">
            <CircleNotch size={20} weight="bold" className="animate-spin text-zinc-300" />
          </div>
        ) : messages.length === 0 ? (
          <div className="space-y-2.5 mt-4">
            <p className="text-xs text-zinc-400 font-medium mb-3">试试这些问题：</p>
            {EXAMPLE_QUESTIONS.map((q) => (
              <button key={q} onClick={() => sendMessage(q)} className="w-full text-left text-[13px] px-3.5 py-2.5 rounded-xl border border-zinc-200 text-zinc-600 hover:border-emerald-300 hover:bg-white hover:text-emerald-700 hover:shadow-sm transition-all">
                {q}
              </button>
            ))}
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={cn("flex gap-2.5", msg.role === "user" ? "justify-end" : "justify-start")}>
              {msg.role === "assistant" && <AiAvatar />}
              <div className={cn("rounded-2xl max-w-[280px]", msg.role === "user" ? "bg-zinc-900 text-white px-3.5 py-2.5 rounded-br-md text-[13px] leading-[1.6]" : "bg-white border border-zinc-100 shadow-sm px-3.5 py-2.5 rounded-bl-md")}>
                {msg.role === "user" ? (
                  <span>{msg.content}</span>
                ) : msg.content ? (
                  <MarkdownContent content={msg.content} />
                ) : streaming && i === messages.length - 1 ? (
                  <TypingIndicator />
                ) : null}
              </div>
              {msg.role === "user" && <UserAvatar avatarUrl={me?.avatar_url} nickname={me?.nickname} />}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 bg-white border-t border-zinc-100">
        <div className={cn("flex items-end gap-2 bg-zinc-50 rounded-xl border px-3 py-2.5 transition-all", streaming || initializing ? "border-zinc-200 opacity-60" : "border-zinc-200 focus-within:border-emerald-300 focus-within:ring-2 focus-within:ring-emerald-100")}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={initializing ? "加载中…" : "追问你的知识库…"}
            rows={1}
            disabled={streaming || initializing}
            className="flex-1 bg-transparent text-[13px] text-zinc-800 placeholder-zinc-400 resize-none focus:outline-none min-h-[22px] max-h-[80px] disabled:cursor-not-allowed"
            style={{ lineHeight: "22px" }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!canSend}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-emerald-500 text-white disabled:opacity-30 hover:bg-emerald-600 active:scale-95 transition-all shrink-0"
          >
            {streaming ? <CircleNotch size={12} weight="bold" className="animate-spin" /> : <PaperPlaneTilt size={12} weight="bold" />}
          </button>
        </div>
        <p className="text-[10px] text-zinc-300 mt-1.5 text-center select-none">Enter 发送 · Shift+Enter 换行</p>
      </div>
    </div>
  );
}
