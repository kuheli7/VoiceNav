## Baseline (v1: model returns a numeric element id)

The two runs below used the first prompt design. Compare with the v2 runs after them.

## Run 2026-10-04 19:52 - 50 commands

### qwen2.5:3b - hybrid (resolver + LLM)

**Overall accuracy: 37/50 (74%)**  |  latency over all commands: p50 1.1s, p95 3.4s

| Answered by | Accuracy | Latency |
|---|---|---|
| resolver | 9/9 (100%) | p50 0.0s, p95 0.0s |
| llm | 28/41 (68%) | p50 1.2s, p95 3.4s |

| Page type | Accuracy |
|---|---|
| shop_results | 11/14 (79%) |
| product | 6/9 (67%) |
| video | 6/8 (75%) |
| login | 6/8 (75%) |
| news | 8/11 (73%) |

Misses:

- `sort the results` (shop_results): expected `{"action": "click", "id": 3}`, got `click` id=4 text=None
- `look for wireless earbuds` (shop_results): expected `{"action": "search", "text_contains": "earbuds"}`, got `type` id=None text='wireless earbuds'
- `take me to the previous page` (shop_results): expected `{"action": "back"}`, got `click` id=10 text=None
- `put it in my basket` (product): expected `{"action": "click", "id": 4}`, got `click` id=5 text=None
- `show me what other people think` (product): expected `{"action": "click", "id": 7}`, got `click` id=9 text=None
- `who is selling this` (product): expected `{"action": "click", "id": 8}`, got `click` id=9 text=None
- `subscribe to the channel` (video): expected `{"action": "click", "id": 4}`, got `click` id=5 text=None
- `play the next video` (video): expected `{"action": "click", "id": 7}`, got `click` id=12 text=None
- `enter my email` (login): expected `{"action": "click", "id": 1}`, got `type` id=None text='myemail@example.com'
- `log in` (login): expected `{"action": "click", "id": 4}`, got `type` id=None text='your_email@example.com'
- `read about the road repairs` (news): expected `{"action": "click", "id": 6}`, got `click` id=8 text=None
- `go to the technology section` (news): expected `{"action": "click", "id": 4}`, got `click` id=7 text=None
- `subscribe` (news): expected `{"action": "click", "id": 8}`, got `click` id=7 text=None


## Run 2026-10-04 19:53 - 50 commands

### qwen2.5:3b - LLM only

**Overall accuracy: 32/50 (64%)**  |  latency over all commands: p50 1.4s, p95 3.9s

| Answered by | Accuracy | Latency |
|---|---|---|
| llm | 32/50 (64%) | p50 1.4s, p95 3.9s |

| Page type | Accuracy |
|---|---|
| shop_results | 7/14 (50%) |
| product | 6/9 (67%) |
| video | 5/8 (62%) |
| login | 6/8 (75%) |
| news | 8/11 (73%) |

Misses:

- `open the cheapest headphones` (shop_results): expected `{"action": "click", "id": 4}`, got `click` id=7 text=None
- `click the most expensive one` (shop_results): expected `{"action": "click", "id": 5}`, got `click` id=6 text=None
- `open the third one` (shop_results): expected `{"action": "click", "id": 6}`, got `click` id=4 text=None
- `select the last one` (shop_results): expected `{"action": "click", "id": 7}`, got `click` id=8 text=None
- `pick the cheapest` (shop_results): expected `{"action": "click", "id": 4}`, got `click` id=10 text=None
- `look for wireless earbuds` (shop_results): expected `{"action": "search", "text_contains": "earbuds"}`, got `type` id=None text='wireless earbuds'
- `take me to the previous page` (shop_results): expected `{"action": "back"}`, got `click` id=10 text=None
- `put it in my basket` (product): expected `{"action": "click", "id": 4}`, got `click` id=5 text=None
- `show me what other people think` (product): expected `{"action": "click", "id": 7}`, got `click` id=9 text=None
- `who is selling this` (product): expected `{"action": "click", "id": 8}`, got `click` id=9 text=None
- `subscribe to the channel` (video): expected `{"action": "click", "id": 4}`, got `click` id=5 text=None
- `play the next video` (video): expected `{"action": "click", "id": 7}`, got `click` id=12 text=None
- `open the second video` (video): expected `{"action": "click", "id": 8}`, got `none` id=None text=None
- `enter my email` (login): expected `{"action": "click", "id": 1}`, got `type` id=None text='myemail@example.com'
- `log in` (login): expected `{"action": "click", "id": 4}`, got `type` id=None text='your_email@example.com'
- `read about the road repairs` (news): expected `{"action": "click", "id": 6}`, got `click` id=8 text=None
- `go to the technology section` (news): expected `{"action": "click", "id": 4}`, got `click` id=7 text=None
- `subscribe` (news): expected `{"action": "click", "id": 8}`, got `click` id=7 text=None


