"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cdnUrl } from "@/lib/cdn";
import {
  outputs,
  paths,
  processLabels,
  sources,
  type PulsePath,
  type PulseNode,
} from "./knowledge-pulse-flow-data";
import styles from "./knowledge-pulse-flow.module.css";

type HoverTarget =
  | { type: "source"; id: string }
  | { type: "output"; id: string }
  | null;

function pathMatchesHover(path: PulsePath, hover: HoverTarget) {
  if (!hover) return false;
  return hover.type === "source" ? path.sourceId === hover.id : path.targetId === hover.id;
}

function nodeMatchesHover(node: PulseNode, hover: HoverTarget, type: "source" | "output") {
  return hover?.type === type && hover.id === node.id;
}

function pulseWidth(label: string) {
  return Math.max(58, label.length * 12 + 24);
}

function getHoverPulseLabel(hover: HoverTarget) {
  if (!hover) return null;
  const collection = hover.type === "source" ? sources : outputs;
  return collection.find((item) => item.id === hover.id)?.pulseLabel ?? null;
}

function getHoverStatus(hover: HoverTarget, index: number) {
  if (hover?.type === "source") {
    return sources.find((item) => item.id === hover.id)?.status ?? processLabels[index];
  }
  if (hover?.type === "output") {
    const label = getHoverPulseLabel(hover);
    if (label === "对齐字幕") return "字幕提取中";
    if (label === "建立关系") return "内容结构化中";
    if (label === "写入知识库") return "章节归并中";
  }
  return processLabels[index];
}

function LogoBadge({ kind }: { kind: string }) {
  switch (kind) {
    case "youtube":
      return (
        <span className={`${styles.logoBadge} ${styles.youtubeLogo}`} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M21.4 7.1a2.7 2.7 0 0 0-1.9-1.9C17.8 4.8 12 4.8 12 4.8s-5.8 0-7.5.4a2.7 2.7 0 0 0-1.9 1.9A28 28 0 0 0 2.2 12c0 1.7.1 3.4.4 4.9a2.7 2.7 0 0 0 1.9 1.9c1.7.4 7.5.4 7.5.4s5.8 0 7.5-.4a2.7 2.7 0 0 0 1.9-1.9c.3-1.5.4-3.2.4-4.9s-.1-3.4-.4-4.9Z" />
            <path d="m10.1 14.9 5-2.9-5-2.9v5.8Z" className={styles.logoCutout} />
          </svg>
        </span>
      );
    case "podcast":
      return (
        <span className={`${styles.logoBadge} ${styles.podcastLogo}`} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 4.3a5.6 5.6 0 0 0-3.2 10.2 1 1 0 0 0 1.2-1.6 3.6 3.6 0 1 1 4 0 1 1 0 0 0 1.2 1.6A5.6 5.6 0 0 0 12 4.3Z" />
            <path d="M12 7.8a2.1 2.1 0 0 0-1.1 3.9l-.8 6.3a1.9 1.9 0 0 0 3.8 0l-.8-6.3A2.1 2.1 0 0 0 12 7.8Z" />
            <path d="M7 16.8a8.1 8.1 0 1 1 10 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
          </svg>
        </span>
      );
    case "x":
      return (
        <span className={`${styles.logoBadge} ${styles.xLogo}`} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 4h3.9l4 5.5L17.6 4H20l-6 7 6.5 9h-3.9l-4.3-5.9L7.2 20H4.8l6.4-7.4L5 4Zm2.6 1.7 9.9 12.6h1.4L9 5.7H7.6Z" />
          </svg>
        </span>
      );
    case "article":
    case "summary":
    case "levels":
      return (
        <span className={`${styles.logoBadge} ${styles.documentLogo}`} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M7 3.5h7.1L18 7.4v13.1H7V3.5Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
            <path d="M14 3.7v4h4" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
            <path d="M9.4 11.3h5.2M9.4 14.3h5.2M9.4 17.3h3.4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
          </svg>
        </span>
      );
    case "comment":
    case "qa":
      return (
        <span className={`${styles.logoBadge} ${styles.commentLogo}`} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 6.4c0-1 1-1.9 2.2-1.9h9.6c1.2 0 2.2.9 2.2 1.9v6.8c0 1-1 1.9-2.2 1.9h-4.7l-4 3.1v-3.1h-.9C6 15.1 5 14.2 5 13.2V6.4Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
          </svg>
        </span>
      );
    case "timeline":
      return (
        <span className={`${styles.logoBadge} ${styles.timelineLogo}`} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
            <path d="M8 7h4M10 12h5M7 17h7" stroke="currentColor" strokeLinecap="round" strokeWidth="3.2" />
          </svg>
        </span>
      );
    case "mindmap":
      return (
        <span className={`${styles.logoBadge} ${styles.mindmapLogo}`} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 12 7 7m5 5 5-5m-5 5-5 5m5-5 5 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
            <circle cx="12" cy="12" r="2.5" />
            <circle cx="7" cy="7" r="2" />
            <circle cx="17" cy="7" r="2" />
            <circle cx="7" cy="17" r="2" />
            <circle cx="17" cy="17" r="2" />
          </svg>
        </span>
      );
    case "library":
      return (
        <span className={`${styles.logoBadge} ${styles.libraryLogo}`} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M6 6.5 12 3l6 3.5-6 3.5-6-3.5Zm0 5 6 3.5 6-3.5M6 16.5l6 3.5 6-3.5" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
          </svg>
        </span>
      );
    default:
      return (
        <span className={`${styles.logoBadge} ${styles.documentLogo}`} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="6" />
          </svg>
        </span>
      );
  }
}

