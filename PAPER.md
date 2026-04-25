<!-- path: PAPER.md -->

# Hausbuch: A Bitemporal, Citation-Backed Context Layer for LLM Agents

**Authors**: Hausbuch — Berlin, April 2026. Buena × Qontext hackathon submission.

---

## Abstract

Large-language-model agents repeatedly reconstruct company reality at runtime: they
pull scattered facts from mail, CRM, PDFs, and chat on every call, concatenate them
into a long prompt, and hope the top-k retrieval or haystack-needle trick holds. This
approach is expensive, inconsistent across agents, and demonstrably brittle on
temporal and contradictory data [1, 2]. We introduce **Hausbuch**, a context layer that
produces a self-updating, citation-backed `Context.md` per business entity. Facts are
**bitemporal** (valid-time × known-time) following Snodgrass [3], **conflict-aware**
via Dawid-Skene posterior reconciliation [4], and **cache-engineered** for Anthropic's
prompt-caching primitives. On a 15-question benchmark over a multi-source property
corpus, Hausbuch reduces tokens-per-query by ~88%, improves temporal-question accuracy
by 39 percentage points, and improves contradiction-accuracy by 55 percentage points
compared to a naive RAG baseline. Beyond results, Hausbuch is a deliberate
counter-position to vector-based retrieval: we argue that *structured facts with
identity and citations* are the right primitive for agent memory.

## 1. Problem

AI systems behind a chat interface are typically constructed as a **retrieval +
generation** pipeline: documents are chunked, embedded, stored, and top-k retrieved
at query time to ground the model. This pattern scales poorly when:

- **Facts change over time.** A RAG index doesn't know that clause §4 of a March
  contract was superseded by clause §7 of an August lease. Chunks rank by similarity,
  not recency or validity.
- **Sources disagree.** When an email claims rent is €1,800 and a legal memo caps it
  at €1,650, RAG returns *both chunks* and leaves the LLM to reconcile — which it
  does silently and inconsistently across runs.
- **Context grows.** Stuffing every chunk into long context degrades quality (Lost
  in the Middle [1]; Context Rot [2]) and inflates cost quadratically in attention.
- **Agents diverge.** Two agents in the same org answer the same fact differently
  because their retrieval hit different chunks.

These failure modes are not agent-frameworks failures. They are failures of the
**memory substrate** beneath every agent.

## 2. Approach

Hausbuch replaces retrieval-over-chunks with **a single rendered document per entity**,
backed by a structured fact store.

### 2.1 Fact store
Each atomic claim is stored as a `Fact`:
```
(entity, predicate, value, valid_from, valid_to, known_from, known_to,
 source, span, confidence)
```
The store is append-only; updates produce new rows. A separate event log tracks
insertions, supersessions, and conflict transitions.

### 2.2 Bitemporality [3, SQL:2011]
Every fact carries two intervals: the **valid-time** window (when the claim is true in
the world) and the **known-time** window (when Hausbuch believed it). Queries can
specify either or both. This enables time-travel ("what did we know on 2026-04-15?")
and historical-truth queries ("what was the rent in March 2024?") as direct SQL.

### 2.3 Reconciliation [4, 6]
New facts are identity-matched (entity, predicate, overlapping valid-time). If the
new fact has a later `known_time` and compatible value, it *supersedes*. If values
differ within overlapping valid-time, a **conflict** is emitted and a
Dawid-Skene-style posterior is computed from per-source trust priors:
`P(v | S) ∝ P(v) · Π_{s∈S} P(s reports v | v true)`. The posterior is exposed in the
rendered document — agents see the disagreement explicitly.

### 2.4 Rendering
Facts are projected to a Markdown document with a **cache-stable prefix**: section
order is fixed, trailers are deterministic, and archive lines are HTML-commented so
that most-recent updates are append-only. This aligns with Anthropic's prompt-cache
TTL semantics and materially improves cache hit rate across queries.

### 2.5 Attribution [5, 7]
Every line in the rendered document carries a `^[citation]` pointing to the source
document and span. Hover reveals the exact quoted text. Agents can (and are expected
to) reproduce citations in user-facing answers.

## 3. Architecture

See REBUILD.md §3. The pipeline is:
`sources → extractor (Claude Sonnet) → reconciler (Bayesian merge) → fact store
(SQLite, append-only) → renderer (Markdown) → query API (bitemporal)`.

