# Retrieval comparison

Main-context tokens use o200k_base on serialized discovery and follow-up reads; they estimate main-LLM input, not billed usage. Helper tokens are separate backend-reported diagnostics. Main-agent reasoning/output and host overhead are not measured.

| Task | Strategy | Evidence spans | Target files | Main input tokens | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --- | --: | --: | --: | --: | --: | --: | --: |
| fact-ack-before-delete / 1 | grep-ranked | 0/1 | 1 | 5744 | 23278 | 0/0 | 0 | 0.012 |
| poison-outbox-prefix / 1 | grep-ranked | 0/2 | 1 | 8938 | 34595 | 0/0 | 0 | 0.009 |
| conversation-serialization / 1 | grep-ranked | 0/2 | 1 | 9301 | 36654 | 0/0 | 0 | 0.010 |
| unknown-condition-logic / 1 | grep-ranked | 0/3 | 1 | 16273 | 66465 | 0/0 | 0 | 0.014 |
| mqtt-device-topic-validation / 1 | grep-ranked | 1/2 | 1 | 6195 | 22760 | 0/0 | 0 | 0.011 |
| exact-weather-temperature / 1 | grep-ranked | 2/3 | 1 | 3080 | 11353 | 0/0 | 0 | 0.008 |
| sqlite-connection-policy / 1 | grep-ranked | 1/1 | 1 | 6386 | 24390 | 0/0 | 0 | 0.008 |
| absent-postgres-notifications / 1 | grep-ranked | 0/0 | 0 | 15 | 50 | 0/0 | 0 | 0.006 |

## Totals

| Strategy | Evidence spans | Main input tokens | Context bytes | Helper input/output tokens | Attempts | Seconds |
| --- | --: | --: | --: | --: | --: | --: |
| grep-ranked | 4/14 | 55932 | 219545 | 0/0 | 0 | 0.078 |
