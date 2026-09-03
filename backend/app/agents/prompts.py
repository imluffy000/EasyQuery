"""System prompts for each pipeline stage.

Every prompt inherits `SYSTEM_TRUST_PREAMBLE`, which states the trust rules
that untrusted fenced content cannot override. Prompts are kept here rather
than inline so they are reviewable in one place and diffable over time.
"""

from __future__ import annotations

import json
from typing import Any

from app.security.trust_boundary import (
    SYSTEM_TRUST_PREAMBLE,
    TrustLevel,
    wrap_untrusted,
)

INTENT_SYSTEM = f"""{SYSTEM_TRUST_PREAMBLE}

Classify what the user is asking for.

intent must be one of: aggregate, lookup, trend, comparison, ranking,
distribution, schema_question, unsupported.

- aggregate: a total, count, or average
- lookup: specific rows
- trend: a measure over time
- comparison: two periods, segments, or groups
- ranking: top/bottom N
- distribution: how values spread across buckets
- schema_question: about structure, not data
- unsupported: cannot be answered from a database

List the business entities mentioned (customers, orders, revenue). Keep
reasoning_summary to one short sentence; it is shown to no one and must not
contain step-by-step reasoning.
"""


AMBIGUITY_SYSTEM = f"""{SYSTEM_TRUST_PREAMBLE}

Decide whether the question can be answered without guessing.

Mark is_ambiguous = true ONLY when a reasonable analyst would produce
materially different SQL depending on the interpretation, AND the schema,
glossary, and conversation context do not settle it.

Ambiguity dimensions: metric, entity, time_period, filter, aggregation,
join_path, business_term, comparison_period, sorting, scope.

Do NOT ask when:
- the glossary already defines the term;
- earlier turns established the period, filter, or entity;
- only one table or column could plausibly be meant;
- the difference would not change the result.

DO ask when a word like "best", "top", "active", or "recent" maps to several
concrete definitions that would change the answer.

When asking: give 2-4 concrete options phrased in the user's language, each
with a short `value` naming the definition. Keep `question` under 12 words.
Set allow_free_text = true unless the options are genuinely exhaustive.
"""


PLANNER_SYSTEM = f"""{SYSTEM_TRUST_PREAMBLE}

Translate the question into a structured query plan. Do not write SQL here.

Rules:
- Use only tables and columns present in the supplied schema.
- Resolve business terms through the glossary when one is given.
- Express time filters as a preset when possible (this_month, last_month,
  last_30_days, this_quarter, this_year, last_year), otherwise explicit dates.
- `metrics` are measures to compute; `dimensions` are what to group by.
- Record every interpretation you had to make in `assumptions`. These are
  shown to the user, so write them as plain statements of fact.
- If the question needs a join, name the tables in `tables` and the join
  conditions in `joins` using the real foreign keys from the schema.
"""


SQL_SYSTEM = f"""{SYSTEM_TRUST_PREAMBLE}

Write ONE read-only SQL statement implementing the supplied query plan.

Hard requirements:
- A single SELECT or WITH statement. Never multiple statements.
- Reference only tables and columns that appear in the schema.
- Qualify tables with their schema (public.orders, not orders).
- Always include an explicit ORDER BY when returning a ranking or a series.
- Include a LIMIT appropriate to the question; a row ceiling is enforced
  regardless, so prefer a smaller, more useful result.
- Use the exact dialect requested.
- Never invent a column. If the plan needs a column that does not exist in
  the schema, set needs_clarification = true and explain in assumptions.
- Prefer explicit JOIN ... ON over comma joins.
- For date bucketing on Postgres use date_trunc.

Put the statement in `sql` with no trailing semicolon and no markdown fence.
List every table you touched in `tables_used`.
"""


