# Retrieval comparison

Context is serialized UTF-8 tool-result bytes, including follow-up source reads. Tokens are reported by the helper backend. Main-agent inference, host overhead, and monetary cost are not measured.

| Task | Strategy | Evidence spans | Target files | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --- | --: | --: | --: | --: | --: | --: |
| retry-policy / 1 | grep-read | 1/1 | 1 | 9430 | 0/0 | 0 | 0.017 |
| retry-policy / 1 | search-terms | 1/1 | 1 | 12990 | 4311/2 | 2 | 1.378 |
| retry-policy / 1 | search-all | 1/1 | 1 | 15547 | 18867/12 | 12 | 6.151 |
| request-deadline / 1 | grep-read | 1/1 | 1 | 8388 | 0/0 | 0 | 0.024 |
| request-deadline / 1 | search-terms | 1/1 | 1 | 23830 | 7747/3 | 3 | 1.715 |
| request-deadline / 1 | search-all | 1/1 | 1 | 15453 | 18843/12 | 12 | 5.429 |
| evidence-budget / 1 | grep-read | 1/1 | 1 | 19417 | 0/0 | 0 | 0.017 |
| evidence-budget / 1 | search-terms | 1/1 | 1 | 24420 | 10841/5 | 5 | 2.771 |
| evidence-budget / 1 | search-all | 1/1 | 1 | 24423 | 18831/12 | 12 | 4.426 |
| session-reset / 1 | grep-read | 1/1 | 1 | 8229 | 0/0 | 0 | 0.006 |
| session-reset / 1 | search-terms | 1/1 | 1 | 12733 | 6652/5 | 5 | 2.057 |
| session-reset / 1 | search-all | 1/1 | 1 | 12737 | 18867/12 | 12 | 3.966 |
| secret-rotation / 1 | grep-read | 0/1 | 0 | 1077 | 0/0 | 0 | 0.006 |
| secret-rotation / 1 | search-terms | 0/1 | 0 | 9113 | 3010/1 | 1 | 0.445 |
| secret-rotation / 1 | search-all | 1/1 | 1 | 20237 | 18819/12 | 12 | 4.904 |
| line-encoding / 1 | grep-read | 1/1 | 1 | 21206 | 0/0 | 0 | 0.006 |
| line-encoding / 1 | search-terms | 1/1 | 1 | 19627 | 16035/9 | 9 | 4.244 |
| line-encoding / 1 | search-all | 1/1 | 1 | 19631 | 18891/12 | 12 | 3.276 |
| cleanup-cancellation / 1 | grep-read | 1/1 | 1 | 1767 | 0/0 | 0 | 0.005 |
| cleanup-cancellation / 1 | search-terms | 1/1 | 1 | 2559 | 814/1 | 1 | 0.330 |
| cleanup-cancellation / 1 | search-all | 1/1 | 1 | 17375 | 18819/12 | 12 | 5.207 |
| absent-cache / 1 | grep-read | 0/0 | 0 | 29 | 0/0 | 0 | 0.005 |
| absent-cache / 1 | search-terms | 0/0 | 0 | 707 | 0/0 | 0 | 0.006 |
| absent-cache / 1 | search-all | 0/0 | 0 | 11417 | 18819/12 | 12 | 5.341 |
| retry-policy / 2 | search-all | 1/1 | 1 | 15547 | 18867/12 | 12 | 5.366 |
| retry-policy / 2 | search-terms | 1/1 | 1 | 12989 | 4311/2 | 2 | 0.424 |
| retry-policy / 2 | grep-read | 1/1 | 1 | 9430 | 0/0 | 0 | 0.006 |
| request-deadline / 2 | search-all | 1/1 | 1 | 15454 | 18843/12 | 12 | 5.442 |
| request-deadline / 2 | search-terms | 1/1 | 1 | 23830 | 7747/3 | 3 | 0.732 |
| request-deadline / 2 | grep-read | 1/1 | 1 | 8388 | 0/0 | 0 | 0.005 |
| evidence-budget / 2 | search-all | 1/1 | 1 | 24423 | 18831/12 | 12 | 5.402 |
| evidence-budget / 2 | search-terms | 1/1 | 1 | 24420 | 10841/5 | 5 | 1.187 |
| evidence-budget / 2 | grep-read | 1/1 | 1 | 19417 | 0/0 | 0 | 0.006 |
| session-reset / 2 | search-all | 1/1 | 1 | 12736 | 18867/12 | 12 | 5.448 |
| session-reset / 2 | search-terms | 1/1 | 1 | 12732 | 6652/5 | 5 | 1.050 |
| session-reset / 2 | grep-read | 1/1 | 1 | 8229 | 0/0 | 0 | 0.005 |
| secret-rotation / 2 | search-all | 1/1 | 1 | 20237 | 18819/12 | 12 | 5.411 |
| secret-rotation / 2 | search-terms | 0/1 | 0 | 9114 | 3010/1 | 1 | 0.193 |
| secret-rotation / 2 | grep-read | 0/1 | 0 | 1077 | 0/0 | 0 | 0.005 |
| line-encoding / 2 | search-all | 1/1 | 1 | 19631 | 18891/12 | 12 | 5.455 |
| line-encoding / 2 | search-terms | 1/1 | 1 | 19628 | 16035/9 | 9 | 2.163 |
| line-encoding / 2 | grep-read | 1/1 | 1 | 21206 | 0/0 | 0 | 0.006 |
| cleanup-cancellation / 2 | search-all | 1/1 | 1 | 17376 | 18819/12 | 12 | 5.364 |
| cleanup-cancellation / 2 | search-terms | 1/1 | 1 | 2559 | 814/1 | 1 | 0.158 |
| cleanup-cancellation / 2 | grep-read | 1/1 | 1 | 1767 | 0/0 | 0 | 0.006 |
| absent-cache / 2 | search-all | 0/0 | 0 | 11417 | 18819/12 | 12 | 5.323 |
| absent-cache / 2 | search-terms | 0/0 | 0 | 707 | 0/0 | 0 | 0.006 |
| absent-cache / 2 | grep-read | 0/0 | 0 | 29 | 0/0 | 0 | 0.005 |

## Totals

| Strategy | Evidence spans | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --: | --: | --: | --: | --: |
| grep-read | 12/14 | 139086 | 0/0 | 0 | 0.129 |
| search-terms | 12/14 | 211958 | 98820/52 | 52 | 18.859 |
| search-all | 14/14 | 273641 | 301512/192 | 192 | 81.911 |
