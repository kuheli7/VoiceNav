"""Measure accuracy and latency of the interpreter on eval/cases.json.

Run from the backend folder so the app package is importable:
    .venv\\Scripts\\python ..\\eval\\run_eval.py --models qwen2.5:3b
    .venv\\Scripts\\python ..\\eval\\run_eval.py --models qwen2.5:3b --no-resolver   # LLM-only ablation
"""
import argparse
import asyncio
import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "backend"))

from app.interpreter import interpret  # noqa: E402
from app.llm import OllamaClient  # noqa: E402
from app.schemas import Element, InterpretRequest  # noqa: E402


def matches(expect: dict, got) -> bool:
    if "any" in expect:
        return any(matches(e, got) for e in expect["any"])
    if got.action != expect["action"]:
        return False
    if "id" in expect and got.id != expect["id"]:
        return False
    if "direction" in expect and got.direction != expect["direction"]:
        return False
    if "text_contains" in expect and expect["text_contains"] not in (got.text or "").lower():
        return False
    return True


def percentile(values: list[float], p: float) -> float:
    return sorted(values)[min(len(values) - 1, int(len(values) * p))] if values else 0.0


async def run_model(model: str, data: dict, use_resolver: bool, limit: int | None) -> dict:
    client = OllamaClient(model=model, timeout=120.0)
    health = await client.health()
    if model not in health["models"]:
        raise SystemExit(f"Model {model!r} isn't pulled. Run: ollama pull {model}")

    pages = {
        name: [Element(id=e[0], role=e[1], label=e[2], price=e[3]) for e in page["elements"]]
        for name, page in data["pages"].items()
    }
    cases = data["cases"][:limit]

    # The first call loads the model (20s+ on CPU). Keep that out of the latency numbers.
    warm = InterpretRequest(command="scroll down", elements=pages["news"], title="warmup")
    await interpret(warm, client, use_resolver=False)

    rows = []
    for i, case in enumerate(cases, 1):
        req = InterpretRequest(command=case["command"], elements=pages[case["page"]], title=data["pages"][case["page"]]["title"])
        got = await interpret(req, client, use_resolver=use_resolver)
        ok = matches(case["expect"], got)
        rows.append({"case": case, "got": got.model_dump(), "ok": ok})
        print(f"[{i:2}/{len(cases)}] {'PASS' if ok else 'FAIL'} {got.source:8} {got.latency_ms:6}ms  {case['command']!r} -> {got.action} id={got.id}", flush=True)
    await client.aclose()
    return {"model": model, "use_resolver": use_resolver, "rows": rows}


def summarize(result: dict) -> str:
    rows = result["rows"]
    n, correct = len(rows), sum(r["ok"] for r in rows)
    by_source, by_page = defaultdict(list), defaultdict(list)
    for r in rows:
        by_source[r["got"]["source"]].append(r)
        by_page[r["case"]["page"]].append(r)

    def acc(rs): return f"{sum(r['ok'] for r in rs)}/{len(rs)} ({100 * sum(r['ok'] for r in rs) / len(rs):.0f}%)"
    def lat(rs):
        v = [r["got"]["latency_ms"] for r in rs]
        return f"p50 {statistics.median(v) / 1000:.1f}s, p95 {percentile(v, 0.95) / 1000:.1f}s" if v else "n/a"

    mode = "hybrid (resolver + LLM)" if result["use_resolver"] else "LLM only"
    out = [f"### {result['model']} - {mode}", "",
           f"**Overall accuracy: {acc(rows)}**  |  latency over all commands: {lat(rows)}", "",
           "| Answered by | Accuracy | Latency |", "|---|---|---|"]
    for src in ("resolver", "llm", "none"):
        if src in by_source:
            out.append(f"| {src} | {acc(by_source[src])} | {lat(by_source[src])} |")
    out += ["", "| Page type | Accuracy |", "|---|---|"]
    out += [f"| {p} | {acc(rs)} |" for p, rs in by_page.items()]
    failures = [r for r in rows if not r["ok"]]
    if failures:
        out += ["", "Misses:", ""]
        for r in failures:
            out.append(f"- `{r['case']['command']}` ({r['case']['page']}): expected `{json.dumps(r['case']['expect'])}`, "
                       f"got `{r['got']['action']}` id={r['got']['id']} text={r['got']['text']!r}")
    return "\n".join(out)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="qwen2.5:3b", help="comma-separated Ollama model names")
    ap.add_argument("--no-resolver", action="store_true", help="send everything to the LLM")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--cases", default="cases.json", help="cases.json (dev set) or cases_heldout.json")
    args = ap.parse_args()

    data = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))
    if args.cases != "cases.json":  # extra case files reuse the page definitions from cases.json
        data["cases"] = json.loads((HERE / args.cases).read_text(encoding="utf-8"))["cases"]
    report = [f"## Run {datetime.now():%Y-%m-%d %H:%M} - {len(data['cases'][:args.limit])} commands ({args.cases})", ""]
    for model in args.models.split(","):
        result = await run_model(model.strip(), data, not args.no_resolver, args.limit)
        report += [summarize(result), ""]
        (HERE / f"raw-{model.strip().replace(':', '_')}-{Path(args.cases).stem}-{'llm' if args.no_resolver else 'hybrid'}.json").write_text(
            json.dumps(result, indent=2), encoding="utf-8")

    text = "\n".join(report)
    print("\n" + text)
    with open(HERE / "results.md", "a", encoding="utf-8") as f:
        f.write(text + "\n\n")


asyncio.run(main())
