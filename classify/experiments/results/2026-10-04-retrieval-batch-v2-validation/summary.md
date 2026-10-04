# Retrieval comparison

Context is serialized UTF-8 tool-result bytes, including follow-up source reads. Tokens are reported by the helper backend. Main-agent inference, host overhead, and monetary cost are not measured.

| Task | Strategy | Evidence spans | Target files | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --- | --: | --: | --: | --: | --: | --: |
| auth-versus-retry / 1 | search-batch | 2/2 | 1 | 10805 | 53973/16 | 4 | 6.296 |
| permission-file-swap / 1 | search-batch | 1/1 | 1 | 14209 | 53949/16 | 4 | 3.587 |
| invalid-stored-selection / 1 | search-batch | 2/2 | 2 | 12741 | 53997/16 | 4 | 3.686 |
| override-roundtrip / 1 | search-batch | 2/2 | 1 | 8866 | 53961/16 | 4 | 3.722 |
| two-validation-boundaries / 1 | search-batch | 1/2 | 1 | 16276 | 53949/16 | 4 | 3.728 |
| provider-truncation / 1 | search-batch | 1/1 | 1 | 7385 | 53901/16 | 4 | 3.721 |
| scan-and-binary-guards / 1 | search-batch | 2/2 | 1 | 19808 | 53913/16 | 4 | 3.697 |
| absent-vector-index / 1 | search-batch | 0/0 | 0 | 715 | 53949/16 | 4 | 3.696 |
| auth-versus-retry / 2 | search-batch | 2/2 | 1 | 10809 | 53973/16 | 4 | 3.733 |
| permission-file-swap / 2 | search-batch | 1/1 | 1 | 14208 | 53949/16 | 4 | 3.705 |
| invalid-stored-selection / 2 | search-batch | 2/2 | 2 | 12740 | 53997/16 | 4 | 3.736 |
| override-roundtrip / 2 | search-batch | 2/2 | 1 | 8865 | 53961/16 | 4 | 3.731 |
| two-validation-boundaries / 2 | search-batch | 1/2 | 1 | 16276 | 53949/16 | 4 | 3.733 |
| provider-truncation / 2 | search-batch | 1/1 | 1 | 7385 | 53901/16 | 4 | 3.721 |
| scan-and-binary-guards / 2 | search-batch | 2/2 | 1 | 19807 | 53913/16 | 4 | 3.685 |
| absent-vector-index / 2 | search-batch | 0/0 | 0 | 722 | 53949/16 | 4 | 3.968 |

## Totals

| Strategy | Evidence spans | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --: | --: | --: | --: | --: |
| search-batch | 22/24 | 181617 | 863184/256 | 64 | 62.145 |
