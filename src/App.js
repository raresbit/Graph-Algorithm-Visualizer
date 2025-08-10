import React, { useState, useEffect, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import * as cytoscape from "cytoscape";
import './App.css';

window.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();  // stop the save dialog
    console.log('Save shortcut disabled');
    // You can add your own custom logic here if needed
  }
});


const predefinedGraphs = {
  empty: [],
  rootOnly: [[]],
  tree: [
    [1, 2],
    [3, 4],
    [],
    [],
    [],
  ],
  graph: [
    [1, 3],     // 0 → 1, 3
    [2, 4],     // 1 → 2, 4
    [4],        // 2 → 4
    [4, 5],     // 3 → 4, 5
    [6],        // 4 → 6
    [6],        // 5 → 6
    [],         // 6
  ],
  customWeighted: null
};

function parseEdgeWeightLists(edgeText, weightText) {
  try {
    const edges = JSON.parse(edgeText);
    const weights = JSON.parse(weightText);
    if (!Array.isArray(edges) || !Array.isArray(weights)) return null;
    if (edges.length !== weights.length) return null;
    for (const e of edges) {
      if (!Array.isArray(e) || e.length !== 2) return null;
      if (typeof e[0] !== "number" || typeof e[1] !== "number") return null;
    }
    for (const w of weights) {
      if (typeof w !== "number") return null;
    }
    return { edges, weights };
  } catch {
    return null;
  }
}