## v2 (model picks a label from a schema enum; text must be grounded in the command)

## Run 2026-10-04 19:55 - 50 commands

### qwen2.5:3b - hybrid (resolver + LLM)

**Overall accuracy: 45/50 (90%)**  |  latency over all commands: p50 1.3s, p95 3.5s

| Answered by | Accuracy | Latency |
|---|---|---|
| resolver | 9/9 (100%) | p50 0.0s, p95 0.0s |
| llm | 36/41 (88%) | p50 1.4s, p95 3.5s |

| Page type | Accuracy |
|---|---|
| shop_results | 14/14 (100%) |
| product | 7/9 (78%) |
| video | 8/8 (100%) |
| login | 6/8 (75%) |
| news | 10/11 (91%) |

Misses:

- `put it in my basket` (product): expected `{"action": "click", "id": 4}`, got `click` id=10 text=None
- `who is selling this` (product): expected `{"action": "click", "id": 8}`, got `click` id=7 text=None
- `enter my email` (login): expected `{"action": "click", "id": 1}`, got `none` id=None text=None
- `log in` (login): expected `{"action": "click", "id": 4}`, got `none` id=None text=None
- `read about the road repairs` (news): expected `{"action": "click", "id": 6}`, got `click` id=5 text=None


## Run 2026-10-04 19:56 - 50 commands

### qwen2.5:3b - LLM only

**Overall accuracy: 37/50 (74%)**  |  latency over all commands: p50 1.2s, p95 3.4s

| Answered by | Accuracy | Latency |
|---|---|---|
| llm | 37/50 (74%) | p50 1.2s, p95 3.4s |

| Page type | Accuracy |
|---|---|
| shop_results | 8/14 (57%) |
| product | 6/9 (67%) |
| video | 7/8 (88%) |
| login | 6/8 (75%) |
| news | 10/11 (91%) |

Misses:

- `open the cheapest headphones` (shop_results): expected `{"action": "click", "id": 4}`, got `click` id=11 text=None
- `click the most expensive one` (shop_results): expected `{"action": "click", "id": 5}`, got `click` id=6 text=None
- `open the second result` (shop_results): expected `{"action": "click", "id": 5}`, got `click` id=4 text=None
- `open the third one` (shop_results): expected `{"action": "click", "id": 6}`, got `click` id=7 text=None
- `select the last one` (shop_results): expected `{"action": "click", "id": 7}`, got `click` id=11 text=None
- `pick the cheapest` (shop_results): expected `{"action": "click", "id": 4}`, got `click` id=11 text=None
- `put it in my basket` (product): expected `{"action": "click", "id": 4}`, got `click` id=10 text=None
- `who is selling this` (product): expected `{"action": "click", "id": 8}`, got `click` id=7 text=None
- `open the cheapest one` (product): expected `{"action": "none"}`, got `click` id=4 text=None
- `open the second video` (video): expected `{"action": "click", "id": 8}`, got `click` id=7 text=None
- `enter my email` (login): expected `{"action": "click", "id": 1}`, got `none` id=None text=None
- `log in` (login): expected `{"action": "click", "id": 4}`, got `none` id=None text=None
- `read about the road repairs` (news): expected `{"action": "click", "id": 6}`, got `click` id=5 text=None



