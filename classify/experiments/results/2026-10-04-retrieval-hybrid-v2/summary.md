# Retrieval comparison

Context is serialized UTF-8 tool-result bytes, including follow-up source reads. Tokens are reported by the helper backend. Main-agent inference, host overhead, and monetary cost are not measured.

| Task | Strategy | Evidence spans | Target files | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --- | --: | --: | --: | --: | --: | --: |
| retry-policy / 1 | grep-read | 1/1 | 1 | 9430 | 0/0 | 0 | 0.008 |
| retry-policy / 1 | search-hybrid | 1/1 | 1 | 4854 | 4500/3 | 3 | 1.418 |
| request-deadline / 1 | grep-read | 1/1 | 1 | 8388 | 0/0 | 0 | 0.006 |
| request-deadline / 1 | search-hybrid | 1/1 | 1 | 4901 | 4303/3 | 3 | 1.439 |
| evidence-budget / 1 | grep-read | 1/1 | 1 | 19417 | 0/0 | 0 | 0.007 |
| evidence-budget / 1 | search-hybrid | 1/1 | 1 | 4809 | 4386/3 | 3 | 1.416 |
| session-reset / 1 | grep-read | 1/1 | 1 | 8229 | 0/0 | 0 | 0.006 |
| session-reset / 1 | search-hybrid | 1/1 | 1 | 4977 | 4158/3 | 3 | 1.406 |
| secret-rotation / 1 | grep-read | 0/1 | 0 | 1077 | 0/0 | 0 | 0.005 |
| secret-rotation / 1 | search-hybrid | 1/1 | 1 | 4331 | 20311/13 | 13 | 6.022 |
| line-encoding / 1 | grep-read | 1/1 | 1 | 21206 | 0/0 | 0 | 0.006 |
| line-encoding / 1 | search-hybrid | 1/1 | 1 | 4854 | 4477/3 | 3 | 1.492 |
| cleanup-cancellation / 1 | grep-read | 1/1 | 1 | 1767 | 0/0 | 0 | 0.005 |
| cleanup-cancellation / 1 | search-hybrid | 1/1 | 1 | 2567 | 4098/3 | 3 | 1.283 |
| absent-cache / 1 | grep-read | 0/0 | 0 | 29 | 0/0 | 0 | 0.005 |
| absent-cache / 1 | search-hybrid | 0/0 | 0 | 722 | 20311/13 | 13 | 6.278 |
| retry-policy / 2 | search-hybrid | 1/1 | 1 | 4862 | 4500/3 | 3 | 1.138 |
| retry-policy / 2 | grep-read | 1/1 | 1 | 9430 | 0/0 | 0 | 0.005 |
| request-deadline / 2 | search-hybrid | 1/1 | 1 | 4900 | 4303/3 | 3 | 0.847 |
| request-deadline / 2 | grep-read | 1/1 | 1 | 8388 | 0/0 | 0 | 0.005 |
| evidence-budget / 2 | search-hybrid | 1/1 | 1 | 4808 | 4386/3 | 3 | 0.860 |
| evidence-budget / 2 | grep-read | 1/1 | 1 | 19417 | 0/0 | 0 | 0.006 |
| session-reset / 2 | search-hybrid | 1/1 | 1 | 4976 | 4158/3 | 3 | 1.106 |
| session-reset / 2 | grep-read | 1/1 | 1 | 8229 | 0/0 | 0 | 0.005 |
| secret-rotation / 2 | search-hybrid | 1/1 | 1 | 4331 | 20311/13 | 13 | 6.040 |
| secret-rotation / 2 | grep-read | 0/1 | 0 | 1077 | 0/0 | 0 | 0.005 |
| line-encoding / 2 | search-hybrid | 1/1 | 1 | 4853 | 4477/3 | 3 | 0.896 |
| line-encoding / 2 | grep-read | 1/1 | 1 | 21206 | 0/0 | 0 | 0.005 |
| cleanup-cancellation / 2 | search-hybrid | 1/1 | 1 | 2567 | 4098/3 | 3 | 1.300 |
| cleanup-cancellation / 2 | grep-read | 1/1 | 1 | 1767 | 0/0 | 0 | 0.005 |
| absent-cache / 2 | search-hybrid | 0/0 | 0 | 716 | 20311/13 | 13 | 5.971 |
| absent-cache / 2 | grep-read | 0/0 | 0 | 29 | 0/0 | 0 | 0.005 |

## Totals

| Strategy | Evidence spans | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --: | --: | --: | --: | --: |
| grep-read | 12/14 | 139086 | 0/0 | 0 | 0.089 |
| search-hybrid | 14/14 | 64028 | 133088/88 | 88 | 38.910 |
