"""Shared constants for the Pingcha application."""


class VideoState:
    """Video processing state values."""
    PENDING = "pending"
    DOWNLOADING = "downloading"
    TRANSCRIBING = "transcribing"
    SUMMARIZING = "summarizing"
    GENERATING_MINDMAP = "generating_mindmap"
    DONE = "done"
    FAILED = "failed"


class ArticleState:
    """Article processing state values."""
    PENDING = "pending"
    EXTRACTING = "extracting"
    SUMMARIZING = "summarizing"
    GENERATING_MINDMAP = "generating_mindmap"
    DONE = "done"
    FAILED = "failed"
