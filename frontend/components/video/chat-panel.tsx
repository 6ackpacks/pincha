"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { PaperPlaneTilt, CircleNotch, Sparkle, Trash } from "@phosphor-icons/react";
import { streamVideoAsk, getChatHistory, saveChatMessages, clearChatHistory } from "@/lib/api/videos";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface ChatPanelProps {
  videoId: string;
  videoTitle?: string;
  isDone: boolean;
}

const EXAMPLE_QUESTIONS = [
  "这个视频讲了什么？",
  "有哪些关键观点？",
  "请用3句话总结",
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

export default function ChatPanel({ videoId, videoTitle, isDone }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load chat history on mount
  useEffect(() => {
    if (!isDone || historyLoaded) return;
    getChatHistory(videoId)
      .then((history) => {
        if (history.length > 0) {
          setMessages(
            history.map((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
            }))
          );
        }
      })
      .catch(() => {})
      .finally(() => setHistoryLoaded(true));
  }, [videoId, isDone, historyLoaded]);

  // Abort streaming on unmount or videoId change
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, [videoId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(
    async (question: string) => {
      if (!question.trim() || isSending) return;
      setInput("");
      setIsSending(true);

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content: question.trim(),
      };
      const aiMsgId = `ai-${Date.now()}`;
      const aiMsg: Message = {
        id: aiMsgId,
        role: "assistant",
        content: "",
        streaming: true,
      };

      setMessages((prev) => [...prev, userMsg, aiMsg]);

      let finalContent = "";

      try {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const stream = await streamVideoAsk(videoId, question.trim(), { signal: controller.signal });
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            // Handle SSE error events (event: error\ndata: {...})
            if (line.startsWith("event: error")) {
              const dataLine = line.split("\n").find((l) => l.startsWith("data: "));
              if (dataLine) {
                try {
                  const parsed = JSON.parse(dataLine.slice(6));
                  finalContent = parsed.message ?? "追问出错，请稍后重试";
                } catch {
                  finalContent = "追问出错，请稍后重试";
                }
              } else {
                finalContent = "追问出错，请稍后重试";
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, content: finalContent, streaming: false }
                    : m
                )
              );
              break;
            }
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              const delta = parsed.delta ?? payload;
              finalContent += delta;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId ? { ...m, content: m.content + delta } : m
                )
              );
            } catch {
              finalContent += payload;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId ? { ...m, content: m.content + payload } : m
                )
              );
            }
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        finalContent = "抱歉，追问出错了。请稍后重试。";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? { ...m, content: finalContent, streaming: false }
              : m
          )
        );
      } finally {
        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, streaming: false } : m))
        );
        setIsSending(false);
        textareaRef.current?.focus();

        // Save the exchange to backend
        if (finalContent) {
          saveChatMessages(videoId, [
            { role: "user", content: question.trim() },
            { role: "assistant", content: finalContent },
          ]).catch(() => {});
        }
      }
    },
    [videoId, isSending]
  );

  const handleClearHistory = async () => {
    await clearChatHistory(videoId).catch(() => {});
    setMessages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // ── Video not done yet ──
  if (!isDone) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center">
          <Sparkle className="w-7 h-7 text-zinc-400" />
        </div>
        <p className="text-sm font-bold text-zinc-500">内容整理完成后即可继续追问</p>
      </div>
    );
  }

  // ── Chat UI ──
  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header with clear button */}
      {messages.length > 0 && (
        <div className="shrink-0 px-4 py-2 border-b border-zinc-100 flex items-center justify-between">
          <span className="text-xs text-zinc-400">{messages.length} 条追问</span>
          <button
            onClick={handleClearHistory}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-red-500 transition-colors"
          >
            <Trash size={12} weight="bold" />
            清空
          </button>
        </div>
      )}
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 min-h-0">
        {/* Example questions (shown only when empty) */}
        <AnimatePresence>
          {isEmpty && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col gap-3 mt-2"
            >
              <p className="text-xs font-bold text-zinc-400 text-center">可以从这些问题开始追问</p>
              <div className="flex flex-col gap-2">
                {EXAMPLE_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    disabled={isSending}
                    className="w-full text-left px-4 py-3 rounded-2xl bg-zinc-50 border border-zinc-200 text-sm font-medium text-zinc-700 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 transition-all"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Message list */}
        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                msg.role === "user"
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-100 text-zinc-800"
              )}
            >
              {msg.role === "assistant" ? (
                <div className="prose prose-sm prose-zinc max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-pre:my-2 prose-code:text-xs prose-code:bg-zinc-200 prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
                  <ReactMarkdown>{msg.content || ""}</ReactMarkdown>
                  {msg.streaming && !msg.content && <TypingIndicator />}
                </div>
              ) : (
                <span>{msg.content}</span>
              )}
            </div>
          </motion.div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-zinc-200 p-3 bg-white">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
            placeholder="输入问题... (Enter 发送，Shift+Enter 换行)"
            rows={1}
            className={cn(
              "flex-1 resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm font-medium text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 transition-all",
              "max-h-32 overflow-y-auto"
            )}
            style={{ minHeight: "42px" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
            }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={isSending || !input.trim()}
            className="shrink-0 w-10 h-10 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-all active:scale-95"
          >
            {isSending ? (
              <CircleNotch className="w-4 h-4 animate-spin" />
            ) : (
              <PaperPlaneTilt className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