SQL_CORRECTION_SYSTEM = f"""{SYSTEM_TRUST_PREAMBLE}

Your previous SQL failed. You are given the original question, the schema, the
failing SQL, and the exact error.

Fix the specific problem the error names. Common cases:
- "column ... does not exist": find the correct column in the schema, or drop
  it if the plan does not need it.
- "relation ... does not exist": use the schema-qualified name from the schema.
- a syntax error: re-emit the statement correctly.

Do not restructure the query beyond what the error requires, and do not widen
its scope. Return a single read-only statement.
"""


VISUALIZATION_SYSTEM = f"""{SYSTEM_TRUST_PREAMBLE}

Choose how to present a result set. Return only a chart specification --
never code, HTML, or a component.

type must be one of: table, kpi, line, bar, area, pie, histogram, scatter.
"""


ANSWER_SYSTEM = f"""{SYSTEM_TRUST_PREAMBLE}

Write the final answer for a data-literate user.

- Lead with the number that answers the question, formatted readably.
- Name the time range if one was applied.
- Mention the single most useful secondary detail (a top contributor, a
  change versus the previous period) when the data supports it.
- State any assumption that materially shaped the result, in one clause.
- If the result was truncated, say so.
- If there were no rows, say that plainly and suggest the most likely reason.

Style: 1-3 sentences. No preamble, no restating the question, no bullet lists
unless comparing three or more items. Never write "As an AI language model",
never mention SQL generation, prompts, or your own process. The user can see
the SQL separately; do not narrate it.

Return plain text, not JSON.
"""


def render_context_block(
    *,
    schema: str,
    glossary: dict[str, str] | None = None,
    summary: str = "",
    turns: list[dict[str, str]] | None = None,
    max_turns: int = 6,
) -> str:
    """Assemble the shared context every reasoning node receives.

    Schema and conversation history are fenced as untrusted: a table named
    `ignore_all_previous_instructions` must not become an instruction.
    """
    sections: list[str] = []

    sections.append("Schema:\n" + wrap_untrusted(schema, kind=TrustLevel.SCHEMA))

    if glossary:
        sections.append(
            "Business glossary (authoritative definitions):\n"
            + wrap_untrusted(
                "\n".join(f"- {term} = {definition}" for term, definition in glossary.items()),
                kind=TrustLevel.SCHEMA,
            )
        )

    if summary:
        sections.append("Conversation so far:\n" + wrap_untrusted(summary, kind=TrustLevel.USER))

    if turns:
        recent = turns[-max_turns:]
        rendered = "\n".join(f"{t.get('role', 'user')}: {t.get('content', '')}" for t in recent)
        sections.append("Recent turns:\n" + wrap_untrusted(rendered, kind=TrustLevel.USER))

    return "\n\n".join(sections)


def render_schema_context(tables: list[dict[str, Any]]) -> str:
    """Render retrieved schema metadata compactly.

    Format is deliberately terse -- schema is the largest part of the prompt
    and directly drives cost.
    """
    lines: list[str] = []
    for table in tables:
        qualified = f"{table['schema']}.{table['name']}"
        header = f"table {qualified}"
        if table.get("comment"):
            header += f"  -- {table['comment']}"
        if table.get("estimated_rows") is not None:
            header += f"  (~{int(table['estimated_rows']):,} rows)"
        lines.append(header)

        for column in table.get("columns", []):
            flags: list[str] = []
            if column.get("is_primary_key"):
                flags.append("PK")
            if not column.get("nullable", True):
                flags.append("NOT NULL")
            if column.get("sensitivity") and column["sensitivity"] != "none":
                flags.append(f"{column['sensitivity'].upper()}-PII")
            suffix = f"  [{', '.join(flags)}]" if flags else ""
            comment = f"  -- {column['comment']}" if column.get("comment") else ""
            lines.append(f"  {column['name']} {column['data_type']}{suffix}{comment}")

        for fk in table.get("foreign_keys", []):
            lines.append(
                f"  FK {fk['column']} -> "
                f"{fk['references_schema']}.{fk['references_table']}.{fk['references_column']}"
            )
        lines.append("")

    return "\n".join(lines).strip()


def render_json(value: Any) -> str:
    return json.dumps(value, indent=2, default=str)
