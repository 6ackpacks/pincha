"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleNotch, ArrowClockwise, Warning, Heartbeat, Database, Queue,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { STATE_LABELS } from "@/lib/constants";
import {
  fetchMonitorOverview, fetchMonitorWorkers, fetchMonitorSystem,
  retryVideo,
  type MonitorOverview, type WorkerInfo, type SystemInfo,
} from "@/lib/admin-api";

export default function DashboardPage() {
  const qc = useQueryClient();

  const overviewQ = useQuery<MonitorOverview>({
    queryKey: ["admin", "monitor", "overview"],
    queryFn: fetchMonitorOverview,
    refetchInterval: 30000,
  });

  const workersQ = useQuery<WorkerInfo[]>({
    queryKey: ["admin", "monitor", "workers"],
    queryFn: fetchMonitorWorkers,
    refetchInterval: 30000,
  });

  const systemQ = useQuery<SystemInfo>({
    queryKey: ["admin", "monitor", "system"],
    queryFn: fetchMonitorSystem,
    refetchInterval: 30000,
  });

  const retryMut = useMutation({
    mutationFn: retryVideo,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "monitor", "overview"] }),
  });

  const isLoading = overviewQ.isLoading || workersQ.isLoading || systemQ.isLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <CircleNotch size={24} weight="bold" className="animate-spin text-zinc-500" />
      </div>
    );
  }

  const overview = overviewQ.data;
  const workers = workersQ.data ?? [];
  const system = systemQ.data;

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-zinc-100">系统监控</h1>
        <span className="text-xs text-zinc-500">每 30 秒自动刷新</span>
      </div>

      {/* Video status distribution */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
          <Database size={14} weight="bold" />
          视频状态分布
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {Object.entries(overview?.video_counts ?? {}).map(([state, count]) => (
            <div
              key={state}
              className={cn(
                "rounded-lg border border-zinc-800 bg-zinc-900 p-4",
                state === "failed" && "border-red-900/50",
              )}
            >
              <p className="text-xs text-zinc-500">{STATE_LABELS[state] || state}</p>
              <p className={cn(
                "text-2xl font-bold mt-1",
                state === "failed" ? "text-red-400" : "text-zinc-100",
              )}>
                {count}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* System metrics */}
      {system && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Queue size={14} weight="bold" />
            系统指标
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <p className="text-xs text-zinc-500">Redis 内存</p>
              <p className="text-lg font-bold text-zinc-100 mt-1">{system.redis_memory_used}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <p className="text-xs text-zinc-500">Redis 连接数</p>
              <p className="text-lg font-bold text-zinc-100 mt-1">{system.redis_connected_clients}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <p className="text-xs text-zinc-500">队列长度</p>
              <div className="mt-1 space-y-1">
                {Object.entries(system.queue_lengths).map(([q, len]) => (
                  <div key={q} className="flex justify-between text-xs">
                    <span className="text-zinc-400 font-mono">{q}</span>
                    <span className="text-zinc-100 font-bold">{len}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Workers */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
          <Heartbeat size={14} weight="bold" />
          Worker 状态
        </h2>
        {workers.length === 0 ? (
          <p className="text-xs text-zinc-500">暂无 Worker 信息</p>
        ) : (
          <div className="rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900 text-zinc-400">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">名称</th>
                  <th className="text-left px-4 py-2 font-medium">状态</th>
                  <th className="text-left px-4 py-2 font-medium">当前任务</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {workers.map((w) => (
                  <tr key={w.name} className="bg-zinc-950">
                    <td className="px-4 py-2 font-mono text-zinc-300">{w.name}</td>
                    <td className="px-4 py-2">
                      <span className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                        w.alive ? "bg-emerald-900/30 text-emerald-400" : "bg-red-900/30 text-red-400",
                      )}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", w.alive ? "bg-emerald-400" : "bg-red-400")} />
                        {w.alive ? "在线" : "离线"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-zinc-400">
                      {w.active_tasks.length > 0 ? w.active_tasks.join(", ") : "空闲"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Failed videos */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
          <Warning size={14} weight="bold" />
          最近失败的视频
        </h2>
        {(overview?.recent_failed ?? []).length === 0 ? (
          <p className="text-xs text-zinc-500">暂无失败视频</p>
        ) : (
          <div className="space-y-2">
            {overview!.recent_failed.map((v) => (
              <div key={v.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-200 truncate">{v.title || v.url}</p>
                  <p className="text-xs text-red-400 mt-0.5 truncate">{v.error}</p>
                </div>
                <button
                  onClick={() => retryMut.mutate(v.id)}
                  disabled={retryMut.isPending}
                  className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
                >
                  <ArrowClockwise size={12} weight="bold" />
                  重试
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
