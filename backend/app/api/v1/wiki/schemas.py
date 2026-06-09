"""Wiki 子模块共享的 Pydantic schema 定义。

包含所有 wiki 相关 API 的请求/响应模型。
"""

from datetime import datetime

from pydantic import BaseModel, field_validator


# ---------------------------------------------------------------------------
# 响应模型
# ---------------------------------------------------------------------------

class WikiPageSummary(BaseModel):
    id: str
    title: str
    slug: str
    type: str = "concept"
    summary: str | None
    source_count: int
    status: str
    has_contradiction: bool
    community_id: int | None = None
    tags: list[str]
    updated_at: datetime

    model_config = {"from_attributes": True}


class WikiSourceInfo(BaseModel):
    id: str
    source_type: str
    source_id: str
    contribution: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class WikiRelationInfo(BaseModel):
    id: str
    to_page_id: str
    to_page_slug: str
    to_page_title: str
    relation_type: str
    strength: float

    model_config = {"from_attributes": True}


class WikiBacklinkInfo(BaseModel):
    id: str          # wiki_page_id (the page that links to current page)
    title: str
    slug: str
    summary: str | None

    model_config = {"from_attributes": True}


class WikiPageDetail(BaseModel):
    id: str
    title: str
    slug: str
    type: str = "concept"
    content: str
    summary: str | None
    source_count: int
    status: str
    has_contradiction: bool
    contradiction_details: list[dict] = []
    review_items: list[dict] = []
    tags: list[str]
    sources: list[WikiSourceInfo]
    relations: list[WikiRelationInfo]
    backlinks: list[WikiBacklinkInfo] = []
    updated_at: datetime

    model_config = {"from_attributes": True}


class ArticleSummary(BaseModel):
    id: str
    source_type: str
    source_url: str | None
    title: str | None
    status: dict
    in_wiki: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class QuotaResponse(BaseModel):
    used: int
    limit: int
    remaining: int


class TagTreeNode(BaseModel):
    name: str
    full_path: str
    count: int
    children: list["TagTreeNode"]


class IngestVideoRequest(BaseModel):
    pass  # video_id comes from path


class CreateArticleRequest(BaseModel):
    source_type: str  # 'url' | 'text'
    source_url: str | None = None
    title: str | None = None
    content: str | None = None  # for text type

    @field_validator("source_url")
    @classmethod
    def validate_source_url_scheme(cls, v: str | None) -> str | None:
        """只允许 http/https 协议，防止 javascript: 等协议注入。"""
        if v is None:
            return v
        stripped = v.strip()
        if not stripped.startswith(("http://", "https://")):
            raise ValueError("source_url 只允许 http:// 或 https:// 协议")
        return stripped


class AskRequest(BaseModel):
    question: str
    topic: str | None = None
    history: list[dict] | None = None


class WikiVideoPageRef(BaseModel):
    id: str
    title: str
    slug: str
    model_config = {"from_attributes": True}


class WikiVideoItem(BaseModel):
    id: str
    title: str | None
    thumbnail_url: str | None
    created_at: datetime
    wiki_pages: list[WikiVideoPageRef]
    model_config = {"from_attributes": True}


class GraphNode(BaseModel):
    id: str
    title: str
    slug: str
    type: str = "concept"
    community_id: int | None = None
    source_count: int
    model_config = {"from_attributes": True}


class GraphEdge(BaseModel):
    id: str
    from_id: str
    to_id: str
    relation_type: str
    strength: float
    model_config = {"from_attributes": True}


class GraphData(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class LocalGraphNode(GraphNode):
    is_center: bool = False


class LocalGraphData(BaseModel):
    nodes: list[LocalGraphNode]
    edges: list[GraphEdge]


class WikiSearchResult(WikiPageSummary):
    """搜索结果，包含高亮片段。"""
    highlight: str | None = None


class UnlinkedMention(BaseModel):
    page_id: str
    page_title: str
    page_slug: str
    context: str


class LinkMentionRequest(BaseModel):
    source_page_id: str
    mention_text: str


# ---------------------------------------------------------------------------
# 页面 CRUD 请求模型
# ---------------------------------------------------------------------------

class CreateWikiPageRequest(BaseModel):
    title: str
    content: str = ""
    summary: str | None = None
    tags: list[str] = []
    type: str = "concept"


class UpdateWikiPageRequest(BaseModel):
    title: str | None = None
    content: str | None = None
    summary: str | None = None
    tags: list[str] | None = None
    type: str | None = None
