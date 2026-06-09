"""ProseMirror / TipTap JSON content parser.

Extracts plain text and structural metrics from the nested node tree
returned by watcha.cn's content API.
"""

from __future__ import annotations

from typing import Any


def extract_plain_text(content_json: dict[str, Any] | None) -> str:
    """Recursively extract text from ProseMirror JSON nodes."""
    if not content_json:
        return ""

    parts: list[str] = []
    _walk_text(content_json, parts)
    return "\n".join(parts).strip()


def _walk_text(node: dict[str, Any], parts: list[str]) -> None:
    """Depth-first walk collecting text content."""
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


def count_paragraphs(content_json: dict[str, Any] | None) -> int:
    """Count paragraph nodes in the content tree."""
    if not content_json:
        return 0
    return _count_nodes_by_type(content_json, {"paragraph"})


def count_links(content_json: dict[str, Any] | None) -> int:
    """Count nodes with link marks or link-type nodes."""
    if not content_json:
        return 0
    return _count_nodes_with_link_marks(content_json) + _count_nodes_by_type(
        content_json, {"link", "autolink"}
    )


def count_images(content_json: dict[str, Any] | None) -> int:
    """Count image nodes."""
    if not content_json:
        return 0
    return _count_nodes_by_type(content_json, {"image", "figure", "resizableImage"})


def has_list_or_heading(content_json: dict[str, Any] | None) -> bool:
    """Check if content has bulletList, orderedList, or heading nodes."""
    if not content_json:
        return False
    return _has_any_node_type(
        content_json, {"bulletList", "orderedList", "taskList", "heading"}
    )


def _count_nodes_by_type(node: dict[str, Any], types: set[str]) -> int:
    count = 0
    if node.get("type") in types:
        count += 1
    for child in node.get("content") or []:
        count += _count_nodes_by_type(child, types)
    return count


def _count_nodes_with_link_marks(node: dict[str, Any]) -> int:
    count = 0
    marks = node.get("marks") or []
    for mark in marks:
        if mark.get("type") == "link":
            count += 1
            break
    for child in node.get("content") or []:
        count += _count_nodes_with_link_marks(child)
    return count


def _has_any_node_type(node: dict[str, Any], types: set[str]) -> bool:
    if node.get("type") in types:
        return True
    for child in node.get("content") or []:
        if _has_any_node_type(child, types):
            return True
    return False
