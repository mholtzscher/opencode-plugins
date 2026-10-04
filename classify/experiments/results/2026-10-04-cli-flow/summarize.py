"""Export completed CLI trials and retain model usage and readable tool traces."""

import json
import pathlib
import subprocess

root = pathlib.Path(__file__).parent
source_root = pathlib.Path("/tmp/opencode/classify-cli-grep-2026-10-04/hearth")


def classification_results(value):
    if isinstance(value, dict):
        if "ok" in value and ("result" in value or "error" in value):
            yield value
        else:
            for child in value.values():
                yield from classification_results(child)
    elif isinstance(value, list):
        for child in value:
            yield from classification_results(child)


rows = []
for trial in ["astra-classify-1", "astra-baseline-1", "astra-baseline-2", "astra-classify-2"]:
    events = [json.loads(line) for line in (root / f"{trial}.jsonl").read_text().splitlines() if line.strip()]
    session_ids = {event["sessionID"] for event in events if event.get("sessionID")}
    if len(session_ids) != 1:
        raise RuntimeError(f"Expected one session for {trial}: {session_ids}")
    session_id = session_ids.pop()
    exported = subprocess.check_output(["opencode", "session", "export", session_id], text=True)
    data = json.loads(exported)
    if data["info"].get("outcome") != "succeeded":
        raise RuntimeError(f"Incomplete session: {trial}")
    (root / f"{trial}-session.json").write_text(exported)
    tools = [event["part"] for event in events if event["type"] == "tool_use"]
    answers = [event["part"].get("text", "") for event in events if event["type"] == "text"]
    tokens = data["info"]["tokens"]
    times = data["info"]["time"]
    models = [message["model"] for message in data["messages"] if message.get("type") == "assistant"]
    judgments = []
    for tool in tools:
        state = tool["state"]
        if tool["tool"] != "execute" or "tools.classify.decide" not in state.get("input", {}).get("code", ""):
            continue
        try:
            judgments.extend(classification_results(json.loads(state.get("output", ""))))
        except json.JSONDecodeError:
            raise RuntimeError(f"Cannot account for helper output in {trial}")
    successful_judgments = [value["result"] for value in judgments if value["ok"]]
    row = {
        "trial": trial,
        "sessionID": session_id,
        "models": list({json.dumps(model, sort_keys=True) for model in models}),
        "tokens": tokens,
        "mainInputIncludingCached": tokens["input"] + tokens["cache"]["read"] + tokens["cache"]["write"],
        "toolCalls": len(tools),
        "readCalls": sum(tool["tool"] == "read" for tool in tools),
        "filesRead": sorted({tool["state"]["input"]["path"] for tool in tools if tool["tool"] == "read" and (source_root / tool["state"]["input"]["path"]).is_file()}),
        "directoryReadCalls": sum(tool["tool"] == "read" and (source_root / tool["state"]["input"]["path"]).is_dir() for tool in tools),
        "modelTurns": len(models),
        "elapsedSeconds": (times["idle"] - times["created"]) / 1000,
        "helperSuccesses": len(successful_judgments),
        "helperFailures": [value["error"] for value in judgments if not value["ok"]],
        "helperInputTokens": sum(value.get("usage", {}).get("input_tokens", 0) for value in successful_judgments),
    }
    rows.append(row)
    (root / f"{trial}-answer.md").write_text("\n\n".join(answers) + "\n")
    trace = []
    for tool in tools:
        state = tool["state"]
        trace.append({"tool": tool["tool"], "status": state["status"], "input": state.get("input"), "output": state.get("output"), "error": state.get("error")})
    (root / f"{trial}-tools.json").write_text(json.dumps(trace, indent=2) + "\n")
(root / "summary.json").write_text(json.dumps(rows, indent=2) + "\n")
print(json.dumps(rows, indent=2))
