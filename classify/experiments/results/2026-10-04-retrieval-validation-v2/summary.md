# Retrieval comparison

Context is serialized UTF-8 tool-result bytes, including follow-up source reads. Tokens are reported by the helper backend. Main-agent inference, host overhead, and monetary cost are not measured.

| Task | Strategy | Evidence spans | Target files | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --- | --: | --: | --: | --: | --: | --: |
| auth-versus-retry / 1 | grep-read | 2/2 | 1 | 6785 | 0/0 | 0 | 0.007 |
| auth-versus-retry / 1 | search-all | 2/2 | 1 | 15549 | 18867/12 | 12 | 5.407 |
| auth-versus-retry / 1 | search-hybrid | 1/2 | 1 | 4490 | 3337/3 | 3 | 0.831 |
| permission-file-swap / 1 | grep-read | 1/1 | 1 | 25289 | 0/0 | 0 | 0.007 |
| permission-file-swap / 1 | search-all | 1/1 | 1 | 19632 | 18843/12 | 12 | 5.780 |
| permission-file-swap / 1 | search-hybrid | 1/1 | 1 | 4894 | 3735/3 | 3 | 1.095 |
| invalid-stored-selection / 1 | grep-read | 1/2 | 2 | 25241 | 0/0 | 0 | 0.008 |
| invalid-stored-selection / 1 | search-all | 2/2 | 2 | 12735 | 18891/12 | 12 | 5.498 |
| invalid-stored-selection / 1 | search-hybrid | 2/2 | 2 | 8851 | 3664/3 | 3 | 0.841 |
| override-roundtrip / 1 | grep-read | 2/2 | 1 | 7794 | 0/0 | 0 | 0.006 |
| override-roundtrip / 1 | search-all | 2/2 | 1 | 13835 | 18855/12 | 12 | 5.466 |
| override-roundtrip / 1 | search-hybrid | 2/2 | 1 | 5084 | 18855/12 | 12 | 2.780 |
| two-validation-boundaries / 1 | grep-read | 0/2 | 1 | 3408 | 0/0 | 0 | 0.005 |
| two-validation-boundaries / 1 | search-all | 2/2 | 2 | 13596 | 18843/12 | 12 | 5.551 |
| two-validation-boundaries / 1 | search-hybrid | 1/2 | 1 | 11799 | 4091/3 | 3 | 1.080 |
| provider-truncation / 1 | grep-read | 1/1 | 1 | 2849 | 0/0 | 0 | 0.006 |
| provider-truncation / 1 | search-all | 1/1 | 1 | 13756 | 18795/12 | 12 | 5.547 |
| provider-truncation / 1 | search-hybrid | 1/1 | 1 | 3508 | 4025/3 | 3 | 1.113 |
| scan-and-binary-guards / 1 | grep-read | 1/2 | 1 | 5340 | 0/0 | 0 | 0.006 |
| scan-and-binary-guards / 1 | search-all | 2/2 | 1 | 19631 | 18807/12 | 12 | 5.545 |
| scan-and-binary-guards / 1 | search-hybrid | 2/2 | 1 | 4854 | 4783/3 | 3 | 1.326 |
| absent-vector-index / 1 | grep-read | 0/0 | 0 | 29 | 0/0 | 0 | 0.005 |
| absent-vector-index / 1 | search-all | 0/0 | 0 | 17989 | 18843/12 | 12 | 5.850 |
| absent-vector-index / 1 | search-hybrid | 0/0 | 0 | 722 | 21947/14 | 14 | 3.944 |
| auth-versus-retry / 2 | search-hybrid | 1/2 | 1 | 4491 | 3337/3 | 3 | 1.246 |
| auth-versus-retry / 2 | search-all | 2/2 | 1 | 15549 | 18867/12 | 12 | 5.431 |
| auth-versus-retry / 2 | grep-read | 2/2 | 1 | 6785 | 0/0 | 0 | 0.006 |
| permission-file-swap / 2 | search-hybrid | 1/1 | 1 | 4893 | 3735/3 | 3 | 0.981 |
| permission-file-swap / 2 | search-all | 1/1 | 1 | 19633 | 18843/12 | 12 | 5.299 |
| permission-file-swap / 2 | grep-read | 1/1 | 1 | 25289 | 0/0 | 0 | 0.007 |
| invalid-stored-selection / 2 | search-hybrid | 2/2 | 2 | 8852 | 3664/3 | 3 | 1.286 |
| invalid-stored-selection / 2 | search-all | 2/2 | 2 | 12735 | 18891/12 | 12 | 5.122 |
| invalid-stored-selection / 2 | grep-read | 1/2 | 2 | 25241 | 0/0 | 0 | 0.006 |
| override-roundtrip / 2 | search-hybrid | 2/2 | 1 | 5084 | 18855/12 | 12 | 5.436 |
| override-roundtrip / 2 | search-all | 2/2 | 1 | 13835 | 18855/12 | 12 | 2.930 |
| override-roundtrip / 2 | grep-read | 2/2 | 1 | 7794 | 0/0 | 0 | 0.005 |
| two-validation-boundaries / 2 | search-hybrid | 1/2 | 1 | 11799 | 4091/3 | 3 | 1.067 |
| two-validation-boundaries / 2 | search-all | 2/2 | 2 | 13596 | 18843/12 | 12 | 5.343 |
| two-validation-boundaries / 2 | grep-read | 0/2 | 1 | 3408 | 0/0 | 0 | 0.006 |
| provider-truncation / 2 | search-hybrid | 1/1 | 1 | 3507 | 4025/3 | 3 | 1.075 |
| provider-truncation / 2 | search-all | 1/1 | 1 | 13756 | 18795/12 | 12 | 5.289 |
| provider-truncation / 2 | grep-read | 1/1 | 1 | 2849 | 0/0 | 0 | 0.005 |
| scan-and-binary-guards / 2 | search-hybrid | 2/2 | 1 | 4860 | 4783/3 | 3 | 1.315 |
| scan-and-binary-guards / 2 | search-all | 2/2 | 1 | 19630 | 18807/12 | 12 | 5.965 |
| scan-and-binary-guards / 2 | grep-read | 1/2 | 1 | 5340 | 0/0 | 0 | 0.007 |
| absent-vector-index / 2 | search-hybrid | 0/0 | 0 | 723 | 21947/14 | 14 | 6.772 |
| absent-vector-index / 2 | search-all | 0/0 | 0 | 17989 | 18843/12 | 12 | 2.826 |
| absent-vector-index / 2 | grep-read | 0/0 | 0 | 29 | 0/0 | 0 | 0.005 |

## Totals

| Strategy | Evidence spans | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --: | --: | --: | --: | --: |
| grep-read | 16/24 | 153470 | 0/0 | 0 | 0.099 |
| search-all | 24/24 | 253446 | 301488/192 | 192 | 82.848 |
| search-hybrid | 20/24 | 88411 | 128874/88 | 88 | 32.189 |