function usePulseRuntime(containerRef: React.RefObject<HTMLDivElement | null>, svgRef: React.RefObject<SVGSVGElement | null>) {
  const [isVisible, setIsVisible] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(true);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { rootMargin: "240px 0px", threshold: 0 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [containerRef]);

  useEffect(() => {
    const update = () => setIsPageVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (isVisible && isPageVisible) {
      svg.unpauseAnimations();
    } else {
      svg.pauseAnimations();
    }
  }, [isVisible, isPageVisible, svgRef]);

  return isVisible && isPageVisible;
}

function PulsePathLayer({ path, isActive, isDimmed }: { path: PulsePath; isActive: boolean; isDimmed: boolean }) {
  const duration = `${path.duration}s`;
  const delay = `${path.delay}s`;
  const groupClassName = [
    styles.pathGroup,
    isActive ? styles.pathGroupActive : "",
    isDimmed ? styles.pathGroupDim : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <g className={groupClassName}>
      <path id={`${path.id}-desktop`} d={path.d} className={`${styles.pathBase} ${styles.desktopPath}`} />
      <path id={`${path.id}-mobile`} d={path.mobileD} className={`${styles.pathBase} ${styles.mobilePath}`} />
      <path
        d={path.d}
        className={`${styles.pathPulse} ${styles.desktopPath}`}
        style={{ "--duration": duration, "--delay": delay } as React.CSSProperties}
      />
      <path
        d={path.mobileD}
        className={`${styles.pathPulse} ${styles.mobilePath}`}
        style={{ "--duration": duration, "--delay": delay } as React.CSSProperties}
      />
    </g>
  );
}

function PulseLabel({ path, label, force = false }: { path: PulsePath; label: string; force?: boolean }) {
  const width = pulseWidth(label);
  const duration = `${force ? 3.8 : path.duration}s`;
  const begin = `${force ? 0 : path.delay + 0.35}s`;

  return (
    <g className={styles.labelPulse}>
      <rect x={-width / 2} y="-12" width={width} height="24" rx="12" />
      <text textAnchor="middle" dominantBaseline="middle">
        {label}
      </text>
      <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;0.08;0.20;0.78;0.92;1" dur={duration} begin={begin} repeatCount="indefinite" />
      <animateMotion dur={duration} begin={begin} repeatCount="indefinite" rotate="0">
        <mpath href={`#${path.id}-desktop`} />
      </animateMotion>
    </g>
  );
}

function MobilePulseLabel({ path, label }: { path: PulsePath; label: string }) {
  const width = pulseWidth(label);

  return (
    <g className={styles.labelPulse}>
      <rect x={-width / 2} y="-12" width={width} height="24" rx="12" />
      <text textAnchor="middle" dominantBaseline="middle">
        {label}
      </text>
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.2;0.78;1" dur="4.8s" begin={`${path.delay}s`} repeatCount="indefinite" />
      <animateMotion dur="4.8s" begin={`${path.delay}s`} repeatCount="indefinite" rotate="0">
        <mpath href={`#${path.id}-mobile`} />
      </animateMotion>
    </g>
  );
}

