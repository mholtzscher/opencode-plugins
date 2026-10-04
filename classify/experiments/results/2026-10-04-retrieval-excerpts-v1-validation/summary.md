# Retrieval comparison

Main-context tokens use o200k_base on serialized discovery and follow-up reads; they estimate main-LLM input, not billed usage. Helper tokens are separate backend-reported diagnostics. Main-agent reasoning/output and host overhead are not measured.

| Task | Strategy | Evidence spans | Target files | Main input tokens | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --- | --: | --: | --: | --: | --: | --: | --: |
| auth-versus-retry / 1 | grep-read | 2/2 | 1 | 1818 | 6785 | 0/0 | 0 | 0.007 |
| auth-versus-retry / 1 | search-hybrid | 1/2 | 1 | 1278 | 4491 | 3352/3 | 3 | 1.167 |
| auth-versus-retry / 1 | search-excerpts | 2/2 | 1 | 1982 | 7125 | 25385/18 | 18 | 8.067 |
| permission-file-swap / 1 | grep-read | 1/1 | 1 | 6756 | 25289 | 0/0 | 0 | 0.007 |
| permission-file-swap / 1 | search-hybrid | 1/1 | 1 | 1213 | 4893 | 3750/3 | 3 | 1.288 |
| permission-file-swap / 1 | search-excerpts | 1/1 | 1 | 1250 | 5090 | 26099/19 | 19 | 8.568 |
| invalid-stored-selection / 1 | grep-read | 1/2 | 2 | 6479 | 25241 | 0/0 | 0 | 0.006 |
| invalid-stored-selection / 1 | search-hybrid | 2/2 | 2 | 2221 | 8852 | 3679/3 | 3 | 1.384 |
| invalid-stored-selection / 1 | search-excerpts | 2/2 | 2 | 2616 | 10319 | 25660/19 | 19 | 8.084 |
| override-roundtrip / 1 | grep-read | 2/2 | 1 | 2002 | 7794 | 0/0 | 0 | 0.006 |
| override-roundtrip / 1 | search-hybrid | 2/2 | 1 | 1298 | 5084 | 18915/12 | 12 | 5.514 |
| override-roundtrip / 1 | search-excerpts | 2/2 | 1 | 921 | 3556 | 21681/15 | 15 | 4.014 |
| two-validation-boundaries / 1 | grep-read | 0/2 | 1 | 891 | 3408 | 0/0 | 0 | 0.005 |
| two-validation-boundaries / 1 | search-hybrid | 1/2 | 1 | 1953 | 7330 | 4106/3 | 3 | 1.388 |
| two-validation-boundaries / 1 | search-excerpts | 2/2 | 2 | 2052 | 7831 | 27153/20 | 20 | 8.652 |
| provider-truncation / 1 | grep-read | 1/1 | 1 | 747 | 2849 | 0/0 | 0 | 0.005 |
| provider-truncation / 1 | search-hybrid | 1/1 | 1 | 932 | 3508 | 4040/3 | 3 | 1.425 |
| provider-truncation / 1 | search-excerpts | 1/1 | 1 | 1591 | 5975 | 27073/20 | 20 | 9.139 |
| scan-and-binary-guards / 1 | grep-read | 1/2 | 1 | 1443 | 5340 | 0/0 | 0 | 0.006 |
| scan-and-binary-guards / 1 | search-hybrid | 2/2 | 1 | 1401 | 4860 | 4798/3 | 3 | 1.407 |
| scan-and-binary-guards / 1 | search-excerpts | 2/2 | 1 | 3610 | 13540 | 29237/22 | 22 | 10.340 |
| absent-vector-index / 1 | grep-read | 0/0 | 0 | 11 | 29 | 0/0 | 0 | 0.006 |
| absent-vector-index / 1 | search-hybrid | 0/0 | 0 | 206 | 722 | 22017/14 | 14 | 7.204 |
| absent-vector-index / 1 | search-excerpts | 0/0 | 0 | 207 | 723 | 18903/12 | 12 | 2.918 |
| auth-versus-retry / 2 | search-excerpts | 2/2 | 1 | 1980 | 7118 | 25385/18 | 18 | 8.568 |
| auth-versus-retry / 2 | search-hybrid | 1/2 | 1 | 1277 | 4490 | 3352/3 | 3 | 0.836 |
| auth-versus-retry / 2 | grep-read | 2/2 | 1 | 1818 | 6785 | 0/0 | 0 | 0.006 |
| permission-file-swap / 2 | search-excerpts | 1/1 | 1 | 1250 | 5090 | 26099/19 | 19 | 8.982 |
| permission-file-swap / 2 | search-hybrid | 1/1 | 1 | 1212 | 4892 | 3750/3 | 3 | 0.917 |
| permission-file-swap / 2 | grep-read | 1/1 | 1 | 6756 | 25289 | 0/0 | 0 | 0.007 |
| invalid-stored-selection / 2 | search-excerpts | 2/2 | 2 | 2616 | 10319 | 25660/19 | 19 | 8.265 |
| invalid-stored-selection / 2 | search-hybrid | 2/2 | 2 | 2221 | 8852 | 3679/3 | 3 | 1.161 |
| invalid-stored-selection / 2 | grep-read | 1/2 | 2 | 6479 | 25241 | 0/0 | 0 | 0.006 |
| override-roundtrip / 2 | search-excerpts | 2/2 | 1 | 920 | 3555 | 21681/15 | 15 | 6.660 |
| override-roundtrip / 2 | search-hybrid | 2/2 | 1 | 1299 | 5085 | 18915/12 | 12 | 3.106 |
| override-roundtrip / 2 | grep-read | 2/2 | 1 | 2002 | 7794 | 0/0 | 0 | 0.006 |
| two-validation-boundaries / 2 | search-excerpts | 2/2 | 2 | 2052 | 7831 | 27153/20 | 20 | 9.193 |
| two-validation-boundaries / 2 | search-hybrid | 1/2 | 1 | 1953 | 7330 | 4106/3 | 3 | 1.109 |
| two-validation-boundaries / 2 | grep-read | 0/2 | 1 | 891 | 3408 | 0/0 | 0 | 0.006 |
| provider-truncation / 2 | search-excerpts | 1/1 | 1 | 1591 | 5975 | 27073/20 | 20 | 9.446 |
| provider-truncation / 2 | search-hybrid | 1/1 | 1 | 932 | 3508 | 4040/3 | 3 | 1.129 |
| provider-truncation / 2 | grep-read | 1/1 | 1 | 747 | 2849 | 0/0 | 0 | 0.005 |
| scan-and-binary-guards / 2 | search-excerpts | 2/2 | 1 | 3611 | 13540 | 29237/22 | 22 | 9.696 |
| scan-and-binary-guards / 2 | search-hybrid | 2/2 | 1 | 1401 | 4860 | 4798/3 | 3 | 1.373 |
| scan-and-binary-guards / 2 | grep-read | 1/2 | 1 | 1443 | 5340 | 0/0 | 0 | 0.006 |
| absent-vector-index / 2 | search-excerpts | 0/0 | 0 | 206 | 722 | 18903/12 | 12 | 5.865 |
| absent-vector-index / 2 | search-hybrid | 0/0 | 0 | 206 | 722 | 22017/14 | 14 | 4.156 |
| absent-vector-index / 2 | grep-read | 0/0 | 0 | 11 | 29 | 0/0 | 0 | 0.005 |

## Totals

| Strategy | Evidence spans | Main input tokens | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --: | --: | --: | --: | --: | --: |
| grep-read | 16/24 | 40294 | 153470 | 0/0 | 0 | 0.096 |
| search-hybrid | 20/24 | 21003 | 79479 | 129314/88 | 88 | 34.564 |
| search-excerpts | 24/24 | 28455 | 108309 | 402382/290 | 290 | 126.457 |
