# Retrieval comparison

Context is serialized UTF-8 tool-result bytes, including follow-up source reads. Tokens are reported by the helper backend. Main-agent inference, host overhead, and monetary cost are not measured.

| Task | Strategy | Evidence spans | Target files | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --- | --: | --: | --: | --: | --: | --: |
| retry-policy / 1 | grep-read | 1/1 | 1 | 9430 | 0/0 | 0 | 0.008 |
| retry-policy / 1 | search-terms | 1/1 | 1 | 10992 | 3663/2 | 2 | 1.101 |
| retry-policy / 1 | search-all | 1/1 | 1 | 13550 | 17179/12 | 12 | 4.946 |
| request-deadline / 1 | grep-read | 1/1 | 1 | 8388 | 0/0 | 0 | 0.006 |
| request-deadline / 1 | search-terms | 0/1 | 1 | 18118 | 6077/3 | 3 | 1.326 |
| request-deadline / 1 | search-all | 0/1 | 1 | 13457 | 17155/12 | 12 | 4.231 |
| evidence-budget / 1 | grep-read | 1/1 | 1 | 19417 | 0/0 | 0 | 0.006 |
| evidence-budget / 1 | search-terms | 0/1 | 0 | 15097 | 9167/5 | 5 | 2.195 |
| evidence-budget / 1 | search-all | 0/1 | 0 | 15101 | 17143/12 | 12 | 3.756 |
| session-reset / 1 | grep-read | 1/1 | 1 | 8229 | 0/0 | 0 | 0.005 |
| session-reset / 1 | search-terms | 1/1 | 1 | 12732 | 6642/5 | 5 | 2.041 |
| session-reset / 1 | search-all | 1/1 | 1 | 12737 | 17179/12 | 12 | 3.831 |
| secret-rotation / 1 | grep-read | 0/1 | 0 | 1077 | 0/0 | 0 | 0.005 |
| secret-rotation / 1 | search-terms | 0/1 | 0 | 7116 | 2364/1 | 1 | 0.415 |
| secret-rotation / 1 | search-all | 1/1 | 1 | 13084 | 17131/12 | 12 | 4.757 |
| line-encoding / 1 | grep-read | 1/1 | 1 | 21206 | 0/0 | 0 | 0.006 |
| line-encoding / 1 | search-terms | 1/1 | 1 | 15913 | 14353/9 | 9 | 4.066 |
| line-encoding / 1 | search-all | 1/1 | 1 | 15916 | 17203/12 | 12 | 3.128 |
| cleanup-cancellation / 1 | grep-read | 1/1 | 1 | 1767 | 0/0 | 0 | 0.005 |
| cleanup-cancellation / 1 | search-terms | 1/1 | 1 | 2559 | 812/1 | 1 | 0.323 |
| cleanup-cancellation / 1 | search-all | 1/1 | 1 | 13660 | 17131/12 | 12 | 5.023 |
| absent-cache / 1 | grep-read | 0/0 | 0 | 29 | 0/0 | 0 | 0.005 |
| absent-cache / 1 | search-terms | 0/0 | 0 | 707 | 0/0 | 0 | 0.006 |
| absent-cache / 1 | search-all | 0/0 | 0 | 11417 | 17131/12 | 12 | 5.176 |
| retry-policy / 2 | search-all | 1/1 | 1 | 13550 | 17179/12 | 12 | 5.179 |
| retry-policy / 2 | search-terms | 1/1 | 1 | 10991 | 3663/2 | 2 | 0.399 |
| retry-policy / 2 | grep-read | 1/1 | 1 | 9430 | 0/0 | 0 | 0.006 |
| request-deadline / 2 | search-all | 0/1 | 1 | 13457 | 17155/12 | 12 | 5.247 |
| request-deadline / 2 | search-terms | 0/1 | 1 | 18118 | 6077/3 | 3 | 0.650 |
| request-deadline / 2 | grep-read | 1/1 | 1 | 8388 | 0/0 | 0 | 0.005 |
| evidence-budget / 2 | search-all | 0/1 | 0 | 15102 | 17143/12 | 12 | 5.262 |
| evidence-budget / 2 | search-terms | 0/1 | 0 | 15098 | 9167/5 | 5 | 1.114 |
| evidence-budget / 2 | grep-read | 1/1 | 1 | 19417 | 0/0 | 0 | 0.006 |
| session-reset / 2 | search-all | 1/1 | 1 | 12735 | 17179/12 | 12 | 5.317 |
| session-reset / 2 | search-terms | 1/1 | 1 | 12732 | 6642/5 | 5 | 1.017 |
| session-reset / 2 | grep-read | 1/1 | 1 | 8229 | 0/0 | 0 | 0.006 |
| secret-rotation / 2 | search-all | 1/1 | 1 | 16521 | 17131/12 | 12 | 5.260 |
| secret-rotation / 2 | search-terms | 0/1 | 0 | 7116 | 2364/1 | 1 | 0.181 |
| secret-rotation / 2 | grep-read | 0/1 | 0 | 1077 | 0/0 | 0 | 0.005 |
| line-encoding / 2 | search-all | 1/1 | 1 | 15916 | 17203/12 | 12 | 5.289 |
| line-encoding / 2 | search-terms | 1/1 | 1 | 15913 | 14353/9 | 9 | 1.994 |
| line-encoding / 2 | grep-read | 1/1 | 1 | 21206 | 0/0 | 0 | 0.006 |
| cleanup-cancellation / 2 | search-all | 1/1 | 1 | 13660 | 17131/12 | 12 | 5.171 |
| cleanup-cancellation / 2 | search-terms | 1/1 | 1 | 2559 | 812/1 | 1 | 0.161 |
| cleanup-cancellation / 2 | grep-read | 1/1 | 1 | 1767 | 0/0 | 0 | 0.005 |
| absent-cache / 2 | search-all | 0/0 | 0 | 11417 | 17131/12 | 12 | 5.198 |
| absent-cache / 2 | search-terms | 0/0 | 0 | 707 | 0/0 | 0 | 0.009 |
| absent-cache / 2 | grep-read | 0/0 | 0 | 29 | 0/0 | 0 | 0.005 |

## Totals

| Strategy | Evidence spans | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --: | --: | --: | --: | --: |
| grep-read | 12/14 | 139086 | 0/0 | 0 | 0.090 |
| search-terms | 8/14 | 166468 | 86156/52 | 52 | 16.996 |
| search-all | 10/14 | 221280 | 274504/192 | 192 | 76.772 |
