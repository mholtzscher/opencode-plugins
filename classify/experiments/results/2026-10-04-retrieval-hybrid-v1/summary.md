# Retrieval comparison

Context is serialized UTF-8 tool-result bytes, including follow-up source reads. Tokens are reported by the helper backend. Main-agent inference, host overhead, and monetary cost are not measured.

| Task | Strategy | Evidence spans | Target files | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --- | --: | --: | --: | --: | --: | --: |
| retry-policy / 1 | grep-read | 1/1 | 1 | 9430 | 0/0 | 0 | 0.008 |
| retry-policy / 1 | search-hybrid | 1/1 | 1 | 4855 | 4515/3 | 3 | 1.348 |
| request-deadline / 1 | grep-read | 1/1 | 1 | 8388 | 0/0 | 0 | 0.006 |
| request-deadline / 1 | search-hybrid | 1/1 | 1 | 5006 | 4617/3 | 3 | 1.512 |
| evidence-budget / 1 | grep-read | 1/1 | 1 | 19417 | 0/0 | 0 | 0.006 |
| evidence-budget / 1 | search-hybrid | 0/1 | 0 | 4854 | 4438/3 | 3 | 1.442 |
| session-reset / 1 | grep-read | 1/1 | 1 | 8229 | 0/0 | 0 | 0.006 |
| session-reset / 1 | search-hybrid | 1/1 | 1 | 5007 | 4090/3 | 3 | 1.335 |
| secret-rotation / 1 | grep-read | 0/1 | 0 | 1077 | 0/0 | 0 | 0.006 |
| secret-rotation / 1 | search-hybrid | 1/1 | 1 | 4325 | 20285/13 | 13 | 6.090 |
| line-encoding / 1 | grep-read | 1/1 | 1 | 21206 | 0/0 | 0 | 0.006 |
| line-encoding / 1 | search-hybrid | 1/1 | 1 | 4861 | 4474/3 | 3 | 1.371 |
| cleanup-cancellation / 1 | grep-read | 1/1 | 1 | 1767 | 0/0 | 0 | 0.006 |
| cleanup-cancellation / 1 | search-hybrid | 1/1 | 1 | 2568 | 3947/3 | 3 | 1.187 |
| absent-cache / 1 | grep-read | 0/0 | 0 | 29 | 0/0 | 0 | 0.005 |
| absent-cache / 1 | search-hybrid | 0/0 | 0 | 722 | 20306/13 | 13 | 5.294 |
| retry-policy / 2 | search-hybrid | 1/1 | 1 | 4862 | 4515/3 | 3 | 1.053 |
| retry-policy / 2 | grep-read | 1/1 | 1 | 9430 | 0/0 | 0 | 0.005 |
| request-deadline / 2 | search-hybrid | 1/1 | 1 | 5013 | 4617/3 | 3 | 1.114 |
| request-deadline / 2 | grep-read | 1/1 | 1 | 8388 | 0/0 | 0 | 0.005 |
| evidence-budget / 2 | search-hybrid | 0/1 | 0 | 4861 | 4438/3 | 3 | 1.141 |
| evidence-budget / 2 | grep-read | 1/1 | 1 | 19417 | 0/0 | 0 | 0.006 |
| session-reset / 2 | search-hybrid | 1/1 | 1 | 5006 | 4090/3 | 3 | 1.354 |
| session-reset / 2 | grep-read | 1/1 | 1 | 8229 | 0/0 | 0 | 0.005 |
| secret-rotation / 2 | search-hybrid | 1/1 | 1 | 4325 | 20285/13 | 13 | 6.428 |
| secret-rotation / 2 | grep-read | 0/1 | 0 | 1077 | 0/0 | 0 | 0.006 |
| line-encoding / 2 | search-hybrid | 1/1 | 1 | 4860 | 4474/3 | 3 | 1.163 |
| line-encoding / 2 | grep-read | 1/1 | 1 | 21206 | 0/0 | 0 | 0.006 |
| cleanup-cancellation / 2 | search-hybrid | 1/1 | 1 | 2567 | 3947/3 | 3 | 1.206 |
| cleanup-cancellation / 2 | grep-read | 1/1 | 1 | 1767 | 0/0 | 0 | 0.005 |
| absent-cache / 2 | search-hybrid | 0/0 | 0 | 722 | 20306/13 | 13 | 5.476 |
| absent-cache / 2 | grep-read | 0/0 | 0 | 29 | 0/0 | 0 | 0.005 |

## Totals

| Strategy | Evidence spans | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --: | --: | --: | --: | --: |
| grep-read | 12/14 | 139086 | 0/0 | 0 | 0.091 |
| search-hybrid | 12/14 | 64414 | 133344/88 | 88 | 38.513 |
