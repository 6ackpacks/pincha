/**
 * Re-export all API modules from the split domain files.
 * This file preserves backward compatibility for existing imports:
 *   import { getVideos, getMe, ... } from "@/lib/api"
 */
export * from "./api/client";
export * from "./api/auth";
export * from "./api/videos";
export * from "./api/wiki";
export * from "./api/articles";
export * from "./api/curate";
export * from "./api/kb";
export * from "./api/notifications";