## v2.1 (prompt examples reworded so none overlap with test commands) + held-out set

## Run 2026-10-04 19:58 - 50 commands (cases.json)

### qwen2.5:3b - hybrid (resolver + LLM)

**Overall accuracy: 46/50 (92%)**  |  latency over all commands: p50 1.6s, p95 4.2s

| Answered by | Accuracy | Latency |
|---|---|---|
| resolver | 9/9 (100%) | p50 0.0s, p95 0.0s |
| llm | 37/41 (90%) | p50 1.9s, p95 4.2s |

| Page type | Accuracy |
|---|---|
| shop_results | 14/14 (100%) |
| product | 9/9 (100%) |
| video | 8/8 (100%) |
| login | 5/8 (62%) |
| news | 10/11 (91%) |

Misses:

- `enter my email` (login): expected `{"action": "click", "id": 1}`, got `type` id=None text='my email'
- `log in` (login): expected `{"action": "click", "id": 4}`, got `none` id=None text=None
- `what is the weather today` (login): expected `{"action": "none"}`, got `search` id=None text='what is the weather today'
- `read about the road repairs` (news): expected `{"action": "click", "id": 6}`, got `click` id=10 text=None


## Run 2026-10-04 20:00 - 50 commands (cases.json)

### qwen2.5:3b - LLM only

**Overall accuracy: 39/50 (78%)**  |  latency over all commands: p50 1.6s, p95 4.2s

| Answered by | Accuracy | Latency |
|---|---|---|
| llm | 39/50 (78%) | p50 1.6s, p95 4.2s |

| Page type | Accuracy |
|---|---|
| shop_results | 9/14 (64%) |
| product | 8/9 (89%) |
| video | 7/8 (88%) |
| login | 5/8 (62%) |
| news | 10/11 (91%) |

Misses:

- `open the cheapest headphones` (shop_results): expected `{"action": "click", "id": 4}`, got `click` id=11 text=None
- `click the most expensive one` (shop_results): expected `{"action": "click", "id": 5}`, got `click` id=6 text=None
- `open the second result` (shop_results): expected `{"action": "click", "id": 5}`, got `click` id=4 text=None
- `select the last one` (shop_results): expected `{"action": "click", "id": 7}`, got `click` id=11 text=None
- `pick the cheapest` (shop_results): expected `{"action": "click", "id": 4}`, got `click` id=11 text=None
- `open the cheapest one` (product): expected `{"action": "none"}`, got `click` id=4 text=None
- `open the second video` (video): expected `{"action": "click", "id": 8}`, got `click` id=7 text=None
- `enter my email` (login): expected `{"action": "click", "id": 1}`, got `type` id=None text='my email'
- `log in` (login): expected `{"action": "click", "id": 4}`, got `none` id=None text=None
- `what is the weather today` (login): expected `{"action": "none"}`, got `search` id=None text='what is the weather today'
- `read about the road repairs` (news): expected `{"action": "click", "id": 6}`, got `click` id=10 text=None


## Run 2026-10-04 20:02 - 28 commands (cases_heldout.json)

### qwen2.5:3b - hybrid (resolver + LLM)

**Overall accuracy: 23/28 (82%)**  |  latency over all commands: p50 1.2s, p95 3.6s

| Answered by | Accuracy | Latency |
|---|---|---|
| llm | 23/28 (82%) | p50 1.2s, p95 3.6s |

| Page type | Accuracy |
|---|---|
| shop_results | 8/8 (100%) |
| product | 3/4 (75%) |
| video | 5/7 (71%) |
| login | 4/5 (80%) |
| news | 3/4 (75%) |

Misses:

