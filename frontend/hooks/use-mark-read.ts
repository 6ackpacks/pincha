"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { markNotificationRead, markAllNotificationsRead } from "@/lib/api";

/**
 * Hook for marking curate notifications as read.
 * Invalidates the unread count query on success.
 */
export function useMarkRead() {
  const queryClient = useQueryClient();

  const markOneMut = useMutation({
    mutationFn: (notificationId: number) => markNotificationRead(notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["curate-v2-unread-count"] });
    },
  });

  const markAllMut = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["curate-v2-unread-count"] });
    },
  });

  return {
    markOne: markOneMut.mutate,
    markAll: markAllMut.mutate,
    isMarkingOne: markOneMut.isPending,
    isMarkingAll: markAllMut.isPending,
  };
}
