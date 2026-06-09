"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { X, PaperPlaneTilt, CircleNotch, UserCircle, Globe, VideoCamera, Plus } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useSetAtom } from "jotai";
import ReactMarkdown from "react-markdown";
import { streamWikiAsk, streamVideoAsk, getVideo, addVideoToWiki } from "@/lib/api";
import { cn } from "@/lib/utils";
import { mascotOpenAtom, mascotTriggerAtom, mascotAnimStateAtom } from "@/atoms/mascot";
import { addToQueueAtom } from "@/atoms/queue";
import { TransparentVideo, type TransparentVideoHandle } from "./transparent-video";
import { KBSelectDialog } from "@/components/knowledge/kb-select-dialog";

interface Message {
  role: "user" | "assistant";
  content: string;
}

type ChatMode = "video" | "wiki";

const WIKI_EXAMPLES = [
  "我留下过哪些关于 AI Agent 的线索？",
  "整理一下我知识库里的核心概念",
  "不同来源有哪些矛盾的观点？",
];

const VIDEO_EXAMPLES = [
  "这条内容的核心论点是什么？",
  "视频里提到了哪些关键概念？",
  "用三句话整理这条内容",
];

function safePlay(video: HTMLVideoElement | null) {
  if (!video) return;
  const p = video.play();
  if (p) p.catch(() => {});
}