- `bookmark this` (product): expected `{"action": "click", "id": 6}`, got `click` id=10 text=None
- `let's watch the sleep tips video` (video): expected `{"action": "click", "id": 9}`, got `click` id=8 text=None
- `play some jazz` (video): expected `{"action": "none"}`, got `click` id=2 text=None
- `type in my password` (login): expected `{"action": "click", "id": 2}`, got `type` id=None text='my password'
- `open the budget article` (news): expected `{"action": "click", "id": 6}`, got `click` id=5 text=None


## Run 2026-10-04 20:02 - 28 commands (cases_heldout.json)

### qwen2.5:3b - LLM only

**Overall accuracy: 23/28 (82%)**  |  latency over all commands: p50 1.0s, p95 3.1s

| Answered by | Accuracy | Latency |
|---|---|---|
| llm | 23/28 (82%) | p50 1.0s, p95 3.1s |

| Page type | Accuracy |
|---|---|
| shop_results | 8/8 (100%) |
| product | 3/4 (75%) |
| video | 5/7 (71%) |
| login | 4/5 (80%) |
| news | 3/4 (75%) |

Misses:

- `bookmark this` (product): expected `{"action": "click", "id": 6}`, got `click` id=10 text=None
- `let's watch the sleep tips video` (video): expected `{"action": "click", "id": 9}`, got `click` id=8 text=None
- `play some jazz` (video): expected `{"action": "none"}`, got `click` id=2 text=None
- `type in my password` (login): expected `{"action": "click", "id": 2}`, got `type` id=None text='my password'
- `open the budget article` (news): expected `{"action": "click", "id": 6}`, got `click` id=5 text=None



## v3 (conversational phrasing, label-grounding guards) - re-run after this round of fixes

## Run 2026-10-05 01:14 - 50 commands (cases.json)

### qwen2.5:3b - hybrid (resolver + LLM)

**Overall accuracy: 47/50 (94%)**  |  latency over all commands: p50 1.0s, p95 2.5s

| Answered by | Accuracy | Latency |
|---|---|---|
| resolver | 9/9 (100%) | p50 0.0s, p95 0.0s |
| llm | 38/41 (93%) | p50 1.0s, p95 2.5s |

| Page type | Accuracy |
|---|---|
| shop_results | 14/14 (100%) |
| product | 9/9 (100%) |
| video | 8/8 (100%) |
| login | 5/8 (62%) |
| news | 11/11 (100%) |

Misses:

- `enter my email` (login): expected `{"action": "click", "id": 1}`, got `type` id=None text='my email'
- `log in` (login): expected `{"action": "click", "id": 4}`, got `none` id=None text=None
- `what is the weather today` (login): expected `{"action": "none"}`, got `search` id=None text='what is the weather today'


## Run 2026-10-05 01:15 - 28 commands (cases_heldout.json)

### qwen2.5:3b - hybrid (resolver + LLM)

**Overall accuracy: 23/28 (82%)**  |  latency over all commands: p50 1.0s, p95 2.8s

| Answered by | Accuracy | Latency |
|---|---|---|
| llm | 23/28 (82%) | p50 1.0s, p95 2.8s |

| Page type | Accuracy |
|---|---|
| shop_results | 8/8 (100%) |
| product | 3/4 (75%) |
| video | 5/7 (71%) |
| login | 4/5 (80%) |
| news | 3/4 (75%) |

Misses:

- `bookmark this` (product): expected `{"action": "click", "id": 6}`, got `click` id=10 text=None
- `turn on subscription` (video): expected `{"action": "click", "id": 4}`, got `none` id=None text=None
- `play some jazz` (video): expected `{"action": "none"}`, got `click` id=2 text=None
- `type in my password` (login): expected `{"action": "click", "id": 2}`, got `type` id=None text='my password'
- `open the budget article` (news): expected `{"action": "click", "id": 6}`, got `click` id=5 text=None



## v3.1 (after an independent review: consent/negation, grocery ADD buttons, names containing position words)

## Run 2026-10-05 01:33 - 50 commands (cases.json)

### qwen2.5:3b - hybrid (resolver + LLM)

