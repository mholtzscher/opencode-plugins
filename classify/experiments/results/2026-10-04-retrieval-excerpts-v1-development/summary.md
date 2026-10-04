# Retrieval comparison

Main-context tokens use o200k_base on serialized discovery and follow-up reads; they estimate main-LLM input, not billed usage. Helper tokens are separate backend-reported diagnostics. Main-agent reasoning/output and host overhead are not measured.

| Task | Strategy | Evidence spans | Target files | Main input tokens | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --- | --: | --: | --: | --: | --: | --: | --: |
| retry-policy / 1 | grep-read | 1/1 | 1 | 2543 | 9430 | 0/0 | 0 | 0.007 |
| retry-policy / 1 | search-hybrid | 1/1 | 1 | 1306 | 4862 | 4506/3 | 3 | 1.439 |
| retry-policy / 1 | search-excerpts | 1/1 | 1 | 2497 | 9122 | 25367/18 | 18 | 8.260 |
| request-deadline / 1 | grep-read | 1/1 | 1 | 2276 | 8388 | 0/0 | 0 | 0.006 |
| request-deadline / 1 | search-hybrid | 1/1 | 1 | 1321 | 4901 | 4309/3 | 3 | 1.434 |
| request-deadline / 1 | search-excerpts | 1/1 | 1 | 1121 | 4175 | 25331/18 | 18 | 7.735 |
| evidence-budget / 1 | grep-read | 1/1 | 1 | 5206 | 19417 | 0/0 | 0 | 0.006 |
| evidence-budget / 1 | search-hybrid | 1/1 | 1 | 1169 | 4802 | 4392/3 | 3 | 1.377 |
| evidence-budget / 1 | search-excerpts | 1/1 | 1 | 3311 | 12948 | 29259/22 | 22 | 9.192 |
| session-reset / 1 | grep-read | 1/1 | 1 | 2115 | 8229 | 0/0 | 0 | 0.006 |
| session-reset / 1 | search-hybrid | 1/1 | 1 | 1270 | 4977 | 4164/3 | 3 | 1.389 |
| session-reset / 1 | search-excerpts | 1/1 | 1 | 918 | 3549 | 21681/15 | 15 | 5.994 |
| secret-rotation / 1 | grep-read | 0/1 | 0 | 303 | 1077 | 0/0 | 0 | 0.006 |
| secret-rotation / 1 | search-hybrid | 1/1 | 1 | 1183 | 4331 | 20337/13 | 13 | 5.889 |
| secret-rotation / 1 | search-excerpts | 1/1 | 1 | 1181 | 4325 | 20918/14 | 14 | 3.156 |
| line-encoding / 1 | grep-read | 1/1 | 1 | 5689 | 21206 | 0/0 | 0 | 0.007 |
| line-encoding / 1 | search-hybrid | 1/1 | 1 | 1398 | 4853 | 4483/3 | 3 | 1.433 |
| line-encoding / 1 | search-excerpts | 1/1 | 1 | 1468 | 5091 | 22152/15 | 15 | 6.290 |
| cleanup-cancellation / 1 | grep-read | 1/1 | 1 | 462 | 1767 | 0/0 | 0 | 0.005 |
| cleanup-cancellation / 1 | search-hybrid | 1/1 | 1 | 696 | 2567 | 4104/3 | 3 | 1.301 |
| cleanup-cancellation / 1 | search-excerpts | 1/1 | 1 | 696 | 2570 | 18867/12 | 12 | 5.647 |
| absent-cache / 1 | grep-read | 0/0 | 0 | 11 | 29 | 0/0 | 0 | 0.005 |
| absent-cache / 1 | search-hybrid | 0/0 | 0 | 206 | 722 | 20337/13 | 13 | 6.066 |
| absent-cache / 1 | search-excerpts | 0/0 | 0 | 206 | 722 | 18867/12 | 12 | 3.311 |
| retry-policy / 2 | search-excerpts | 1/1 | 1 | 2497 | 9122 | 25367/18 | 18 | 8.006 |
| retry-policy / 2 | search-hybrid | 1/1 | 1 | 1305 | 4861 | 4506/3 | 3 | 0.872 |
| retry-policy / 2 | grep-read | 1/1 | 1 | 2543 | 9430 | 0/0 | 0 | 0.013 |
| request-deadline / 2 | search-excerpts | 1/1 | 1 | 1121 | 4175 | 25331/18 | 18 | 8.293 |
| request-deadline / 2 | search-hybrid | 1/1 | 1 | 1320 | 4900 | 4309/3 | 3 | 0.640 |
| request-deadline / 2 | grep-read | 1/1 | 1 | 2276 | 8388 | 0/0 | 0 | 0.006 |
| evidence-budget / 2 | search-excerpts | 1/1 | 1 | 3311 | 12948 | 29259/22 | 22 | 8.347 |
| evidence-budget / 2 | search-hybrid | 1/1 | 1 | 1171 | 4808 | 4392/3 | 3 | 0.855 |
| evidence-budget / 2 | grep-read | 1/1 | 1 | 5206 | 19417 | 0/0 | 0 | 0.006 |
| session-reset / 2 | search-excerpts | 1/1 | 1 | 920 | 3555 | 21681/15 | 15 | 6.466 |
| session-reset / 2 | search-hybrid | 1/1 | 1 | 1269 | 4976 | 4164/3 | 3 | 0.628 |
| session-reset / 2 | grep-read | 1/1 | 1 | 2115 | 8229 | 0/0 | 0 | 0.005 |
| secret-rotation / 2 | search-excerpts | 1/1 | 1 | 1183 | 4331 | 20918/14 | 14 | 6.081 |
| secret-rotation / 2 | search-hybrid | 1/1 | 1 | 1184 | 4332 | 20337/13 | 13 | 3.990 |
| secret-rotation / 2 | grep-read | 0/1 | 0 | 303 | 1077 | 0/0 | 0 | 0.006 |
| line-encoding / 2 | search-excerpts | 1/1 | 1 | 1468 | 5091 | 22152/15 | 15 | 6.676 |
| line-encoding / 2 | search-hybrid | 1/1 | 1 | 1397 | 4852 | 4483/3 | 3 | 0.601 |
| line-encoding / 2 | grep-read | 1/1 | 1 | 5689 | 21206 | 0/0 | 0 | 0.006 |
| cleanup-cancellation / 2 | search-excerpts | 1/1 | 1 | 697 | 2571 | 18867/12 | 12 | 5.459 |
| cleanup-cancellation / 2 | search-hybrid | 1/1 | 1 | 697 | 2568 | 4104/3 | 3 | 1.050 |
| cleanup-cancellation / 2 | grep-read | 1/1 | 1 | 462 | 1767 | 0/0 | 0 | 0.006 |
| absent-cache / 2 | search-excerpts | 0/0 | 0 | 206 | 722 | 18867/12 | 12 | 5.802 |
| absent-cache / 2 | search-hybrid | 0/0 | 0 | 207 | 723 | 20337/13 | 13 | 2.968 |
| absent-cache / 2 | grep-read | 0/0 | 0 | 11 | 29 | 0/0 | 0 | 0.005 |

## Totals

| Strategy | Evidence spans | Main input tokens | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --: | --: | --: | --: | --: | --: |
| grep-read | 12/14 | 37210 | 139086 | 0/0 | 0 | 0.100 |
| search-hybrid | 14/14 | 17099 | 64035 | 133264/88 | 88 | 31.932 |
| search-excerpts | 14/14 | 22801 | 85017 | 364884/252 | 252 | 104.717 |
