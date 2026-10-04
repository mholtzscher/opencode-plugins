# Retrieval comparison

Context is serialized UTF-8 tool-result bytes, including follow-up source reads. Tokens are reported by the helper backend. Main-agent inference, host overhead, and monetary cost are not measured.

| Task | Strategy | Evidence spans | Target files | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --- | --: | --: | --: | --: | --: | --: |
| retry-policy / 1 | search-batch | 1/1 | 1 | 15169 | 53925/16 | 4 | 6.211 |
| request-deadline / 1 | search-batch | 1/1 | 1 | 15169 | 53901/16 | 4 | 3.580 |
| evidence-budget / 1 | search-batch | 1/1 | 1 | 17991 | 53889/16 | 4 | 3.603 |
| session-reset / 1 | search-batch | 1/1 | 1 | 5083 | 53925/16 | 4 | 3.591 |
| secret-rotation / 1 | search-batch | 1/1 | 1 | 6882 | 53877/16 | 4 | 3.622 |
| line-encoding / 1 | search-batch | 1/1 | 1 | 21000 | 53949/16 | 4 | 3.733 |
| cleanup-cancellation / 1 | search-batch | 1/1 | 1 | 9234 | 53877/16 | 4 | 3.715 |
| absent-cache / 1 | search-batch | 0/0 | 0 | 715 | 53877/16 | 4 | 3.728 |
| retry-policy / 2 | search-batch | 1/1 | 1 | 15176 | 53925/16 | 4 | 3.763 |
| request-deadline / 2 | search-batch | 1/1 | 1 | 15176 | 53901/16 | 4 | 3.739 |
| evidence-budget / 2 | search-batch | 1/1 | 1 | 17991 | 53889/16 | 4 | 3.727 |
| session-reset / 2 | search-batch | 1/1 | 1 | 5084 | 53925/16 | 4 | 3.767 |
| secret-rotation / 2 | search-batch | 1/1 | 1 | 6885 | 53877/16 | 4 | 3.756 |
| line-encoding / 2 | search-batch | 1/1 | 1 | 20999 | 53949/16 | 4 | 3.754 |
| cleanup-cancellation / 2 | search-batch | 1/1 | 1 | 9228 | 53877/16 | 4 | 3.752 |
| absent-cache / 2 | search-batch | 0/0 | 0 | 721 | 53877/16 | 4 | 3.741 |

## Totals

| Strategy | Evidence spans | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --: | --: | --: | --: | --: |
| search-batch | 14/14 | 182503 | 862440/256 | 64 | 61.780 |