**Overall accuracy: 47/50 (94%)**  |  latency over all commands: p50 0.9s, p95 2.4s

| Answered by | Accuracy | Latency |
|---|---|---|
| resolver | 9/9 (100%) | p50 0.0s, p95 0.0s |
| llm | 38/41 (93%) | p50 1.0s, p95 2.4s |

| Page type | Accuracy |
|---|---|
| shop_results | 14/14 (100%) |
| product | 9/9 (100%) |
| video | 8/8 (100%) |
| login | 5/8 (62%) |
| news | 11/11 (100%) |

Misses:

- `enter my email` (login): expected `{"action": "click", "id": 1}`, got `type` id=None text='my email'
- `log in` (login): expected `{"action": "click", "id": 4}`, got `none` id=None text=None
- `what is the weather today` (login): expected `{"action": "none"}`, got `search` id=None text='what is the weather today'


## Run 2026-10-05 01:34 - 28 commands (cases_heldout.json)

### qwen2.5:3b - hybrid (resolver + LLM)

**Overall accuracy: 23/28 (82%)**  |  latency over all commands: p50 1.0s, p95 3.2s

| Answered by | Accuracy | Latency |
|---|---|---|
| llm | 23/28 (82%) | p50 1.0s, p95 3.2s |

| Page type | Accuracy |
|---|---|
| shop_results | 8/8 (100%) |
| product | 3/4 (75%) |
| video | 5/7 (71%) |
| login | 4/5 (80%) |
| news | 3/4 (75%) |

Misses:

- `bookmark this` (product): expected `{"action": "click", "id": 6}`, got `click` id=10 text=None
- `turn on subscription` (video): expected `{"action": "click", "id": 4}`, got `none` id=None text=None
- `play some jazz` (video): expected `{"action": "none"}`, got `click` id=2 text=None
- `type in my password` (login): expected `{"action": "click", "id": 2}`, got `type` id=None text='my password'
- `open the budget article` (news): expected `{"action": "click", "id": 6}`, got `click` id=5 text=None


## Run 2026-10-05 01:34 - 50 commands (cases.json)

### qwen2.5:3b - LLM only

**Overall accuracy: 41/50 (82%)**  |  latency over all commands: p50 1.1s, p95 2.5s

| Answered by | Accuracy | Latency |
|---|---|---|
| llm | 41/50 (82%) | p50 1.1s, p95 2.5s |

| Page type | Accuracy |
|---|---|
| shop_results | 9/14 (64%) |
| product | 9/9 (100%) |
| video | 7/8 (88%) |
| login | 5/8 (62%) |
| news | 11/11 (100%) |

Misses:

- `open the cheapest headphones` (shop_results): expected `{"action": "click", "id": 4}`, got `click` id=11 text=None
- `click the most expensive one` (shop_results): expected `{"action": "click", "id": 5}`, got `click` id=6 text=None
- `open the second result` (shop_results): expected `{"action": "click", "id": 5}`, got `click` id=4 text=None
- `select the last one` (shop_results): expected `{"action": "click", "id": 7}`, got `click` id=11 text=None
- `pick the cheapest` (shop_results): expected `{"action": "click", "id": 4}`, got `click` id=11 text=None
- `open the second video` (video): expected `{"action": "click", "id": 8}`, got `click` id=7 text=None
- `enter my email` (login): expected `{"action": "click", "id": 1}`, got `type` id=None text='my email'
- `log in` (login): expected `{"action": "click", "id": 4}`, got `none` id=None text=None
- `what is the weather today` (login): expected `{"action": "none"}`, got `search` id=None text='what is the weather today'


## Run 2026-10-05 02:43 - 50 commands (cases.json)

### qwen2.5:3b - hybrid (resolver + LLM)

**Overall accuracy: 47/50 (94%)**  |  latency over all commands: p50 1.2s, p95 3.5s

| Answered by | Accuracy | Latency |
|---|---|---|
| resolver | 9/9 (100%) | p50 0.0s, p95 0.0s |
| llm | 38/41 (93%) | p50 1.3s, p95 3.5s |

