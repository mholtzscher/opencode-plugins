# Recover document structure without rewriting its wording

Use this for text whose headings, list markers, or paragraph boundaries were lost. Let the model classify boundaries and block types, while code preserves source text and renders the markup.

Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved.

## Evidence needed

Split and number source lines in code, preserving offsets and blank-line information. Honor explicit markers and other deterministic structure directly. Ask about ambiguous adjacent line boundaries only.

Ask whether a line continues a sentence, rather than whether two lines discuss the same topic: the latter can incorrectly collapse an entire list into a paragraph.

The second call depends on blocks built after the first call. Include surrounding blocks so a heading can be distinguished from a short paragraph.

## Example payload

### Pass 1: recover boundaries

```json
{
  "state": {
    "lines": {
      "L001": "Migration begins on Friday and",
      "L002": "finishes on Monday.",
      "L003": "Owners"
    }
  },
  "questions": {
    "join_L001_L002": {
      "type": "noul",
      "instructions": "Does the boundary between L001 and L002 split a sentence that continues on L002?"
    },
    "join_L002_L003": {
      "type": "noul",
      "instructions": "Does the boundary between L002 and L003 split a sentence that continues on L003?"
    }
  }
}
```

### Pass 2: classify the resulting blocks

Apply the boundary policy described below to the first call's answers before constructing the second call. The following payload illustrates a possible block set, not a recorded result of the first example.

```json
{
  "state": {
    "blocks": {
      "B001": "Migration begins on Friday and finishes on Monday.",
      "B002": "Owners",
      "B003": "The platform team handles the database."
    }
  },
  "questions": {
    "type_B002": {
      "type": "choice",
      "instructions": "Classify B002 using its surrounding blocks as context.",
      "criteria": {
        "heading": "Names the topic of the following content",
        "paragraph": "Ordinary prose content",
        "list_item": "One item in a list",
        "quote": "Quoted prose",
        "code": "Code or a command",
        "callout": "A note, warning, or tip set apart from prose",
        "unknown": "Insufficient layout context to determine the block type"
      }
    },
    "heading_level_B002": {
      "type": "choice",
      "instructions": "If B002 is a heading, identify its structural role; choose unknown if the context does not establish one.",
      "criteria": {
        "title": "Title of the whole document",
        "section": "A main section within the document",
        "subsection": "A section nested inside another section",
        "unknown": "The role is not established or the block is not a heading"
      }
    }
  }
}
```

## Consume the answers

After pass 1, apply a caller-defined boundary policy in code, using punctuation and source layout as well as the returned judgments. Preserve uncertain boundaries for inspection, then construct the blocks for pass 2.

Companion questions for heading level, list order, or callout kind can share this second call because they inspect the same blocks. Consume a companion answer only when the selected block type makes it relevant; it does not depend on reading another answer inside the call.

### Render and verify in code

```text
source lines + boundary judgments → blocks with provenance
blocks + type judgments → deterministic renderer → reconstructed Markdown
```

The renderer adds markup and approved whitespace changes while copying source wording. Escape syntax where necessary and retain original source slices; classify a code block without executing its contents. Check text preservation independently of the semantic judgments, and retain unresolved block types for review rather than silently inventing structure.

## Limitations

Evaluate sentence-ending and mid-sentence boundaries separately when selecting cutoffs; a threshold suitable for hard-wrapped prose can incorrectly join list items.

Batch only within Classify's question and evidence limits. Long documents need overlapping context at chunk boundaries and may require several requests per pass. Explicit source markers should not be overridden merely because a model prefers another interpretation.