export function FloatingMascot() {
  const pathname = usePathname();
  const [open, setOpen] = useAtom(mascotOpenAtom);
  const [triggered, setTriggered] = useAtom(mascotTriggerAtom);
  const [sharedAnim] = useAtom(mascotAnimStateAtom);
  const addToQueue = useSetAtom(addToQueueAtom);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [mode, setMode] = useState<ChatMode>("wiki");
  const [bouncing, setBouncing] = useState(true);
  const [inWiki, setInWiki] = useState(false);
  const [wikiCompiling, setWikiCompiling] = useState(false);
  const [showKBDialog, setShowKBDialog] = useState(false);
  const [animState, setAnimState] = useState<"idle" | "flying" | "open">("idle");
  const [mounted, setMounted] = useState(false);
  const wikiPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Video mascot animation refs and state
  const hoverVideoRef = useRef<TransparentVideoHandle>(null);
  const thinkingVideoRef = useRef<TransparentVideoHandle>(null);
  const answerVideoRef = useRef<TransparentVideoHandle>(null);
  const [mascotAnim, setMascotAnim] = useState<"idle" | "hover" | "thinking" | "answer">("idle");
  const prevStreamingRef = useRef(false);

  const videoIdMatch = pathname?.match(/^\/videos\/([^/]+)/);
  const currentVideoId = videoIdMatch?.[1] ?? null;
  const isVideoPage = !!currentVideoId;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (isVideoPage) setMode("video");
    else setMode("wiki");
    setMessages([]);
  }, [pathname, isVideoPage]);

  const { data: videoData } = useQuery({
    queryKey: ["video", currentVideoId],
    queryFn: () => getVideo(currentVideoId!),
    enabled: !!currentVideoId,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (videoData) setInWiki(videoData.in_wiki);
  }, [videoData]);

  useEffect(() => {
    const t = setTimeout(() => setBouncing(false), 3000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (prevStreamingRef.current && !streaming) {
      setMascotAnim("answer");
      hoverVideoRef.current?.pause();
      thinkingVideoRef.current?.pause();
      answerVideoRef.current?.reset();
      answerVideoRef.current?.play();
      const timeout = setTimeout(() => setMascotAnim("idle"), 3000);
      prevStreamingRef.current = streaming;
      return () => clearTimeout(timeout);
    }
    if (streaming) {
      setMascotAnim("thinking");
      hoverVideoRef.current?.pause();
      thinkingVideoRef.current?.reset();
      thinkingVideoRef.current?.play();
    }
    prevStreamingRef.current = streaming;
  }, [streaming]);

  // Respond to shared animation state from external Q&A panels (when mascot panel is closed)
  useEffect(() => {
    if (!open && sharedAnim !== "idle") {
      setMascotAnim(sharedAnim);
      if (sharedAnim === "thinking") {
        hoverVideoRef.current?.pause();
        thinkingVideoRef.current?.reset();
        thinkingVideoRef.current?.play();
      } else if (sharedAnim === "answer") {
        thinkingVideoRef.current?.pause();
        answerVideoRef.current?.reset();
        answerVideoRef.current?.play();
      }
    } else if (!open && sharedAnim === "idle") {
      setMascotAnim("idle");
      hoverVideoRef.current?.pause();
      thinkingVideoRef.current?.pause();
      answerVideoRef.current?.pause();
    }
  }, [sharedAnim, open]);

  useEffect(() => {
    return () => {
      if (wikiPollRef.current) clearInterval(wikiPollRef.current);
    };
  }, []);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, [pathname]);

  useEffect(() => {
    if (triggered && !open) {
      setTriggered(false);
      handleOpen();
    }
  }, [triggered]);

  const handleOpen = () => {
    if (open) return;
    setAnimState("flying");
    setTimeout(() => {
      setOpen(true);
      setAnimState("open");
    }, 500);
  };

  const handleToggle = () => {
    if (open) {
      setOpen(false);
      setAnimState("idle");
    } else {
      handleOpen();
    }
  };

  const handleAddToWiki = async (kbId?: string) => {
    if (!currentVideoId || wikiCompiling) return;
    setShowKBDialog(false);
    try {
      setWikiCompiling(true);
      await addVideoToWiki(currentVideoId, kbId);
      addToQueue({
        id: currentVideoId,
        type: "wiki",
        title: videoData?.title || "知识库收录",
        state: "processing",
        progress: 0,
        message: "正在收进知识库…",
      });
      wikiPollRef.current = setInterval(async () => {
        try {
          const v = await getVideo(currentVideoId);
          if (v.in_wiki) {
            setInWiki(true);
            setWikiCompiling(false);
            if (wikiPollRef.current) clearInterval(wikiPollRef.current);
          }
        } catch {}
      }, 3000);
    } catch {
      setWikiCompiling(false);
    }
  };

  const sendMessage = useCallback(
    async (question: string) => {
      if (!question.trim() || streaming) return;
      const q = question.trim();
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: q }]);
      setStreaming(true);

      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      try {
        let streamBody: ReadableStream<Uint8Array>;
        if (mode === "video" && currentVideoId) {
          streamBody = await streamVideoAsk(currentVideoId, q, { signal });
        } else {
          streamBody = await streamWikiAsk(q, undefined, undefined, { signal });
        }

        const reader = streamBody.getReader();
        const decoder = new TextDecoder();
        let assistantMsg = "";
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const raw = line.slice(6);
              if (raw === "[DONE]") break;
              let token = raw;
              try {
                const parsed = JSON.parse(raw);
                token = parsed.delta ?? "";
              } catch { /* raw text, use as-is */ }
              assistantMsg += token;
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "assistant", content: assistantMsg };
                return copy;
              });
            }
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "提问失败，请稍后重试。" },
        ]);
      } finally {
        setStreaming(false);
      }
    },
    [mode, currentVideoId, streaming]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const switchMode = (newMode: ChatMode) => {
    setMode(newMode);
    setMessages([]);
  };

  const examples = mode === "video" ? VIDEO_EXAMPLES : WIKI_EXAMPLES;
  const isFlying = animState === "flying";

  if (!mounted) return null;

  const content = (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&display=swap');
        .mascot-font { font-family: 'Noto Sans SC', sans-serif; }
        @keyframes mascotBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes msgFadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .msg-appear { animation: msgFadeUp 0.25s ease forwards; }
        .example-card:hover { border-color: #10b981 !important; box-shadow: 0 0 0 1px #10b981, 0 0 12px rgba(16,185,129,0.12) !important; }
        .send-btn:hover:not(:disabled) { transform: scale(1.08); }
        .send-btn { transition: transform 0.15s ease, background 0.15s ease; }
      `}</style>

      {/* Chat panel */}
      <div
        className="mascot-font"
        style={{
          position: "fixed",
          right: 32,
          top: 310,
          width: 420,
          height: 560,
          zIndex: 9999,
          borderRadius: 20,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          border: "1px solid rgba(0,0,0,0.08)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)",
          transformOrigin: "top right",
          transition: "opacity 0.4s cubic-bezier(0.34,1.56,0.64,1), transform 0.4s cubic-bezier(0.34,1.56,0.64,1)",
          opacity: open ? 1 : 0,
          transform: open ? "scale(1)" : "scale(0.82)",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 14px",
          background: "#f9fafb",
          borderBottom: "1px solid rgba(0,0,0,0.06)",
          flexShrink: 0,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%", overflow: "hidden",
            background: "#e5e7eb", flexShrink: 0,
            border: "1.5px solid rgba(16,185,129,0.4)",
          }}>
            <img src="/mascot-character.png" alt="品猹助手" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ color: "#111827", fontWeight: 700, fontSize: 13, lineHeight: 1.3, margin: 0 }}>品猹助手</p>
            <p style={{ color: "#9ca3af", fontSize: 10, margin: 0, marginTop: 1 }}>
              {mode === "video" && currentVideoId ? "优先围绕当前内容回答" : "基于你的知识库回答"}
            </p>
          </div>

          {isVideoPage && (
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
              {!inWiki && !wikiCompiling && (
                <button
                  onClick={() => setShowKBDialog(true)}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "4px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                    background: "#10b981", color: "#fff", border: "none", cursor: "pointer",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#059669")}
                  onMouseLeave={e => (e.currentTarget.style.background = "#10b981")}
                >
                  <Plus size={9} weight="bold" />收进知识库
                </button>
              )}
              {wikiCompiling && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#9ca3af" }}>
                  <CircleNotch size={9} weight="bold" className="animate-spin" />编译中…
                </span>
              )}
              {inWiki && !wikiCompiling && (
                <div style={{ display: "flex", background: "#f3f4f6", borderRadius: 8, padding: 2, gap: 2 }}>
                  {(["video", "wiki"] as ChatMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => switchMode(m)}
                      style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                        background: mode === m ? "#10b981" : "transparent",
                        color: mode === m ? "#fff" : "#9ca3af",
                        border: "none", cursor: "pointer", transition: "all 0.15s",
                      }}
                    >
                      {m === "video" ? <VideoCamera size={9} weight="bold" /> : <Globe size={9} weight="bold" />}
                      {m === "video" ? "当前内容" : "知识库"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => { setOpen(false); setAnimState("idle"); }}
            style={{
              width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center",
              justifyContent: "center", background: "transparent", border: "none",
              color: "#9ca3af", cursor: "pointer", transition: "all 0.15s", flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "#f3f4f6"; e.currentTarget.style.color = "#374151"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#9ca3af"; }}
          >
            <X size={14} weight="bold" />
          </button>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: "auto", padding: "14px 14px 8px",
          background: "#fafafa", display: "flex", flexDirection: "column", gap: 10,
        }}>
          {messages.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
              <p style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500, margin: 0 }}>试试这些问题：</p>
              {examples.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="example-card"
                  style={{
                    width: "100%", textAlign: "left", fontSize: 12, padding: "10px 12px",
                    borderRadius: 10, background: "#ffffff", border: "1px solid #e5e7eb",
                    color: "#4b5563", cursor: "pointer", transition: "all 0.2s", lineHeight: 1.5,
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className="msg-appear"
              style={{
                display: "flex", gap: 8, alignItems: "flex-end",
                flexDirection: msg.role === "user" ? "row-reverse" : "row",
              }}
            >
              {msg.role === "assistant" ? (
                <div style={{
                  width: 26, height: 26, borderRadius: "50%", overflow: "hidden",
                  background: "#e5e7eb", flexShrink: 0, border: "1px solid rgba(16,185,129,0.3)",
                }}>
                  <img src="/mascot-character.png" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              ) : (
                <div style={{
                  width: 26, height: 26, borderRadius: "50%", background: "rgba(16,185,129,0.1)",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  border: "1px solid rgba(16,185,129,0.25)",
                }}>
                  <UserCircle size={12} weight="bold" style={{ color: "#10b981" }} />
                </div>
              )}
              <div style={{
                fontSize: 12, lineHeight: 1.65, padding: "9px 12px", borderRadius: 14,
                maxWidth: 300,
                ...(msg.role === "user"
                  ? { background: "#10b981", color: "#fff", borderBottomRightRadius: 4, whiteSpace: "pre-wrap" }
                  : { background: "#ffffff", color: "#374151", border: "1px solid #e5e7eb", borderBottomLeftRadius: 4, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }),
              }}>
                {msg.role === "user" ? (
                  msg.content
                ) : msg.content ? (
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => <p style={{ margin: "0 0 6px", lineHeight: 1.65 }}>{children}</p>,
                      strong: ({ children }) => <strong style={{ fontWeight: 700, color: "#111827" }}>{children}</strong>,
                      ul: ({ children }) => <ul style={{ margin: "4px 0", paddingLeft: 16 }}>{children}</ul>,
                      ol: ({ children }) => <ol style={{ margin: "4px 0", paddingLeft: 16 }}>{children}</ol>,
                      li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
                      code: ({ children }) => <code style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 3, fontSize: 11, fontFamily: "monospace" }}>{children}</code>,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                ) : (
                  streaming && (
                    <span className="inline-flex items-center gap-[3px] py-1">
                      <span className="w-[5px] h-[5px] rounded-full bg-zinc-400 animate-[bounce_1.2s_ease-in-out_infinite]" />
                      <span className="w-[5px] h-[5px] rounded-full bg-zinc-400 animate-[bounce_1.2s_ease-in-out_0.15s_infinite]" />
                      <span className="w-[5px] h-[5px] rounded-full bg-zinc-400 animate-[bounce_1.2s_ease-in-out_0.3s_infinite]" />
                    </span>
                  )
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{
          padding: "10px 12px 12px", background: "#ffffff",
          borderTop: "1px solid #f3f4f6", flexShrink: 0,
        }}>
          <div style={{
            display: "flex", alignItems: "flex-end", gap: 8,
            background: "#f9fafb", borderRadius: 12,
            border: "1px solid #e5e7eb",
            padding: "8px 10px",
            transition: "border-color 0.2s",
          }}
            onFocusCapture={e => (e.currentTarget.style.borderColor = "rgba(16,185,129,0.5)")}
            onBlurCapture={e => (e.currentTarget.style.borderColor = "#e5e7eb")}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={mode === "video" ? "追问这条内容…" : "追问你的知识库…"}
              rows={1}
              disabled={streaming}
              style={{
                flex: 1, background: "transparent", fontSize: 12, color: "#111827",
                border: "none", outline: "none", resize: "none", lineHeight: "20px",
                minHeight: 20, maxHeight: 80, fontFamily: "inherit",
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || streaming}
              className="send-btn"
              style={{
                width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center",
                justifyContent: "center", background: "#10b981", color: "#fff", border: "none",
                cursor: !input.trim() || streaming ? "not-allowed" : "pointer",
                opacity: !input.trim() || streaming ? 0.35 : 1, flexShrink: 0,
              }}
            >
              {streaming ? <CircleNotch size={12} weight="bold" className="animate-spin" /> : <PaperPlaneTilt size={12} weight="bold" />}
            </button>
          </div>
          <p style={{ fontSize: 10, color: "#d1d5db", textAlign: "center", margin: "6px 0 0" }}>
            Enter 发送 · Shift+Enter 换行
          </p>
        </div>
      </div>

      {/* Trigger button — always visible, even when chat is open */}
      <button
        onClick={handleToggle}
        onMouseEnter={() => {
          if (!streaming && mascotAnim !== "answer") {
            setMascotAnim("hover");
            hoverVideoRef.current?.reset();
            hoverVideoRef.current?.play();
          }
        }}
        onMouseLeave={() => {
          if (mascotAnim === "hover") {
            setMascotAnim("idle");
            hoverVideoRef.current?.pause();
          }
        }}
        style={{
          position: "fixed", top: 80, right: 32, zIndex: 10000,
          width: 220, height: 220,
          border: "none", cursor: "pointer", padding: 0,
          background: "transparent",
          transform: isFlying ? "scale(0.75) translateY(-80vh)" : "none",
          transition: "transform 0.5s cubic-bezier(0.34,1.56,0.64,1)",
          animation: bouncing && !open ? "mascotBounce 1s ease-in-out 3" : undefined,
        }}
        title="向品猹助手提问"
      >
        {/* Static fallback (shown in idle state) */}
        <img
          src="/mascot-character.png"
          alt="品猹助手"
          style={{
            width: "100%", height: "100%", objectFit: "contain",
            position: "absolute", inset: 0,
            opacity: mascotAnim === "idle" ? 1 : 0,
            transition: "opacity 0.3s",
          }}
        />

        {/* Hover animation */}
        <div style={{
          position: "absolute", inset: 0,
          opacity: mascotAnim === "hover" ? 1 : 0,
          transition: "opacity 0.3s",
        }}>
          <TransparentVideo
            ref={hoverVideoRef}
            src="/mascot/mascot-hover.webm"
            loop
            threshold={12}
          />
        </div>

        {/* Thinking animation */}
        <div style={{
          position: "absolute", inset: 0,
          opacity: mascotAnim === "thinking" ? 1 : 0,
          transition: "opacity 0.3s",
        }}>
          <TransparentVideo
            ref={thinkingVideoRef}
            src="/mascot/mascot-thinking.webm"
            loop
            threshold={12}
          />
        </div>

        {/* Answer animation */}
        <div style={{
          position: "absolute", inset: 0,
          opacity: mascotAnim === "answer" ? 1 : 0,
          transition: "opacity 0.3s",
        }}>
          <TransparentVideo
            ref={answerVideoRef}
            src="/mascot/mascot-answer.webm"
            onEnded={() => setMascotAnim("idle")}
            threshold={12}
          />
        </div>

        {/* Ping animation */}
        {!open && !isFlying && (
          <span style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            border: "2px solid #10b981", animation: "ping 2.5s cubic-bezier(0,0,0.2,1) infinite",
            opacity: 0.4,
          }} className="animate-ping" />
        )}
      </button>

      {/* KB Selection Dialog */}
      <KBSelectDialog
        open={showKBDialog}
        onOpenChange={setShowKBDialog}
        onConfirm={(kbId) => handleAddToWiki(kbId)}
        loading={wikiCompiling}
      />
    </>
  );

  return createPortal(content, document.body);
}