| Page type | Accuracy |
|---|---|
| shop_results | 14/14 (100%) |
| product | 9/9 (100%) |
| video | 8/8 (100%) |
| login | 5/8 (62%) |
| news | 11/11 (100%) |

Misses:

- `enter my email` (login): expected `{"action": "click", "id": 1}`, got `type` id=None text='my email'
- `log in` (login): expected `{"action": "click", "id": 4}`, got `none` id=None text=None
- `what is the weather today` (login): expected `{"action": "none"}`, got `search` id=None text='what is the weather today'


## Run 2026-10-05 02:44 - 28 commands (cases_heldout.json)

### qwen2.5:3b - hybrid (resolver + LLM)

**Overall accuracy: 23/28 (82%)**  |  latency over all commands: p50 1.1s, p95 3.2s

| Answered by | Accuracy | Latency |
|---|---|---|
| llm | 23/28 (82%) | p50 1.1s, p95 3.2s |

| Page type | Accuracy |
|---|---|
| shop_results | 8/8 (100%) |
| product | 3/4 (75%) |
| video | 5/7 (71%) |
| login | 4/5 (80%) |
| news | 3/4 (75%) |

Misses:

- `bookmark this` (product): expected `{"action": "click", "id": 6}`, got `click` id=10 text=None
- `turn on subscription` (video): expected `{"action": "click", "id": 4}`, got `none` id=None text=None
- `play some jazz` (video): expected `{"action": "none"}`, got `click` id=2 text=None
- `type in my password` (login): expected `{"action": "click", "id": 2}`, got `type` id=None text='my password'
- `open the budget article` (news): expected `{"action": "click", "id": 6}`, got `click` id=5 text=None



## v4 (final run of this session: after the detector, Hindi, help and undo work)

## Run 2026-10-05 05:43 - 50 commands (cases.json)

### qwen2.5:3b - hybrid (resolver + LLM)

**Overall accuracy: 47/50 (94%)**  |  latency over all commands: p50 1.0s, p95 2.4s

| Answered by | Accuracy | Latency |
|---|---|---|
| resolver | 9/9 (100%) | p50 0.0s, p95 0.0s |
| llm | 38/41 (93%) | p50 1.0s, p95 2.4s |

| Page type | Accuracy |
|---|---|
| shop_results | 14/14 (100%) |
| product | 9/9 (100%) |
| video | 8/8 (100%) |
| login | 5/8 (62%) |
| news | 11/11 (100%) |

Misses:

- `enter my email` (login): expected `{"action": "click", "id": 1}`, got `type` id=None text='my email'
- `log in` (login): expected `{"action": "click", "id": 4}`, got `none` id=None text=None
- `what is the weather today` (login): expected `{"action": "none"}`, got `search` id=None text='what is the weather today'


## Run 2026-10-05 05:44 - 28 commands (cases_heldout.json)

### qwen2.5:3b - hybrid (resolver + LLM)

**Overall accuracy: 23/28 (82%)**  |  latency over all commands: p50 1.1s, p95 3.3s

| Answered by | Accuracy | Latency |
|---|---|---|
| llm | 23/28 (82%) | p50 1.1s, p95 3.3s |

| Page type | Accuracy |
|---|---|
| shop_results | 8/8 (100%) |
| product | 3/4 (75%) |
| video | 5/7 (71%) |
| login | 4/5 (80%) |
| news | 3/4 (75%) |

Misses:

- `bookmark this` (product): expected `{"action": "click", "id": 6}`, got `click` id=10 text=None
- `turn on subscription` (video): expected `{"action": "click", "id": 4}`, got `none` id=None text=None
- `play some jazz` (video): expected `{"action": "none"}`, got `click` id=2 text=None
- `type in my password` (login): expected `{"action": "click", "id": 2}`, got `type` id=None text='my password'
- `open the budget article` (news): expected `{"action": "click", "id": 6}`, got `click` id=5 text=None


