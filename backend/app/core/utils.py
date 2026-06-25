"""Shared utility functions for the Pingcha application."""


def escape_like(text: str) -> str:
    """转义 LIKE/ILIKE 通配符，防止用户输入 % 或 _ 匹配全表。

    使用反斜杠作为转义字符（PostgreSQL 默认行为）。
    调用方仍需自行在前后加 % 实现模糊匹配：
        pattern = f"%{escape_like(search_text)}%"
    """
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
