# Retrieval comparison

Main-context tokens use o200k_base on serialized discovery and follow-up reads; they estimate main-LLM input, not billed usage. Helper tokens are separate backend-reported diagnostics. Main-agent reasoning/output and host overhead are not measured.

| Task | Strategy | Evidence spans | Target files | Main input tokens | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --- | --: | --: | --: | --: | --: | --: | --: |
| fact-ack-before-delete / 1 | grep-read | 0/1 | 1 | 8066 | 32912 | 0/0 | 0 | 0.011 |
| fact-ack-before-delete / 1 | search-excerpts | 1/1 | 1 | 4771 | 18447 | 1040233/505 | 505 | 362.657 |
| poison-outbox-prefix / 1 | grep-read | 0/2 | 1 | 10117 | 39866 | 0/0 | 0 | 0.010 |
| poison-outbox-prefix / 1 | search-excerpts | 1/2 | 1 | 6597 | 26067 | 1058175/517 | 517 | 378.387 |
| conversation-serialization / 1 | grep-read | 0/2 | 1 | 9325 | 38149 | 0/0 | 0 | 0.010 |
| conversation-serialization / 1 | search-excerpts | 2/2 | 1 | 6035 | 22804 | 1055648/518 | 518 | 387.754 |
| unknown-condition-logic / 1 | grep-read | 0/3 | 0 | 10086 | 37696 | 0/0 | 0 | 0.015 |
| unknown-condition-logic / 1 | search-excerpts | 3/3 | 1 | 4545 | 19260 | 1044950/508 | 508 | 389.989 |
| mqtt-device-topic-validation / 1 | grep-read | 0/2 | 0 | 9816 | 39744 | 0/0 | 0 | 0.014 |
| mqtt-device-topic-validation / 1 | search-excerpts | 1/2 | 1 | 2923 | 10308 | 1043803/506 | 506 | 399.074 |
| exact-weather-temperature / 1 | grep-read | 2/3 | 1 | 3349 | 12380 | 0/0 | 0 | 0.009 |
| exact-weather-temperature / 1 | search-excerpts | 3/3 | 1 | 4668 | 16840 | 1043095/505 | 505 | 389.607 |
| sqlite-connection-policy / 1 | grep-read | 1/1 | 1 | 7632 | 29189 | 0/0 | 0 | 0.009 |
| sqlite-connection-policy / 1 | search-excerpts | 1/1 | 1 | 736 | 2521 | 1027311/493 | 493 | 390.428 |
| absent-postgres-notifications / 1 | grep-read | 0/0 | 0 | 11 | 29 | 0/0 | 0 | 0.008 |
| absent-postgres-notifications / 1 | search-excerpts | 0/0 | 0 | 209 | 736 | 1024846/493 | 493 | 385.467 |

## Totals

| Strategy | Evidence spans | Main input tokens | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --: | --: | --: | --: | --: | --: |
| grep-read | 3/14 | 58402 | 229965 | 0/0 | 0 | 0.085 |
| search-excerpts | 12/14 | 30484 | 116983 | 8338061/4045 | 4045 | 3083.362 |
