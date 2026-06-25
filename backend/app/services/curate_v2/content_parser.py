"""ProseMirror / TipTap JSON content parser.

Extracts plain text and structural metrics from the nested node tree
returned by watcha.cn's content API.
"""

from __future__ import annotations

from typing import Any


def extract_plain_text(content_json: dict[str, Any] | str | None) -> str:
    """Recursively extract text from ProseMirror JSON nodes."""
    if not content_json:
        return ""
    if isinstance(content_json, str):
        return content_json

    parts: list[str] = []
    _walk_text(content_json, parts)
    return "\n".join(parts).strip()


def _walk_text(node: Any, parts: list[str]) -> None:
    """Depth-first walk collecting text content."""
    if isinstance(node, str):
        parts.append(node)
        return
    if not isinstance(node, dict):
        return
    node_type = node.get("type", "")

    if node_type == "text":
        text = node.get("text", "")
        if text:
            parts.append(text)
        return

    children = node.get("content")
    if not children:
        return

    block_types = {
        "paragraph", "heading", "blockquote", "codeBlock",
        "listItem", "bulletList", "orderedList", "taskList", "taskItem",
        "table", "tableRow", "tableCell", "tableHeader",
    }

    if node_type in block_types:
        inline_parts: list[str] = []
        for child in children:
            _walk_text(child, inline_parts)
        combined = "".join(inline_parts).strip()
        if combined:
            parts.append(combined)
    else:
        for child in children:
            _walk_text(child, parts)


def count_paragraphs(content_json: dict[str, Any] | str | None) -> int:
    """Count paragraph nodes in the content tree."""
    if not content_json or isinstance(content_json, str):
        return 0
    return _count_nodes_by_type(content_json, {"paragraph"})


def count_links(content_json: dict[str, Any] | str | None) -> int:
    """Count nodes with link marks or link-type nodes."""
    if not content_json or isinstance(content_json, str):
        return 0
    return _count_nodes_with_link_marks(content_json) + _count_nodes_by_type(
        content_json, {"link", "autolink"}
    )


def count_images(content_json: dict[str, Any] | str | None) -> int:
    """Count image nodes."""
    if not content_json or isinstance(content_json, str):
        return 0
    return _count_nodes_by_type(content_json, {"image", "figure", "resizableImage"})


def has_list_or_heading(content_json: dict[str, Any] | str | None) -> bool:
    """Check if content has bulletList, orderedList, or heading nodes."""
    if not content_json or isinstance(content_json, str):
        return False
    return _has_any_node_type(
        content_json, {"bulletList", "orderedList", "taskList", "heading"}
    )


def _count_nodes_by_type(node: Any, types: set[str]) -> int:
    if not isinstance(node, dict):
        return 0
    count = 0
    if node.get("type") in types:
        count += 1
    for child in node.get("content") or []:
        count += _count_nodes_by_type(child, types)
    return count


def _count_nodes_with_link_marks(node: Any) -> int:
    if not isinstance(node, dict):
        return 0
    count = 0
    marks = node.get("marks") or []
    for mark in marks:
        if isinstance(mark, dict) and mark.get("type") == "link":
            count += 1
            break
    for child in node.get("content") or []:
        count += _count_nodes_with_link_marks(child)
    return count


def _has_any_node_type(node: Any, types: set[str]) -> bool:
    if not isinstance(node, dict):
        return False
    if node.get("type") in types:
        return True
    for child in node.get("content") or []:
        if _has_any_node_type(child, types):
            return True
    return False