function parseAdjacencyList(text) {
  try {
    // Expecting input like [[1,2],[3],[4],[],[]]
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    for (const row of parsed) {
      if (!Array.isArray(row)) return null;
      for (const el of row) {
        if (typeof el !== "number") return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export default function GraphAlgoVisualizer() {
  const cyRef = useRef(null);
  const pyodideRef = useRef(null);
  const waitResolverRef = useRef(null);
  
  const [selectedGraphKey, setSelectedGraphKey] = useState("graph");
  const [graph, setGraph] = useState(predefinedGraphs[selectedGraphKey]);
  const [customGraphText, setCustomGraphText] = useState(
    "[[1,2],[3],[4],[],[]]"
  );
  const [code, setCode] = useState(`# Write your Solution class here
class Solution:
  def __init__(self, graph):
    # graph is either adjacency list [[1,2],[3],...] (unweighted)
    # or adjacency list with weights [[[1,5],[2,3]], [[3,2]], [], []]
    self.graph = graph

  async def main(self):
    n = len(self.graph)
    for i in range(n):
      await anim.highlight_node(i)
      # Example to show edges and weights if weighted:
      for edge in self.graph[i]:
        if isinstance(edge, list) and len(edge) == 2:
          v, w = edge
          await anim.highlight_edge(i, v)
          await anim.log(f"Edge {i} -> {v} with weight {w}")
        else:
          # unweighted
          v = edge
          await anim.highlight_edge(i, v)
          await anim.log(f"Edge {i} -> {v}")
`);
  const [consoleLines, setConsoleLines] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [codeStarted, setCodeStarted] = useState(false);
  const [codeFinished, setCodeFinished] = useState(false);
  const [customGraphError, setCustomGraphError] = useState(null);
  const [edgeListText, setEdgeListText] = useState('[[0,1],[0,2],[1,2]]');
  const [weightListText, setWeightListText] = useState('[5,2,7]');
  const [customWeightedError, setCustomWeightedError] = useState(null);
  const [animationSpeed, setAnimationSpeed] = useState(800); // default 800 ms
  


  // When graph selection changes
  useEffect(() => {
    if (selectedGraphKey === "custom") {
      // Use current custom text to parse graph
      const parsed = parseAdjacencyList(customGraphText);
      if (parsed) {
        setGraph(parsed);
        setCustomGraphError(null);
      } else {
        setCustomGraphError("Invalid adjacency list format.");
        setGraph([]);
      }
    } else {
      setGraph(predefinedGraphs[selectedGraphKey]);
      setCustomGraphError(null);
      setCustomGraphText("[[1,2],[3],[4],[],[]]");
    }
    clearHighlights();
    setConsoleLines([]);
    setCodeStarted(false);
    setCodeFinished(false);
    setPlaying(false);
  }, [selectedGraphKey]);
  
  
  // Update the graph in cytoscape live without remounting React component
  function updateGraphLive(newGraph) {
    if (!cyRef.current) return;
    
    const cy = cyRef.current;
    
    // Remove all existing nodes and edges
    cy.elements().remove();
    
    // Add new nodes
    for (let i = 0; i < newGraph.length; i++) {
      cy.add({ group: 'nodes', data: { id: `${i}`, label: `${i}` } });
    }
    
    // Add edges
    for (let u = 0; u < newGraph.length; u++) {
      for (const el of newGraph[u]) {
        if (Array.isArray(el) && el.length === 2) {
          const [v, w] = el;
          cy.add({
            group: 'edges',
            data: { id: `e${u}-${v}`, source: `${u}`, target: `${v}`, label: `${w}` },
          });
        } else if (typeof el === 'number') {
          cy.add({
            group: 'edges',
            data: { id: `e${u}-${el}`, source: `${u}`, target: `${el}` },
          });
        }
      }
    }
    
    // Optional: re-run layout to reposition nodes nicely after update
    cy.layout({
      name: 'breadthfirst',
      roots: '#0',
      padding: 30,
      spacingFactor: 1.5,
      fit: false,
    }).run();
    
    // Clear highlights after update
    clearHighlights();
  }


  // When custom graph text changes, parse it if "custom" is selected
  useEffect(() => {
    if (selectedGraphKey === "customWeighted") {
      const parsed = parseEdgeWeightLists(edgeListText, weightListText);
      if (parsed) {
        const { edges, weights } = parsed;
        
        // Defensive check - ensure edges and weights are arrays and non-empty
        if (
          Array.isArray(edges) && edges.length > 0 &&
          Array.isArray(weights) && weights.length === edges.length
        ) {
          // Find max node index from edges safely
          const allNodes = edges.flat();
          const n = allNodes.length > 0 ? Math.max(...allNodes) + 1 : 0;
          
          // Initialize adjacency list: each node maps to list of (neighbor, weight) pairs
          const adj = Array.from({ length: n }, () => []);
          
          edges.forEach(([u, v], idx) => {
            const w = weights[idx];
            adj[u].push([v, w]);  // <-- store pairs (node, weight)
          });
          
          setGraph(adj);
          setCustomWeightedError(null);
        } else {
          setCustomWeightedError("Invalid edge or weight data.");
          setGraph([]);
        }
      } else {
        setCustomWeightedError("Invalid edge/weight list format.");
        setGraph([]);
      }
    } else if (selectedGraphKey === "custom") {
      const parsed = parseAdjacencyList(customGraphText);
      if (parsed) {
        setGraph(parsed);
        setCustomGraphError(null);
      } else {
        setCustomGraphError("Invalid adjacency list format.");
        setGraph([]);
      }
    } else {
      setGraph(predefinedGraphs[selectedGraphKey]);
      setCustomGraphError(null);
      setCustomWeightedError(null);
      setCustomGraphText("[[1,2],[3],[4],[],[]]");
    }
    clearHighlights();
    setConsoleLines([]);
    setCodeStarted(false);
    setCodeFinished(false);
    setPlaying(false);
  }, [selectedGraphKey, edgeListText, weightListText, customGraphText]);


  // Build cytoscape elements from current graph
  const cyElements = [];
  
  if (selectedGraphKey !== "customWeighted") {
    for (let i = 0; i < graph.length; i++) {
      cyElements.push({ data: { id: `${i}`, label: `${i}` } });
    }
    
    
    for (let u = 0; u < graph.length; u++) {
      for (const el of graph[u]) {
        if (Array.isArray(el) && el.length === 2) {
          // Weighted edge: el = [v, w]
          const [v, w] = el;
          cyElements.push({
            data: {
              id: `e${u}-${v}`,
              source: `${u}`,
              target: `${v}`,
              label: `${w}`
            }
          });
        } else if (typeof el === "number") {
          // Unweighted edge
          cyElements.push({ data: { id: `e${u}-${el}`, source: `${u}`, target: `${el}` } });
        }
      }
    }

  } else {
    // graph here is adjacency list with pairs: [(neighbor, weight), ...]
    const n = graph.length;
    // Add nodes
    for (let i = 0; i < n; i++) {
      cyElements.push({ data: { id: `${i}`, label: `${i}` } });
    }
    
    // Then add edges
    for (let u = 0; u < n; u++) {
      if (!Array.isArray(graph[u])) continue;
      
      for (const edge of graph[u]) {
        if (Array.isArray(edge) && edge.length === 2) {
          const [v, w] = edge;
          cyElements.push({
            data: {
              id: `e${u}-${v}`,
              source: `${u}`,
              target: `${v}`,
              label: `${w}`
            }
          });
        }
      }
    }
  }
  

  useEffect(() => {
    if (cyRef.current) {
      cyRef.current.destroy();
    }
    cyRef.current = cytoscape.default({
      container: document.getElementById("cy"),
      elements: cyElements,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#4dabf7",
            label: "data(label)",
            "text-valign": "center",
            "text-halign": "center",
            color: "#212121",
            "font-weight": "600",
            "border-width": 2,
            "border-color": "#1976d2",
            width: 40,
            height: 40,
          },
        },
        {
          selector: "edge",
          style: {
            width: 3,
            "line-color": "#90caf9",
            "target-arrow-color": "#90caf9",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            "label": "data(label)",
            "font-size": 12,
            "text-background-color": "#fff",
            "text-background-opacity": 1,
            "text-background-padding": 2
          },
        },
        {
          selector: ".highlightedNode",
          style: {
            "background-color": "#ffab00",  // warm orange
            "border-color": "#ff6f00",
            "border-width": 4,
          },
        },
        {
          selector: ".highlightedEdge",
          style: {
            "line-color": "#1565c0",
            "target-arrow-color": "#1565c0",
            width: 5,
          },
        },
      ],
      layout: {
        name: "breadthfirst",
        roots: "#0",
        padding: 30,
        spacingFactor: 1.5,   // control spacing between nodes (default is 1)
        fit: false,           // don't auto-zoom to fit the whole graph
      },
    });
  }, [graph, code]);

  function clearHighlights() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("highlightedNode");
    cy.edges().removeClass("highlightedEdge");
  }

  function highlightNode(i) {
    clearHighlights();
    const cy = cyRef.current;
    if (!cy) return;
    const node = cy.getElementById(`${i}`);
    if (node) node.addClass("highlightedNode");
  }

  function highlightEdge(u, v) {
    clearHighlights();
    const cy = cyRef.current;
    if (!cy) return;
    let edge = cy.getElementById(`e${u}-${v}`);
    if (!edge || edge.empty()) edge = cy.getElementById(`e${v}-${u}`);
    if (edge && !edge.empty()) edge.addClass("highlightedEdge");
  }

  function logToConsole(msg) {
    let displayMsg = msg;
    try {
      const parsed = JSON.parse(msg);
      if (typeof parsed === 'object') {
        displayMsg = JSON.stringify(parsed)
        .replace(/,/g, ', ')
        .replace(/:/g, ': ');
      }
    } catch {
      // not JSON, use msg as is
    }
    setConsoleLines((lines) => [...lines, displayMsg]);
    if (msg.startsWith("__MAIN_RETURN__:")) {
      setCodeFinished(true);
      setPlaying(false);
    }
  }


  async function initPyodide() {
    if (pyodideRef.current) return pyodideRef.current;
    logToConsole("Loading Pyodide...");
    const pyodide = await window.loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.23.4/full/",
    });
    pyodideRef.current = pyodide;

    window.highlight_node = (i) => {
      highlightNode(i);
      logToConsole(`Highlight node ${i}`);
    };

    window.highlight_edge = (u, v) => {
      highlightEdge(u, v);
      logToConsole(`Highlight edge ${u}-${v}`);
    };

    window.wait_for_step = () => {
      return new Promise((resolve) => {
        waitResolverRef.current = resolve;
      });
    };

    window.js_log = (msg) => {
      logToConsole(msg);
    };
    
    await pyodide.runPythonAsync(`
import js
import json

def update_graph(new_graph):
  json_str = json.dumps(new_graph)
  js_graph = js.JSON.parse(json_str)
  js.updateGraphLive(js_graph)
`);
    

    await pyodide.runPythonAsync(`
import js
import asyncio

class Anim:
  async def highlight_node(self, i):
    js.highlight_node(i)
    await js.wait_for_step()

  async def highlight_edge(self, u, v):
    js.highlight_edge(u, v)
    await js.wait_for_step()

  import json

  async def log(self, msg):
    if not isinstance(msg, str):
      # Convert Python object to str in a compact form
      msg = str(msg)  # or str(msg)
    js.js_log(msg)
    await js.wait_for_step()


anim = Anim()
`);
    
    window.updateGraphLive = updateGraphLive;
    

    logToConsole("Pyodide loaded.");
    return pyodide;
  }

  async function runCode() {
    const pyodide = await initPyodide();
    if (!pyodide) return;

    clearHighlights();
    setConsoleLines([]);
    setCodeStarted(false);
    setCodeFinished(false);
    setPlaying(false);

    const pyGraph = pyodide.toPy(graph);
    pyodide.globals.set("graph", pyGraph);

    const runner = `
import asyncio

${code}

async def __runner():
    try:
        sol = Solution(graph)
        if hasattr(sol, 'main'):
            res = await sol.main()
        else:
            res = None
        anim.log(f"__MAIN_RETURN__:{res}")
    except Exception as e:
        anim.log(f"__EXCEPTION__:{e}")

asyncio.ensure_future(__runner())
`;

    logToConsole("Code started...");
    setCodeStarted(true);

    try {
      await pyodide.runPythonAsync(runner);
    } catch (e) {
      logToConsole(`Error starting code: ${e}`);
    }
  }

  function stepForward() {
    if (waitResolverRef.current) {
      waitResolverRef.current();
      waitResolverRef.current = null;
    }
  }

  useEffect(() => {
    if (!playing) return;
    
    const interval = setInterval(() => {
      if (waitResolverRef.current) {
        waitResolverRef.current();
        waitResolverRef.current = null;
      } else {
        setPlaying(false);
      }
    }, animationSpeed);
    
    return () => clearInterval(interval);
  }, [playing, animationSpeed]);


  return (
    <div className="app-container">
      <div className="left-panel">
        <h2 className="section-title">Python Code</h2>
        <div className="left-panel-content">
          <div className="code-editor-wrapper" style={{ flex: "none", height: "60vh", marginBottom: 15 }}>
          <CodeMirror
          value={code}
          height="60vh"   // fixed height
          extensions={[python()]}
          theme="dark"  // dark theme
          onChange={(newCode) => {
            setCode(newCode);
            setCodeStarted(false);
            setPlaying(false);
          }}
          />
          </div>
    <div className="buttons-row" style={{ marginBottom: 10, alignItems: "center", display: "flex", gap: 15 }}>
    <button onClick={runCode} disabled={playing} className="btn">Run</button>
    <button
    onClick={() => setPlaying(!playing)}
    disabled={!codeStarted || codeFinished}
    className="btn"
    >
    {playing ? "Pause" : "Play"}
    </button>
    <button
    onClick={stepForward}
    disabled={!codeStarted || codeFinished}
    className="btn"
    >
    Step
    </button>
    
    <label style={{ color: "#ffb74d", fontWeight: "600", marginLeft: "auto" }}>
    Speed: {animationSpeed} ms
    <input
    type="range"
    min="100"
    max="2000"
    step="100"
    value={animationSpeed}
    onChange={(e) => setAnimationSpeed(Number(e.target.value))}
    style={{ marginLeft: 8, verticalAlign: "middle" }}
    />
    </label>
    </div>
      {codeStarted && !codeFinished && (
        <div className="console-output">
          {consoleLines.map((line, idx) => (
            <div key={idx} className="console-line">{line}</div>
          ))}
        </div>
      )}
        
    <div className="instructions-box">
    <strong>Instructions:</strong>
    <ul style={{ margin: "5px 0 0 20px", padding: 0 }}>
    <li><code>await anim.highlight_node(i)</code> — highlight node with index <code>i</code></li>
    <li><code>await anim.highlight_edge(u, v)</code> — highlight edge between nodes <code>u</code> and <code>v</code></li>
    <li><code>await anim.log("message")</code> — print message to console</li>
    <li><code>update_graph(new_graph)</code> — if you mutate the graph in your code, then call this to update the graph visualization live with the new adjacency list</li>
    </ul>
    </div>

        </div>
      </div>

      <div className="right-panel">
        <h2 className="section-title">Graph Visualization</h2>

        <label htmlFor="graph-select" style={{ marginBottom: 6, fontWeight: "600", color: "#ffb74d", display: "block" }}>
          Select Graph:
        </label>
        <div className="graph-select-wrapper" style={{ marginTop: 12, marginBottom: 20 }}>
        <select
        id="graph-select"
        value={selectedGraphKey}
        onChange={(e) => setSelectedGraphKey(e.target.value)}
        className="graph-select"
        >
        <option value="empty">Empty</option>
        <option value="rootOnly">Root</option>
        <option value="tree">Tree</option>
        <option value="graph">Graph</option>
        <option value="custom">Custom</option>
        <option value="customWeighted">Custom Weighted</option>
        </select>
        </div>


    {selectedGraphKey === "custom" && (
      <>
      <label htmlFor="custom-graph" style={{ marginTop: 12, marginBottom: 6, fontWeight: "600", color: "#ffb74d", display: "block" }}>
      Enter adjacency list:
      </label>
      <input
      id="custom-graph"
      type="text"
      value={customGraphText}
      onChange={(e) => setCustomGraphText(e.target.value)}
      className="custom-graph-input"
      spellCheck={false}
      autoComplete="off"
      />
      {customGraphError && (
        <div style={{ color: "#f44336", marginTop: 4, fontWeight: "600" }}>
        {customGraphError}
        </div>
      )}
      </>
    )}
    
    {selectedGraphKey === "customWeighted" && (
      <>
      <label style={{ fontWeight: 600, color: "#ffb74d" }}>Edges:</label>
      <input
      type="text"
      value={edgeListText}
      onChange={(e) => setEdgeListText(e.target.value)}
      className="custom-graph-input"
      spellCheck={false}
      autoComplete="off"
      />
      <label style={{ fontWeight: 600, color: "#ffb74d" }}>Weights:</label>
      <input
      type="text"
      value={weightListText}
      onChange={(e) => setWeightListText(e.target.value)}
      className="custom-graph-input"
      spellCheck={false}
      autoComplete="off"
      />
      {customWeightedError && (
        <div style={{ color: "#f44336", marginTop: 4, fontWeight: "600" }}>
        {customWeightedError}
        </div>
      )}
      </>
    )}


        <div id="cy" className="cytoscape-container" />
      </div>
    </div>
  );
}
  