export function KnowledgePulseFlow() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<HoverTarget>(null);
  const [statusIndex, setStatusIndex] = useState(0);
  const [hasEntered, setHasEntered] = useState(false);
  const isRunning = usePulseRuntime(containerRef, svgRef);

  useEffect(() => {
    if (isRunning) setHasEntered(true);
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning || hover) return;
    const timeout = window.setTimeout(() => {
      setStatusIndex((current) => (current + 1) % processLabels.length);
    }, 1900);
    return () => window.clearTimeout(timeout);
  }, [hover, isRunning, statusIndex]);

  const activePath = useMemo(() => paths.find((path) => pathMatchesHover(path, hover)) ?? null, [hover]);
  const hoverPulseLabel = getHoverPulseLabel(hover);
  const currentStatus = getHoverStatus(hover, statusIndex);
  const hasHover = hover !== null;

  return (
    <div
      ref={containerRef}
      className={[
        styles.flow,
        hasEntered ? styles.enter : "",
        hasEntered ? styles.drawn : "",
        isRunning ? "" : styles.paused,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
    >
      <div className={styles.grid} />
      <svg ref={svgRef} className={styles.svg} viewBox="0 0 1000 470" preserveAspectRatio="none">
        <defs>
          <filter id="pulse-soft-shadow" x="-20%" y="-40%" width="140%" height="180%">
            <feDropShadow dx="0" dy="8" stdDeviation="10" floodColor="rgba(79,105,245,0.14)" />
          </filter>
        </defs>

        {paths.map((path) => {
          const isActive = pathMatchesHover(path, hover);
          return <PulsePathLayer key={path.id} path={path} isActive={isActive} isDimmed={hasHover && !isActive} />;
        })}

        {!hover &&
          paths
            .filter((path) => path.direction !== "process")
            .slice(0, 8)
            .map((path, index) => <PulseLabel key={`${path.id}-${index}`} path={path} label={path.pulseLabels[index % path.pulseLabels.length]} />)}

        {!hover &&
          paths
            .filter((path) => path.direction === "process")
            .map((path, index) => <PulseLabel key={`${path.id}-process-${index}`} path={path} label={path.pulseLabels[index % path.pulseLabels.length]} />)}

        {activePath && hoverPulseLabel && <PulseLabel path={activePath} label={hoverPulseLabel} force />}

        {!hover &&
          paths
            .filter((path) => path.id === "in-youtube" || path.id === "process-loop-a" || path.id === "out-library")
            .map((path, index) => <MobilePulseLabel key={`${path.id}-mobile-${index}`} path={path} label={["字幕提取", "语义拆解", "知识入库"][index]} />)}
      </svg>

      <div className={styles.content}>
        <div className={`${styles.sideTitle} ${styles.leftTitle}`}>Input from</div>
        <div className={styles.sources}>
          {sources.map((source) => {
            const active = nodeMatchesHover(source, hover, "source");
            return (
              <motion.button
                key={source.id}
                type="button"
                tabIndex={-1}
                className={[styles.source, active ? styles.activeNode : "", hasHover && !active ? styles.dimNode : ""]
                  .filter(Boolean)
                  .join(" ")}
                onMouseEnter={() => setHover({ type: "source", id: source.id })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ type: "source", id: source.id })}
                onBlur={() => setHover(null)}
                whileTap={{ scale: 0.99 }}
              >
                <LogoBadge kind={source.logo} />
                <span>
                  <span className={styles.title}>{source.title}</span>
                  <span className={styles.subtitle}>{source.subtitle}</span>
                </span>
              </motion.button>
            );
          })}
        </div>

        <div className={styles.engineWrap}>
          <div className={styles.engine}>
            <span className={styles.coreHalo} />
            <span className={styles.ringPulse} />
            <img src={cdnUrl("/brand/pincha-wordmark.svg")} alt="" className={styles.engineLogo} />
            <div className={styles.engineTitle}>内容解析引擎</div>
            <div className={styles.engineSub}>理解内容，提炼结构，沉淀为可复用知识。</div>
            <div className={styles.engineStatus}>{currentStatus}</div>
          </div>
        </div>

        <div className={`${styles.sideTitle} ${styles.rightTitle}`}>Output to</div>
        <div className={styles.outputs}>
          {outputs.map((output) => {
            const active = nodeMatchesHover(output, hover, "output");
            return (
              <motion.button
                key={output.id}
                type="button"
                tabIndex={-1}
                className={[styles.output, active ? styles.activeNode : "", hasHover && !active ? styles.dimNode : ""]
                  .filter(Boolean)
                  .join(" ")}
                onMouseEnter={() => setHover({ type: "output", id: output.id })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ type: "output", id: output.id })}
                onBlur={() => setHover(null)}
                whileTap={{ scale: 0.99 }}
              >
                <LogoBadge kind={output.logo} />
                <span>
                  <span className={styles.title}>{output.title}</span>
                  <span className={styles.subtitle}>{output.subtitle}</span>
                </span>
              </motion.button>
            );
          })}
        </div>

        <div className={styles.mobileHint}>
          <span>字幕提取</span>
          <span>语义拆解</span>
          <span>知识入库</span>
        </div>
      </div>
    </div>
  );
}
