"""Schema RAG (spec section 17).

Sending an entire schema to the model is the main driver of both cost and
wrong-table errors on any database above trivial size. This module picks the
handful of tables a question actually needs.

Pipeline: keyword/lexical scoring -> optional vector similarity ->
relationship expansion -> rerank -> budget-limited context.

Relationship expansion matters more than the scoring does: a question about
"revenue by city" scores `orders` and `customers` highly but needs the join
between them, so any table reachable by a foreign key from a selected table is
pulled in even when its own score is low.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Protocol

import structlog

log = structlog.get_logger(__name__)

_WORD = re.compile(r"[a-z0-9_]+")

# Words that carry no schema signal.
_STOPWORDS: frozenset[str] = frozenset(
    """
    a an and are as at be by for from how in is it many much of on or show me
    that the this to was what when where which who with give list find get all
    my our their do does did i we you please tell about into over per
    """.split()
)


def tokenize(text: str) -> list[str]:
    return [w for w in _WORD.findall(text.lower()) if w not in _STOPWORDS and len(w) > 1]


def singularize(word: str) -> str:
    """Crude but effective: 'customers' in a question, `customer` in the schema."""
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith("ses") and len(word) > 4:
        return word[:-2]
    if word.endswith("s") and not word.endswith("ss") and len(word) > 3:
        return word[:-1]
    return word


def expand(tokens: list[str]) -> set[str]:
    out: set[str] = set()
    for token in tokens:
        out.add(token)
        out.add(singularize(token))
        # snake_case parts are independently meaningful: total_amount -> total, amount
        out.update(part for part in token.split("_") if len(part) > 2)
    return out


class Embedder(Protocol):
    """Optional vector backend. Absent it, retrieval is lexical only."""

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


@dataclass
class TableCandidate:
    """One table plus everything retrieval needs to score and render it."""

    schema: str
    name: str
    description: str = ""
    estimated_rows: int | None = None
    columns: list[dict[str, Any]] = field(default_factory=list)
    foreign_keys: list[dict[str, Any]] = field(default_factory=list)
    indexes: list[dict[str, Any]] = field(default_factory=list)
    kind: str = "table"
    embedding: list[float] | None = None

    score: float = 0.0
    included_because: str = ""

    @property
    def qualified_name(self) -> str:
        return f"{self.schema}.{self.name}"

    @property
    def search_document(self) -> str:
        parts = [self.name, self.schema, self.description]
        parts.extend(str(c.get("name", "")) for c in self.columns)
        parts.extend(str(c.get("comment") or "") for c in self.columns)
        return " ".join(p for p in parts if p)

    def to_context_dict(self) -> dict[str, Any]:
        return {
            "schema": self.schema,
            "name": self.name,
            "comment": self.description,
            "estimated_rows": self.estimated_rows,
            "columns": self.columns,
            "foreign_keys": self.foreign_keys,
        }


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


class SchemaRetriever:
    """Selects the tables relevant to one question."""

    def __init__(
        self,
        *,
        embedder: Embedder | None = None,
        max_tables: int = 8,
        max_expansion: int = 4,
        min_score: float = 0.5,
    ) -> None:
        self.embedder = embedder
        self.max_tables = max_tables
        self.max_expansion = max_expansion
        self.min_score = min_score

    async def retrieve(
        self,
        question: str,
        candidates: list[TableCandidate],
        *,
        glossary: dict[str, str] | None = None,
        pinned: list[str] | None = None,
    ) -> list[TableCandidate]:
        if not candidates:
            return []

        # A glossary definition naming a table is a direct signal -- fold the
        # definitions of any mentioned term into the query text.
        enriched = question
        if glossary:
            lowered = question.lower()
            for term, definition in glossary.items():
                if term.lower() in lowered:
                    enriched = f"{enriched} {definition}"

        terms = expand(tokenize(enriched))

        for candidate in candidates:
            candidate.score = self._lexical_score(candidate, terms)
            candidate.included_because = "keyword match"

        if self.embedder is not None:
            await self._apply_vector_scores(enriched, candidates)

        # Pinned tables (e.g. the user selected one in the explorer) always win.
        pinned_set = {p.lower() for p in (pinned or [])}
        for candidate in candidates:
            if candidate.qualified_name.lower() in pinned_set:
                candidate.score += 10.0
                candidate.included_because = "explicitly selected"

        ranked = sorted(candidates, key=lambda c: c.score, reverse=True)
        selected = [c for c in ranked if c.score >= self.min_score][: self.max_tables]

        # Nothing matched -- fall back to the largest tables rather than
        # returning an empty schema, which would guarantee a wrong answer.
        if not selected:
            selected = sorted(
                candidates, key=lambda c: (c.estimated_rows or 0), reverse=True
            )[: min(3, self.max_tables)]
            for candidate in selected:
                candidate.included_because = "fallback: no keyword match"

        selected = self._expand_relationships(selected, candidates)
        log.debug(
            "schema_retrieved",
            selected=[c.qualified_name for c in selected],
            candidate_count=len(candidates),
        )
        return selected

    def _lexical_score(self, candidate: TableCandidate, terms: set[str]) -> float:
        score = 0.0
        table_tokens = expand(tokenize(candidate.name))

        # Table-name hits are the strongest signal.
        overlap = terms & table_tokens
        score += 4.0 * len(overlap)
        if candidate.name.lower() in terms:
            score += 3.0

        for column in candidate.columns:
            column_tokens = expand(tokenize(str(column.get("name", ""))))
            hits = terms & column_tokens
            score += 1.2 * len(hits)

        if candidate.description:
            description_tokens = expand(tokenize(candidate.description))
            score += 0.6 * len(terms & description_tokens)

        # Prefer real tables over views when both match equally.
        if candidate.kind == "view":
            score *= 0.9

        return score

    async def _apply_vector_scores(
        self, question: str, candidates: list[TableCandidate]
    ) -> None:
        embedded = [c for c in candidates if c.embedding]
        if not embedded or self.embedder is None:
            return
        try:
            vectors = await self.embedder.embed([question])
        except Exception as exc:  # noqa: BLE001 - degrade to lexical only
            log.warning("embedding_failed", error=str(exc))
            return
        if not vectors:
            return
        query_vector = vectors[0]
        for candidate in embedded:
            similarity = _cosine(query_vector, candidate.embedding or [])
            # Additive so a strong lexical match is never buried by a weak
            # vector score, and vice versa.
            candidate.score += 5.0 * similarity

    def _expand_relationships(
        self, selected: list[TableCandidate], all_candidates: list[TableCandidate]
    ) -> list[TableCandidate]:
        """Pull in tables reachable by a foreign key from the selection."""
        by_name = {c.qualified_name.lower(): c for c in all_candidates}
        chosen = {c.qualified_name.lower() for c in selected}
        additions: list[TableCandidate] = []

        for candidate in selected:
            for fk in candidate.foreign_keys:
                target = (
                    f"{fk.get('references_schema', '')}.{fk.get('references_table', '')}".lower()
                )
                if target in chosen or target not in by_name:
                    continue
                if len(additions) >= self.max_expansion:
                    break
                related = by_name[target]
                related.included_because = f"joined from {candidate.qualified_name}"
                additions.append(related)
                chosen.add(target)

        # Also include tables whose FK points *at* a selected table -- a
        # child table (order_items) is usually needed for line-level questions.
        for other in all_candidates:
            if len(additions) >= self.max_expansion:
                break
            if other.qualified_name.lower() in chosen:
                continue
            for fk in other.foreign_keys:
                target = (
                    f"{fk.get('references_schema', '')}.{fk.get('references_table', '')}".lower()
                )
                if target in chosen:
                    other.included_because = f"references {target}"
                    additions.append(other)
                    chosen.add(other.qualified_name.lower())
                    break

        return selected + additions
