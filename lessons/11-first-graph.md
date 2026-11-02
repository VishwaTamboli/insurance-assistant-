# 11. The first graph: state, nodes, edges

> **Roadmap step 3, piece 1** · Files: [`src/graph/state.ts`](../src/graph/state.ts),
> [`src/graph/nodes/classify.ts`](../src/graph/nodes/classify.ts), [`src/graph/nodes/expand.ts`](../src/graph/nodes/expand.ts),
> [`src/graph/graph.ts`](../src/graph/graph.ts),
> [`src/graph/try-graph.ts`](../src/graph/try-graph.ts) · Run: `npm run try:graph`

## What step 3 builds

The assistant is several agents working one after another, with a loop (the auditor can send a draft
back to the researcher). **LangGraph** runs that for us. We describe the agents as a **graph** (nodes
joined by edges, all sharing one state object), and LangGraph decides what runs next, merges each
node's output into the state, runs loops and stops at the end.

```
classify → expand → retrieve → research ⇄ audit → synthesize
```

In step 3 the agents are **fake**: plain functions with the same input and output as the real ones,
but fixed rules instead of a Gemini call. So we learn the graph itself (state, reducers, edges, the
loop) for free, with the same result on every run. In step 4, each fake is replaced by a real LLM call
and the graph doesn't change.

| Piece | Adds |
|---|---|
| 1 (this page) | state, two fake nodes, fixed edges, compile, invoke |
| 2 | reducers, and a real `retrieve` node using step 2's search |
| 3 | the other nodes, conditional edges, and the revise loop |
| 4 | drawing the graph, loop limits, supersteps |

## New ideas

| Idea | In our code |
|---|---|
| **State** | one object every node can read: `question`, `planCode`, `intent`, `queries`… Each field is a **channel** |
| **Node** | a function `(state) => update`. It returns **only the fields it changes**; LangGraph merges them into the state |
| **Merging without a reducer** | the last value written wins. Page 12 adds reducers for fields that should add up instead |
| **Edge** | "after this node, run that one". `START` and `END` are built-in markers for the beginning and the end |
| **Compile** | checks the graph (every node reachable, no edge to a missing node) and turns it into a runnable app |
| **Invoke** | runs the graph from `START` with an input, and returns the final state |

A node never calls another node. `classify` doesn't know `expand` exists; the edges decide the order.
That's what lets step 4 swap a fake for a real agent without touching anything else.

### When and where an update is merged

Our code never writes to the state. `app.invoke` does it, between nodes: a node returns, LangGraph
copies each field of the returned object into the state, and only then does it start the next node.
Simplified, `invoke` does this:

```ts
state = input                                    // { question, planCode, jurisdiction }
node = the node after START                      // classify
while (node !== END) {
  update = await node(state)                     // classify returns { intent, treatmentDate }
  for (key in update) state[key] = update[key]   // ← the merge: no reducer, so last value wins
  node = the node the edge points to             // expand
}
return state
```

| Step | Node | State it receives | It returns | State after the merge |
|---|---|---|---|---|
| 0 | (input) | | | question, planCode, jurisdiction |
| 1 | `classify` | question, planCode, jurisdiction | intent, treatmentDate | + intent, treatmentDate |
| 2 | `expand` | all five fields above | queries | + queries |

In the real code, each state field is a **channel** object that holds one value. After a node returns,
`_applyWrites` (`node_modules/@langchain/langgraph/dist/pregel/algo.js`) calls `channel.update(...)`
for each returned field, and a field with no reducer is a `LastValue` channel whose `update` simply
replaces the value (`dist/channels/last_value.js`). `invoke` then reads every channel back to build
the final state.

So a node must **return** its changes. Assigning `state.treatmentDate = '…'` inside a node changes
only the node's own copy: it is lost, and the next node still sees the old value.

## Packages

| Package | What it's for |
|---|---|
| `@langchain/langgraph` (1.5.3) | the orchestration runtime: state, nodes, edges, loops, and later checkpoints, human review and streaming. It pulls in `zod`, which it requires; we use `zod` directly in step 4 |

| Package method | What it does |
|---|---|
| `Annotation.Root({ … })` | defines the state: one entry per field |
| `Annotation<T>` | a field of type `T` whose last written value wins |
| `new StateGraph(State)` | starts a graph that works on that state |
| `.addNode(name, fn)` | registers a node |
| `.addEdge(from, to)` | after `from` finishes, run `to` |
| `START`, `END` | where the run begins and where it stops |
| `.compile()` | validates the graph and returns the runnable app |
| `app.invoke(input)` | runs it and returns the final state |

LangGraph also has a newer way to define state, `StateSchema`, built on Zod. We use `Annotation`
because the guide does; both are supported.

## Our code

| File | What it does |
|---|---|
| `state.ts` | the `State`: three input fields (question, plan, country) and three fields the nodes write (intent, treatment date, queries). Exports the types `GraphState` (what a node receives) and `GraphUpdate` (what it returns) |
| `nodes/classify.ts` | fake `classify`: marks questions like "should I stop taking…" as out of scope, and sets a fixed treatment date |
| `nodes/expand.ts` | fake `expand`: always returns the same three queries |
| `nodes/log.ts` | `log()`: prints which node ran and what it returned |
| `graph.ts` | `START → classify → expand → END`, compiled into `app` |
| `try-graph.ts` | invokes `app` with the main test question for a Gold, France member, then prints the final state |

**Folder layout.** Each node has its own file in `src/graph/nodes/`, so in step 4 a fake is replaced
inside its own file. The functions that choose the next node (conditional edges, page 13) go in
`src/graph/edges/`. Fixed edges are one line each, so they stay in `graph.ts`, next to the nodes:
the whole graph reads top to bottom in one file.

## Run it

```bash
npm install @langchain/langgraph@1.5.3
npm run try:graph
```

**Expected:** `added 10 packages` from the install, then:

```
→ classify  returns {"intent":{"topic":"coverage","outOfScope":false},"treatmentDate":"2026-10-27"}
→ expand    returns {"queries":["emergency surgery abroad","emergency admission notification","waiting period for an emergency"]}

Final state:
{
  question: 'Am I covered for an emergency appendectomy in Spain, and do I need pre-authorisation?',
  planCode: 'GOLD',
  jurisdiction: 'FR',
  intent: { topic: 'coverage', outOfScope: false },
  treatmentDate: '2026-10-27',
  queries: [
    'emergency surgery abroad',
    'emergency admission notification',
    'waiting period for an emergency'
  ]
}
```

### What to notice

1. **Each node returned only its own fields**, yet the final state has all of them. LangGraph merged
   each update into the state.
2. **The input fields passed through untouched.** No node returned `question` or `planCode`, so they
   kept their input values.
3. **The order comes from the edges**, not from the order of the functions in the file.

## Check yourself

<details>
<summary><code>classify</code> returns <code>{ intent, treatmentDate }</code>. What happens to <code>question</code>?</summary>

Nothing: a node's update only changes the fields it contains. `question` keeps the value it had.
</details>

<details>
<summary>What would happen if <code>expand</code> also returned <code>{ treatmentDate: '2026-01-01' }</code>?</summary>

`treatmentDate` has no reducer, so the last value written wins: the final state would say `2026-01-01`.
</details>

---

[← The PDF path](10-pdf-path.md) · [Index](README.md) · [Next: reducers and a real retrieve node →](12-reducers-and-retrieve.md)