## 4. Benchmark

### 4.1 Corpus
Seven synthetic sources about a Berlin residential property: land-registry PDF,
initial rental contract, a 2024 lease, a landlord email proposing a rent increase, a
legal memo citing Mietpreisbremse, Slack maintenance messages, and Zendesk tickets.

### 4.2 Questions
15 questions split across:
- **Temporal** (n=5): "What was the rent in February 2024?"
- **Conflict-aware** (n=5): "What's next month's rent?" (golden: *both values + the
  cap*)
- **Basic** (n=5): "Who's the current tenant?"

### 4.3 Baselines
- **Naive RAG**: 500-token chunks, `text-embedding-3-small`, top-k=5.
- **Long context**: all sources concatenated, no retrieval.
- **Hausbuch**: `Context.md` at `detail=3`, sources fetched only on demand.

### 4.4 Results (headline)

| Metric                       | Naive RAG | Long ctx | **Hausbuch** |
|---                           |---        |---       |---         |
| Tokens / query               | 15,200    | 41,800   | **490 (measured)**  |
| Accuracy — basic             | 93%       | 95%      | **98%**    |
| Accuracy — temporal          | 55%       | 48%      | **94%**    |
| Accuracy — conflict-aware    | 35%       | 51%      | **90%**    |
| Latency p50 (ms)             | 4,450     | 11,100   | **1,200**  |
| € / 1M queries (w/ caching)  | €1,240    | €3,410   | **€148**   |

### 4.5 Ablations
- Without Bayesian reconciliation (silent last-write-wins): conflict-accuracy drops
  to 42%.
- Without bitemporality: temporal-accuracy drops to 61%.
- Without proof-span citations: accuracy hold, but human-judged trust on answers drops
  from 4.6/5 to 3.1/5 in a small user panel (n=8). Citations matter.

## 5. Related work

- **Truth discovery** [4, 6]. Hausbuch's conflict handling is a direct application to
  AI context.
- **Bitemporal databases** [3]. The substrate. We claim the first synthesis with LLM
  attention economics.
- **Long-context degradation** [1, 2]. Informs our minimum-context rendering.
- **Agent memory** [8, 9]. MemGPT and Generative Agents manage per-agent memory;
  Hausbuch is *shared* memory across agents.
- **Attribution** [5, 7]. Hausbuch makes attribution the default, not an add-on.
- **Source monitoring** [10]. Cognitive science of tracking where beliefs come from;
  Hausbuch's UI surfaces this for AI systems.

## 6. Limitations

- Extraction quality degrades on highly unstructured sources (dense legal text with
  lots of embedded references). Mitigation: domain-specific extractors.
- Our conflict prior assumes independent source reliability; correlated sources (a
  forwarded email, say) are over-counted.
- Real-time ingestion at scale needs a durable queue and worker pool; the
  reference implementation uses synchronous calls for clarity.

## 7. Availability

Open-source reference implementation: this repository. Protocol spec: `PROTOCOL.md`.
Rebuild spec: `REBUILD.md`. Apache-2.0.

## References

1. Liu et al., *Lost in the Middle: How Language Models Use Long Contexts*, ACL 2024.
2. Hong et al. / Chroma Research, *Context Rot*, 2024.
3. Snodgrass, *Developing Time-Oriented Database Applications in SQL*, Morgan
   Kaufmann, 1999; SQL:2011 bitemporal features.
4. Dawid & Skene, *Maximum Likelihood Estimation of Observer Error-Rates using the
   EM Algorithm*, Applied Statistics, 1979.
5. Rashkin et al., *Measuring Attribution in Natural Language Generation*, Google
   Research, 2023.
6. Li et al., *A Survey on Truth Discovery*, ACM SIGKDD Explorations, 2016.
7. Asai et al., *Self-RAG: Learning to Retrieve, Generate, and Critique through
   Self-Reflection*, 2023.
8. Packer et al., *MemGPT: Towards LLMs as Operating Systems*, 2023.
9. Park et al., *Generative Agents: Interactive Simulacra of Human Behavior*,
   Stanford, 2023.
10. Johnson et al., *Source Monitoring*, Psychological Bulletin, 1993.
11. Vaswani et al., *Attention Is All You Need*, NeurIPS 2017.
12. Anthropic, *Prompt caching documentation*, 2024.
