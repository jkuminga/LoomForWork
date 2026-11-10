"""MemoryGraph projection contract and deterministic browser layout checks."""
import json
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from src.harness.control_center.app import create_app


class MemoryGraphTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.memory = self.root / "memorygraph.db"
        self.client = TestClient(create_app(self.root / "state.db", self.memory))

    def tearDown(self):
        self.client.close()
        self.tmp.cleanup()

    def seed(self):
        with sqlite3.connect(self.memory) as db:
            db.executescript("""
            CREATE TABLE memories (id TEXT PRIMARY KEY, type TEXT, title TEXT, summary TEXT,
              content TEXT, tags TEXT, importance REAL, confidence REAL, created_at TEXT, updated_at TEXT, context TEXT);
            CREATE TABLE relationships (id TEXT PRIMARY KEY, from_id TEXT, to_id TEXT, rel_type TEXT,
              strength REAL, context TEXT);
            """)
            db.execute("PRAGMA user_version = 1")
            for i, kind in enumerate(["project", "error", "fix", "workflow"]):
                db.execute("INSERT INTO memories VALUES (?,?,?,?,?,?,?,?,?,?,?)", (str(i),kind,f"Title {i}","summary", "<script>content</script>", '["tag"]',.8,.9,"2026-10-01T00:00:00Z","2026-10-01T00:00:00Z",'{"harness_candidate_id":"secret"}'))
            db.execute("INSERT INTO relationships VALUES ('r','1','2','SOLVES',.7,'relation context')")

    def test_missing_store_is_empty_and_never_created(self):
        r = self.client.get("/api/memory-graph")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["nodes"], [])
        self.assertFalse(self.memory.exists())
        self.assertEqual(self.client.get("/api/memory-graph/missing").status_code,404)

    def test_projection_groups_direction_and_private_metadata(self):
        self.seed()
        before = self.memory.read_bytes()
        r = self.client.get("/api/memory-graph").json()
        self.assertEqual({n["group"] for n in r["nodes"]}, {"reference","problem","solution","pattern"})
        self.assertEqual(r["edges"][0]["from_id"], "1")
        self.assertEqual(r["edges"][0]["to_id"], "2")
        self.assertNotIn("content", r["nodes"][0])
        d = self.client.get("/api/memory-graph/2").json()
        self.assertEqual(d["memory"]["content"],"<script>content</script>")
        self.assertEqual(d["relationships"][0]["neighbor_id"],"1")
        self.assertNotIn("secret",json.dumps(d))
        self.assertEqual(before,self.memory.read_bytes())

    def test_filters_limit_and_induced_edges(self):
        self.seed()
        r = self.client.get("/api/memory-graph?group=problem").json()
        self.assertEqual([n["id"] for n in r["nodes"]],["1"])
        self.assertEqual(r["edges"],[])
        r = self.client.get("/api/memory-graph?limit=1").json()
        self.assertTrue(r["truncated"])
        self.assertEqual(r["total"],4)
        self.assertEqual(self.client.get("/api/memory-graph?query=Title%202").json()["nodes"][0]["id"],"2")
        self.assertEqual(self.client.get("/api/memory-graph?query=%27%20OR%201=1--").json()["nodes"],[])
        self.assertEqual(self.client.get("/api/memory-graph?group=invalid").status_code,422)
        self.assertEqual(self.client.get("/api/memory-graph?limit=501").status_code,422)

    def test_corrupt_store_and_tags(self):
        self.seed()
        with sqlite3.connect(self.memory) as db:
            db.execute("UPDATE memories SET tags='broken' WHERE id='1'")
        self.assertEqual(self.client.get("/api/memory-graph/1").json()["memory"]["tags"],[])
        with sqlite3.connect(self.memory) as db:
            db.execute("DROP TABLE relationships")
        response = self.client.get("/api/memory-graph")
        self.assertEqual(response.status_code,503)
        self.assertNotIn(str(self.root),response.text)

    def test_incompatible_schema_version_is_unavailable(self):
        self.seed()
        with sqlite3.connect(self.memory) as db:
            db.execute("PRAGMA user_version = 2")
        self.assertEqual(self.client.get("/api/memory-graph").status_code, 503)

    def test_layout_is_finite_repeatable_and_spaced(self):
        source = Path("src/harness/control_center/static/memory-graph.js").read_text().split("(() => {")[0]
        script = source + """
        const nodes = Array.from({length:100},(_,i)=>({id:String(i)}));
        const edges = nodes.slice(1).map(n=>({from_id:'0',to_id:n.id}));
        const a = [...memoryLayout(nodes,edges).values()];
        const b = [...memoryLayout(nodes,edges).values()];
        if(JSON.stringify(a)!==JSON.stringify(b)) throw Error('unstable');
        for(let i=0;i<a.length;i++) {
          if(!Number.isFinite(a[i].x)||!Number.isFinite(a[i].y))throw Error('invalid');
          for(let j=i+1;j<a.length;j++)if(Math.hypot(a[i].x-a[j].x,a[i].y-a[j].y)<16)throw Error('overlap');
        }
        """
        result = subprocess.run(["node","-e",script], capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
