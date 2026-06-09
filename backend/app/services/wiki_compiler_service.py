"""Wiki compiler service.

Orchestrates the wiki compilation pipeline: extracts entities from a source,
merges them into the user's personal wiki pages, detects contradictions,
and builds page-to-page relations.

Entity extraction and page manipulation logic lives in wiki_entity_service.
"""

import logging
import uuid

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.wiki import WikiPage, WikiRelation, WikiSource
from app.services.wiki_entity_service import (
    Entity,
    extract_entities,
    find_similar_page,
    merge_entity_into_page,
    create_page_for_entity,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Wiki infrastructure
# ---------------------------------------------------------------------------

async def upsert_wiki_source(
    wiki_page_id: uuid.UUID,
    source_type: str,
    source_id: uuid.UUID,
    contribution: str,
    db: AsyncSession,
) -> None:
    """Add a source record for a wiki page (idempotent)."""
    existing = await db.execute(
        select(WikiSource).where(
            WikiSource.wiki_page_id == wiki_page_id,
            WikiSource.source_id == source_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        return  # already recorded

    db.add(WikiSource(
        wiki_page_id=wiki_page_id,
        source_type=source_type,
        source_id=source_id,
        contribution=contribution,
    ))


async def build_relations(
    entity_map: dict[str, WikiPage],
    db: AsyncSession,
    relations_hint: list[dict] | None = None,
) -> None:
    """Create wiki_relations between co-extracted entities from the same source.

    If relations_hint is provided (from LLM analysis), use those first with
    their specified types and strengths. Fall back to co-occurrence for remaining pairs.
    """
    covered_pairs: set[tuple[uuid.UUID, uuid.UUID]] = set()

    # Phase 1: Use LLM-provided relation hints
    if relations_hint:
        # Build case-insensitive lookup
        title_lower_map = {t.lower(): p for t, p in entity_map.items()}
        for hint in relations_hint:
            from_page = title_lower_map.get(hint.get("from", "").lower())
            to_page = title_lower_map.get(hint.get("to", "").lower())
            if not from_page or not to_page or from_page.id == to_page.id:
                continue
            # Check if relation already exists
            existing = await db.execute(
                select(WikiRelation).where(
                    WikiRelation.from_page_id == from_page.id,
                    WikiRelation.to_page_id == to_page.id,
                )
            )
            if existing.scalar_one_or_none() is not None:
                covered_pairs.add((from_page.id, to_page.id))
                continue
            db.add(WikiRelation(
                from_page_id=from_page.id,
                to_page_id=to_page.id,
                relation_type=hint.get("type", "related"),
                strength=min(max(float(hint.get("strength", 0.7)), 0.0), 1.0),
            ))
            covered_pairs.add((from_page.id, to_page.id))

    # Phase 2: Co-occurrence fallback for uncovered pairs
    for entity_title, page in entity_map.items():
        for other_title, other_page in entity_map.items():
            if other_page.id == page.id:
                continue
            if (page.id, other_page.id) in covered_pairs:
                continue
            existing = await db.execute(
                select(WikiRelation).where(
                    WikiRelation.from_page_id == page.id,
                    WikiRelation.to_page_id == other_page.id,
                )
            )
            if existing.scalar_one_or_none() is not None:
                continue
            db.add(WikiRelation(
                from_page_id=page.id,
                to_page_id=other_page.id,
                relation_type="related",
                strength=0.6,
            ))


async def recompute_communities(user_id: uuid.UUID, db: AsyncSession) -> None:
    """Recompute Louvain community assignments for all wiki pages of a user.

    Simplified Louvain implementation suitable for <500 nodes.
    """
    # Fetch all pages and relations
    pages_result = await db.execute(
        select(WikiPage.id).where(WikiPage.user_id == user_id)
    )
    page_ids = [r[0] for r in pages_result.all()]
    if len(page_ids) < 2:
        # Single page or empty — assign community 0
        for pid in page_ids:
            await db.execute(
                sa.update(WikiPage).where(WikiPage.id == pid).values(community_id=0)
            )
        return

    page_id_set = set(page_ids)
    relations_result = await db.execute(
        select(WikiRelation.from_page_id, WikiRelation.to_page_id, WikiRelation.strength).where(
            WikiRelation.from_page_id.in_(page_ids),
            WikiRelation.to_page_id.in_(page_ids),
        )
    )
    edges = relations_result.all()

    # Build adjacency list (undirected, weighted)
    adj: dict[uuid.UUID, dict[uuid.UUID, float]] = {pid: {} for pid in page_ids}
    total_weight = 0.0
    for from_id, to_id, strength in edges:
        if from_id not in page_id_set or to_id not in page_id_set:
            continue
        w = strength or 0.5
        adj[from_id][to_id] = adj[from_id].get(to_id, 0) + w
        adj[to_id][from_id] = adj[to_id].get(from_id, 0) + w
        total_weight += w

    if total_weight == 0:
        # No edges — each node is its own community
        for i, pid in enumerate(page_ids):
            await db.execute(
                sa.update(WikiPage).where(WikiPage.id == pid).values(community_id=i)
            )
        return

    m2 = total_weight * 2  # 2m in modularity formula

    # Node degree (sum of edge weights)
    k: dict[uuid.UUID, float] = {}
    for pid in page_ids:
        k[pid] = sum(adj[pid].values())

    # Initialize: each node in its own community
    community: dict[uuid.UUID, int] = {pid: i for i, pid in enumerate(page_ids)}

    # Community aggregates
    # sum_tot[c] = sum of degrees of nodes in community c
    # sum_in[c] = sum of edge weights within community c
    sum_tot: dict[int, float] = {i: k[pid] for i, pid in enumerate(page_ids)}
    sum_in: dict[int, float] = {i: 0.0 for i in range(len(page_ids))}

    # Louvain phase 1: local moving
    max_iterations = 20
    for iteration in range(max_iterations):
        moved = False
        for node in page_ids:
            current_comm = community[node]
            k_i = k[node]

            # Compute weights to neighboring communities
            neighbor_comms: dict[int, float] = {}
            for neighbor, w in adj[node].items():
                nc = community[neighbor]
                neighbor_comms[nc] = neighbor_comms.get(nc, 0) + w

            # Weight to own community
            k_i_in_current = neighbor_comms.get(current_comm, 0.0)

            # Remove node from current community
            sum_tot[current_comm] -= k_i
            sum_in[current_comm] -= 2 * k_i_in_current

            # Find best community
            best_comm = current_comm
            best_delta = 0.0

            for target_comm, k_i_in_target in neighbor_comms.items():
                # Modularity gain of moving node to target_comm
                delta = (k_i_in_target - sum_tot.get(target_comm, 0) * k_i / m2)
                if delta > best_delta:
                    best_delta = delta
                    best_comm = target_comm

            # Move node to best community
            community[node] = best_comm
            sum_tot[best_comm] = sum_tot.get(best_comm, 0) + k_i
            k_i_in_best = neighbor_comms.get(best_comm, 0.0)
            sum_in[best_comm] = sum_in.get(best_comm, 0) + 2 * k_i_in_best

            if best_comm != current_comm:
                moved = True

        if not moved:
            break

    # Renumber communities to be contiguous (0, 1, 2, ...)
    unique_comms = sorted(set(community.values()))
    comm_remap = {old: new for new, old in enumerate(unique_comms)}

    # Batch update
    for pid in page_ids:
        new_comm = comm_remap[community[pid]]
        await db.execute(
            sa.update(WikiPage).where(WikiPage.id == pid).values(community_id=new_comm)
        )


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def compile_source_into_wiki(
    user_id: uuid.UUID,
    source_type: str,   # 'video' | 'article'
    source_id: uuid.UUID,
    source_title: str,
    content: str,
    db: AsyncSession,
    kb_id: uuid.UUID | None = None,
) -> dict:
    """Full pipeline: extract entities from content and upsert into wiki."""
    logger.info("Compiling wiki from %s %s for user %s", source_type, source_id, user_id)

    # Resolve kb_id: use provided or find user's default KB
    from app.models.knowledge_base import KnowledgeBase
    if kb_id is not None:
        # Verify the provided kb_id actually exists
        kb_exists = await db.execute(
            select(KnowledgeBase.id).where(KnowledgeBase.id == kb_id)
        )
        if kb_exists.scalar_one_or_none() is None:
            logger.warning("Provided kb_id %s does not exist, falling back to default", kb_id)
            kb_id = None

    if kb_id is None:
        kb_result = await db.execute(
            select(KnowledgeBase.id).where(
                KnowledgeBase.user_id == user_id, KnowledgeBase.is_default == True
            )
        )
        kb_id = kb_result.scalar_one_or_none()
        if kb_id is None:
            # Create default KB if missing
            new_kb = KnowledgeBase(user_id=user_id, name="默认知识库", is_default=True)
            db.add(new_kb)
            await db.flush()
            kb_id = new_kb.id

    # Query existing pages for context
    existing_result = await db.execute(
        select(WikiPage.title, WikiPage.summary).where(WikiPage.user_id == user_id, WikiPage.kb_id == kb_id).limit(50)
    )
    existing_pages = [{"title": r[0], "summary": r[1]} for r in existing_result.all()]

    entities, analysis_meta = await extract_entities(content, source_title, existing_pages)
    if not entities:
        logger.warning("No entities extracted from %s %s", source_type, source_id)
        return {"pages_created": 0, "pages_updated": 0}

    pages_created = 0
    pages_updated = 0
    entity_page_map: dict[str, WikiPage] = {}

    # Extract contradiction info from analysis
    contradictions = analysis_meta.get("contradictions", [])

    for entity in entities:
        title = entity.get("title", "").strip()
        if not title:
            continue

        existing_page = await find_similar_page(user_id, title, db, kb_id=kb_id)

        if existing_page is None:
            page = await create_page_for_entity(user_id, entity, db, kb_id=kb_id)
            page.type = entity.get("type", "concept")
            pages_created += 1
        else:
            page = await merge_entity_into_page(existing_page, entity, source_title, db)
            page.type = page.type or entity.get("type", "concept")
            page.source_count = (page.source_count or 0) + 1
            page.status = "ready"
            pages_updated += 1

        # Write contradiction details for this entity
        entity_contradictions = [
            c for c in contradictions
            if c.get("entity", "").strip().lower() == title.lower()
        ]
        if entity_contradictions:
            existing_details = list(page.contradiction_details or [])
            existing_details.extend(entity_contradictions)
            page.contradiction_details = existing_details
            page.has_contradiction = True

        # Populate review_items from analysis contradictions
        new_review_items: list[dict] = []
        for c in entity_contradictions:
            desc = c.get("claim", "")
            existing_claim = c.get("existing_claim", "")
            if existing_claim:
                desc = f"{desc}（现有知识库：{existing_claim}）"
            new_review_items.append({
                "type": "contradiction",
                "description": desc,
                "action": f"severity: {c.get('severity', 'minor')}",
                "resolved": False,
            })
        if new_review_items:
            existing_items = list(page.review_items or [])
            existing_items.extend(new_review_items)
            page.review_items = existing_items

        # Record source contribution
        claims_text = "; ".join(entity.get("key_claims", []))
        await upsert_wiki_source(
            wiki_page_id=page.id,
            source_type=source_type,
            source_id=source_id,
            contribution=claims_text[:500],
            db=db,
        )

        entity_page_map[title] = page

    # Distribute analysis suggestions as review_items across all pages in this batch
    suggestions = analysis_meta.get("suggestions", [])
    if suggestions and entity_page_map:
        suggestion_items = [
            {
                "type": "suggestion",
                "description": s,
                "resolved": False,
            }
            for s in suggestions
            if isinstance(s, str) and s.strip()
        ]
        if suggestion_items:
            for page in entity_page_map.values():
                existing_items = list(page.review_items or [])
                existing_items.extend(suggestion_items)
                page.review_items = existing_items

    # Build relations with hints from analysis
    relations_hint = analysis_meta.get("relations")
    await build_relations(entity_page_map, db, relations_hint=relations_hint)

    # Sync [[WikiLink]] in page content -> WikiRelation (Fix #1)
    from app.services.wiki_utils import sync_wikilinks_to_relations
    for page in entity_page_map.values():
        await sync_wikilinks_to_relations(db, page, user_id, kb_id)

    await db.commit()
    logger.info(
        "Wiki compilation done for %s %s: +%d pages, ~%d updated",
        source_type, source_id, pages_created, pages_updated,
    )

    # Recompute communities after wiki update
    try:
        await recompute_communities(user_id, db)
        await db.commit()
    except Exception as exc:
        logger.warning("Community recomputation failed: %s", exc)

    return {"pages_created": pages_created, "pages_updated": pages_updated}
