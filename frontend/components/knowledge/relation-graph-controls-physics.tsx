"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { PhysicsPreferences } from "./relation-graph-utils";

interface PhysicsControlsProps {
  preferences: PhysicsPreferences;
  onChange: (prefs: PhysicsPreferences) => void;
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  onRelayout: () => void;
  onResetParams: () => void;
}

function SliderRow({
  label,
  value,
  onChange,
  left,
  right,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  left: string;
  right: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-zinc-600">{label}</span>
        <span className="text-[11px] text-zinc-400 tabular-nums">{value}</span>
      </div>
      <div className="relative flex items-center gap-2">
        <span className="text-[10px] text-zinc-500 shrink-0">{left}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`${label}：${left}到${right}`}
          className="flex-1 h-1.5 appearance-none bg-zinc-200 rounded-full outline-none
            accent-zinc-700 cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-3.5
            [&::-webkit-slider-thumb]:h-3.5
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-zinc-700
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:shadow-sm
            [&::-moz-range-thumb]:w-3.5
            [&::-moz-range-thumb]:h-3.5
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-zinc-700
            [&::-moz-range-thumb]:border-none
            [&::-moz-range-thumb]:cursor-pointer"
        />
        <span className="text-[10px] text-zinc-500 shrink-0">{right}</span>
      </div>
    </div>
  );
}

export function PhysicsControls({
  preferences,
  onChange,
  isPaused,
  onPause,
  onResume,
  onRelayout,
  onResetParams,
}: PhysicsControlsProps) {
  const [expanded, setExpanded] = useState(false);
  const [relayouting, setRelayouting] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const skipOutsideClickRef = useRef(false); // skip next outside click

  // Close on outside click
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (skipOutsideClickRef.current) {
        skipOutsideClickRef.current = false;
        return;
      }
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setExpanded(false);
        setPanelPos(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded]);

  const handleToggle = useCallback(() => {
    if (expanded) {
      setExpanded(false);
      setPanelPos(null);
    } else {
      // Position panel relative to button using getBoundingClientRect
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const panelHeight = 340; // approximate panel height
        const panelWidth = 240;
        const viewportWidth = window.innerWidth;
        // Prefer: panel opens to the left and above the button, clamped to viewport
        let top = rect.top - panelHeight - 8;
        let left = rect.right - panelWidth;
        // Clamp to viewport
        if (top < 8) top = 8;
        if (left < 8) left = 8;
        if (left + panelWidth > viewportWidth - 8) left = viewportWidth - panelWidth - 8;
        setPanelPos({ top, left });
      }
      // Set flag so document handler won't immediately close the panel
      skipOutsideClickRef.current = true;
      setExpanded(true);
    }
  }, [expanded]);

  const handleRelayout = useCallback(() => {
    setRelayouting(true);
    onRelayout();
    setTimeout(() => setRelayouting(false), 2000);
  }, [onRelayout]);

  return (
    <>
      {/* Toggle button */}
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className="flex items-center gap-1.5 text-[11px] px-2.5 py-0.5 rounded-full border border-zinc-300 text-zinc-500 hover:text-zinc-700 hover:border-zinc-400 transition-all"
        aria-expanded={expanded}
        aria-label="图谱设置"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="1.5" fill="currentColor" />
          <circle cx="1.5" cy="6" r="1.5" fill="currentColor" />
          <circle cx="10.5" cy="6" r="1.5" fill="currentColor" />
        </svg>
        {isPaused ? "已暂停" : "图谱设置"}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
          className={`transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Panel — fixed positioning,不受任何父级 overflow 裁切 */}
      {expanded && panelPos && (
        <div
          className="fixed bg-white rounded-xl border border-zinc-200 shadow-lg p-3.5 space-y-3.5 z-[100]"
          style={{
            top: panelPos.top,
            left: panelPos.left,
            width: 240,
            maxHeight: 320,
            overflowY: "auto",
          }}
          role="dialog"
          aria-label="图谱物理参数设置"
        >
          <p className="text-[10px] text-zinc-400 leading-relaxed">
            图谱仅在拖动、调参或重新布局时运动，稳定后会自动停止。
          </p>

          <div className="h-px bg-zinc-100" />

          <SliderRow
            label="布局密度"
            value={preferences.density}
            onChange={(v) => onChange({ ...preferences, density: v })}
            left="紧凑"
            right="舒展"
          />
          <SliderRow
            label="节点排斥"
            value={preferences.repulsion}
            onChange={(v) => onChange({ ...preferences, repulsion: v })}
            left="弱"
            right="强"
          />
          <SliderRow
            label="关系牵引"
            value={preferences.tension}
            onChange={(v) => onChange({ ...preferences, tension: v })}
            left="松"
            right="紧"
          />

          <div className="h-px bg-zinc-100" />

          <div className="flex items-center gap-2">
            <button
              onClick={isPaused ? onResume : onPause}
              className={`flex-1 text-[11px] py-1.5 rounded-lg border transition-all ${
                isPaused
                  ? "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                  : "border-zinc-700 text-zinc-800 font-medium hover:bg-zinc-50"
              }`}
            >
              {isPaused ? "继续运动" : "暂停运动"}
            </button>
            <button
              onClick={handleRelayout}
              disabled={relayouting}
              className="flex-1 text-[11px] py-1.5 rounded-lg border border-zinc-300 text-zinc-600 hover:bg-zinc-50 transition-all disabled:opacity-50"
            >
              {relayouting ? "重新布局中…" : "重新布局"}
            </button>
          </div>

          <button
            onClick={onResetParams}
            className="w-full text-[11px] py-1.5 rounded-lg border border-zinc-100 text-zinc-400 hover:text-zinc-500 hover:border-zinc-300 transition-all"
          >
            恢复默认参数
          </button>
        </div>
      )}
    </>
  );
}
