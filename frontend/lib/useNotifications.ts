"use client";

import { useCallback, useEffect, useState } from "react";
import {
  InAppNotification,
  loadNotifications,
  markAllRead,
  markOneRead,
} from "@/lib/notificationService";

export function useNotifications() {
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);

  const refresh = useCallback(() => {
    setNotifications(loadNotifications());
  }, []);

  useEffect(() => {
    refresh();

    const onNew = () => refresh();
    const onRead = () => refresh();

    window.addEventListener("agentgate:notification", onNew);
    window.addEventListener("agentgate:notifications-read", onRead);
    // Also refresh when the approvals queue fires a gateway refresh
    window.addEventListener("gateway:refresh", onNew);

    return () => {
      window.removeEventListener("agentgate:notification", onNew);
      window.removeEventListener("agentgate:notifications-read", onRead);
      window.removeEventListener("gateway:refresh", onNew);
    };
  }, [refresh]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const dismissOne = useCallback(
    (id: string) => {
      markOneRead(id);
      refresh();
    },
    [refresh]
  );

  const dismissAll = useCallback(() => {
    markAllRead();
    refresh();
  }, [refresh]);

  return { notifications, unreadCount, dismissOne, dismissAll, refresh };
}
