"""Async Neo4j service — connection lifecycle and graph CRUD."""
from __future__ import annotations

import logging
from typing import Any

from neo4j import AsyncDriver, AsyncGraphDatabase

from app.core.session import state

log = logging.getLogger(__name__)


class Neo4jService:
    """Holds a single async driver; rebuilt when the user changes credentials."""

    def __init__(self):
        self._driver: AsyncDriver | None = None

    async def connect(self, uri: str, username: str, password: str) -> dict[str, Any]:
        """Test + persist a Neo4j connection."""
        if self._driver is not None:
            await self._driver.close()
            self._driver = None

        try:
            driver = AsyncGraphDatabase.driver(uri, auth=(username, password))
            await driver.verify_connectivity()
            self._driver = driver
            state.neo4j_uri = uri
            state.neo4j_username = username
            state.neo4j_password = password
            state.neo4j_connected = True
            return {"ok": True, "message": "Connected"}
        except Exception as e:
            state.neo4j_connected = False
            return {"ok": False, "message": str(e)}

    @property
    def driver(self) -> AsyncDriver:
        if self._driver is None:
            raise RuntimeError("Neo4j not connected. Connect via the sidebar.")
        return self._driver

    async def disconnect(self):
        if self._driver is not None:
            await self._driver.close()
            self._driver = None
            state.neo4j_connected = False

    async def run(self, cypher: str, params: dict[str, Any] | None = None,
                  database: str | None = None) -> list[dict[str, Any]]:
        """Execute a Cypher query and return result records as dicts."""
        async with self.driver.session(database=database or state.neo4j_username or None) as sess:
            result = await sess.run(cypher, params or {})
            return [r.data() async for r in result]

    async def ensure_vector_index(self):
        """Create the chunk embedding vector index if it doesn't exist."""
        try:
            await self.run(
                "CREATE VECTOR INDEX chunk_embedding IF NOT EXISTS "
                "FOR (c:Chunk) ON (c.embedding) "
                "OPTIONS {indexConfig: {`vector.dimensions`: 768, `vector.similarity_function`: 'cosine'}}"
            )
            state.vector_index_available = True
        except Exception as e:
            log.warning("Vector index creation failed (instance may not support it): %s", e)
            state.vector_index_available = False

    async def vector_search(self, query_embedding: list[float], top_k: int = 5,
                            threshold: float = 0.7) -> list[dict[str, Any]]:
        """Search chunks by embedding similarity. Returns [] if vector index unavailable."""
        if not state.vector_index_available:
            return []
        try:
            rows = await self.run(
                "MATCH (chunk:Chunk) "
                "SEARCH chunk IN (VECTOR INDEX chunk_embedding FOR $embedding LIMIT $topK) "
                "SCORE AS score "
                "WHERE score > $threshold "
                "RETURN chunk.text AS text, chunk.chunkId AS chunkId, score "
                "ORDER BY score DESC",
                {"topK": top_k, "embedding": query_embedding, "threshold": threshold},
            )
            return rows
        except Exception as e:
            log.warning("Vector search failed: %s", e)
            return []

    @staticmethod
    def _node_layer(labels: set[str] | frozenset[str]) -> str:
        if "Document" in labels:
            return "document"
        if "Chunk" in labels:
            return "chunk"
        return "entity"

    @staticmethod
    def _prepare_node_data(props: dict, labels) -> dict:
        """Strip heavy properties and add layer metadata."""
        data = dict(props)
        data.pop("embedding", None)
        if "text" in data and isinstance(data["text"], str) and len(data["text"]) > 100:
            data["text"] = data["text"][:100] + "…"
        label_set = set(labels)
        data["_layer"] = Neo4jService._node_layer(label_set)
        return data

    async def fetch_graph(self, limit: str = "250", layers: str = "entity") -> dict[str, Any]:
        """Return the current graph in {nodes, edges} shape for Reagraph."""
        is_all = str(limit).lower() == "all"
        limit_clause = "" if is_all else "LIMIT $limit"
        
        # Limit distinct nodes first, then find their relationships
        if layers == "all":
            cypher = f"""
            MATCH (n)
            WITH n {limit_clause}
            OPTIONAL MATCH (n)-[r]->(m)
            RETURN n, r, m
            """
        else:
            cypher = f"""
            MATCH (n:Entity)
            WITH n {limit_clause}
            OPTIONAL MATCH (n)-[r]->(m:Entity)
            RETURN n, r, m
            """
        nodes: dict[str, dict] = {}
        edges: list[dict] = []

        params = {} if is_all else {"limit": int(limit)}

        async with self.driver.session(
            database=state.neo4j_username or None
        ) as sess:
            result = await sess.run(cypher, params)
            async for record in result:
                n = record["n"]
                m = record["m"]
                r = record["r"]

                if n is not None:
                    nid = n.element_id
                    if nid not in nodes:
                        nodes[nid] = {
                            "id": nid,
                            "label": dict(n).get("name", dict(n).get("fileName", dict(n).get("chunkId", "node"))),
                            "data": self._prepare_node_data(dict(n), n.labels),
                            "labels": list(n.labels),
                        }
                if m is not None:
                    mid = m.element_id
                    if mid not in nodes:
                        nodes[mid] = {
                            "id": mid,
                            "label": dict(m).get("name", dict(m).get("fileName", dict(m).get("chunkId", "node"))),
                            "data": self._prepare_node_data(dict(m), m.labels),
                            "labels": list(m.labels),
                        }
                if r is not None and n is not None and m is not None:
                    edges.append({
                        "id": r.element_id,
                        "source": n.element_id,
                        "target": m.element_id,
                        "label": r.type,
                        "data": dict(r),
                    })

        return {"nodes": list(nodes.values()), "edges": edges}

    async def update_node(self, node_id: str, properties: dict, new_label: str | None = None):
        """Update properties and optionally relabel a node."""
        before_q = "MATCH (n) WHERE elementId(n) = $id RETURN n, labels(n) AS labels"
        rows = await self.run(before_q, {"id": node_id})
        before = rows[0] if rows else None

        params = {"id": node_id, "props": properties}
        await self.run(
            "MATCH (n) WHERE elementId(n) = $id SET n += $props",
            params,
        )
        if new_label and before:
            old_label = before["labels"][0] if before["labels"] else None
            if old_label and old_label != new_label:
                await self.run(
                    f"MATCH (n) WHERE elementId(n) = $id REMOVE n:`{old_label}` SET n:`{new_label}`",
                    {"id": node_id},
                )

        after_rows = await self.run(before_q, {"id": node_id})
        after = after_rows[0] if after_rows else None
        state.record_change("update_node", node_id, before, after)
        return after

    async def delete_node(self, node_id: str):
        before = await self.run(
            "MATCH (n) WHERE elementId(n) = $id RETURN n",
            {"id": node_id},
        )
        await self.run(
            "MATCH (n) WHERE elementId(n) = $id DETACH DELETE n",
            {"id": node_id},
        )
        state.record_change("delete_node", node_id, before[0] if before else None, None)

    async def add_node(self, label: str, properties: dict | None = None) -> str | None:
        """Create a new node with a given label and properties."""
        # Clean the label to prevent Cypher injection issues
        safe_label = label.strip().replace("`", "")
        if not safe_label:
             raise ValueError("Node label cannot be empty")
        
        if safe_label == "Entity":
            label_clause = ":`Entity`"
        else:
            label_clause = f":`Entity`:`{safe_label}`"

        cypher = f"""
        CREATE (n{label_clause})
        SET n = $props
        RETURN elementId(n) AS id
        """
        
        rows = await self.run(cypher, {"props": properties or {}})
        node_id = rows[0]["id"] if rows else None
        
        # Record the change for the undo history
        state.record_change(
            "add_node", 
            node_id, 
            None,  # No 'before' state for a new node
            {"id": node_id, "label": safe_label, "properties": properties or {}}
        )
        
        return node_id

    async def merge_nodes(self, source_id: str, target_id: str):
        """Merge source into target: move all relationships preserving their types, then delete source.

        Cypher can't parameterize relationship type names, so we first ask for the
        distinct types and then issue one rewire query per type with the type
        spliced into the query string (backticks stripped to prevent injection).
        Type names returned by type() are valid Neo4j identifiers by construction.
        """
        before = await self.run(
            "MATCH (s),(t) WHERE elementId(s)=$s AND elementId(t)=$t RETURN s,t",
            {"s": source_id, "t": target_id},
        )
        params = {"src": source_id, "tgt": target_id}

        out_types = await self.run(
            "MATCH (s)-[r]->(x) WHERE elementId(s) = $src AND elementId(x) <> $tgt "
            "RETURN DISTINCT type(r) AS t",
            params,
        )
        in_types = await self.run(
            "MATCH (x)-[r]->(s) WHERE elementId(s) = $src AND elementId(x) <> $tgt "
            "RETURN DISTINCT type(r) AS t",
            params,
        )

        for row in out_types:
            t = (row["t"] or "").replace("`", "")
            if not t:
                continue
            await self.run(
                f"""
                MATCH (s)-[r:`{t}`]->(x) WHERE elementId(s) = $src AND elementId(x) <> $tgt
                MATCH (tgt) WHERE elementId(tgt) = $tgt
                MERGE (tgt)-[r2:`{t}`]->(x)
                SET r2 += properties(r)
                DELETE r
                """,
                params,
            )

        for row in in_types:
            t = (row["t"] or "").replace("`", "")
            if not t:
                continue
            await self.run(
                f"""
                MATCH (x)-[r:`{t}`]->(s) WHERE elementId(s) = $src AND elementId(x) <> $tgt
                MATCH (tgt) WHERE elementId(tgt) = $tgt
                MERGE (x)-[r2:`{t}`]->(tgt)
                SET r2 += properties(r)
                DELETE r
                """,
                params,
            )

        await self.run(
            "MATCH (s) WHERE elementId(s) = $src DETACH DELETE s",
            {"src": source_id},
        )
        state.record_change("merge_nodes", f"{source_id}->{target_id}",
                            before[0] if before else None, None)

    async def add_relation(self, source_id: str, target_id: str,
                           relation: str, properties: dict | None = None):
        cypher = f"""
        MATCH (s) WHERE elementId(s) = $src
        MATCH (t) WHERE elementId(t) = $tgt
        MERGE (s)-[r:`{relation}`]->(t)
        SET r += $props
        RETURN elementId(r) AS id
        """
        rows = await self.run(cypher, {
            "src": source_id, "tgt": target_id, "props": properties or {},
        })
        edge_id = rows[0]["id"] if rows else None
        state.record_change(
            "add_relation",
            f"{source_id} -[{relation}]-> {target_id}",
            None,
            {"id": edge_id, "relation": relation, "properties": properties or {}},
        )
        return edge_id

    async def update_relation(self, edge_id: str, new_relation: str | None = None,
                              new_properties: dict | None = None) -> str | None:
        """Rename a relationship (and/or update its properties).

        Neo4j relationship types are immutable, so renaming = create new typed
        rel between the same endpoints with merged properties, then delete the
        old one. Returns the new edge's elementId.
        """
        rows = await self.run(
            "MATCH (s)-[r]->(t) WHERE elementId(r) = $id "
            "RETURN elementId(s) AS s, elementId(t) AS t, type(r) AS type, properties(r) AS props",
            {"id": edge_id},
        )
        if not rows:
            raise ValueError(f"Relation {edge_id} not found")
        row = rows[0]
        before = {
            "id": edge_id,
            "source_id": row["s"],
            "target_id": row["t"],
            "relation": row["type"],
            "properties": row["props"] or {},
        }

        target_type = (new_relation or row["type"]).strip().upper().replace(" ", "_")
        target_type = target_type.replace("`", "")
        if not target_type:
            raise ValueError("Relation name cannot be empty")

        merged_props = {**(row["props"] or {}), **(new_properties or {})}

        # If the type is unchanged, just patch properties in place
        if target_type == row["type"]:
            await self.run(
                "MATCH ()-[r]->() WHERE elementId(r) = $id SET r += $props RETURN elementId(r) AS id",
                {"id": edge_id, "props": new_properties or {}},
            )
            state.record_change(
                "update_relation", edge_id,
                before,
                {**before, "properties": merged_props},
            )
            return edge_id

        # Type changed: create new, delete old
        new_rows = await self.run(
            f"""
            MATCH (s) WHERE elementId(s) = $s
            MATCH (t) WHERE elementId(t) = $t
            MERGE (s)-[r2:`{target_type}`]->(t)
            SET r2 += $props
            RETURN elementId(r2) AS id
            """,
            {"s": row["s"], "t": row["t"], "props": merged_props},
        )
        new_id = new_rows[0]["id"] if new_rows else None
        await self.run(
            "MATCH ()-[r]->() WHERE elementId(r) = $id DELETE r",
            {"id": edge_id},
        )
        state.record_change(
            "update_relation", f"{edge_id} -> {new_id}",
            before,
            {"id": new_id, "source_id": row["s"], "target_id": row["t"],
             "relation": target_type, "properties": merged_props},
        )
        return new_id

    async def delete_relation(self, edge_id: str):
        before = await self.run(
            "MATCH (s)-[r]->(t) WHERE elementId(r) = $id "
            "RETURN elementId(s) AS source_id, elementId(t) AS target_id, type(r) AS rel_type, properties(r) AS props",
            {"id": edge_id},
        )
        await self.run(
            "MATCH ()-[r]->() WHERE elementId(r) = $id DELETE r",
            {"id": edge_id},
        )
        state.record_change("delete_relation", edge_id,
                            {"source_id": before[0]["source_id"], "target_id": before[0]["target_id"],
                             "relation": before[0]["rel_type"], "properties": before[0]["props"] or {}}
                            if before else None,
                            None)


    async def undo_change(self, index: int) -> str:
        """Reverse the history entry at `index` (0 = most recent).

        Undoable actions: update_node, add_relation, update_relation, delete_relation.
        Returns a human-readable description of what was reversed.
        """
        if index < 0 or index >= len(state.history):
            raise ValueError("History index out of range")

        entry = state.history[index]
        action = entry.action
        before = entry.before

        if action == "update_node":
            if not before:
                raise ValueError("No before state to restore")
            node = before.get("n", before)
            props = dict(node) if not isinstance(node, dict) else node
            labels = before.get("labels", [])
            node_id = entry.target
            await self.run("MATCH (n) WHERE elementId(n) = $id SET n = $props", {"id": node_id, "props": props})
            if labels:
                current = await self.run("MATCH (n) WHERE elementId(n) = $id RETURN labels(n) AS l", {"id": node_id})
                old_labels = current[0]["l"] if current else []
                for lbl in old_labels:
                    lbl = lbl.replace("`", "")
                    await self.run(f"MATCH (n) WHERE elementId(n) = $id REMOVE n:`{lbl}`", {"id": node_id})
                for lbl in labels:
                    lbl = str(lbl).replace("`", "")
                    await self.run(f"MATCH (n) WHERE elementId(n) = $id SET n:`{lbl}`", {"id": node_id})
            state.history.pop(index)
            return f"Restored node {node_id} to previous state"

        elif action == "add_relation":
            if not entry.after or not entry.after.get("id"):
                raise ValueError("No relation id in after state")
            edge_id = entry.after["id"]
            await self.run("MATCH ()-[r]->() WHERE elementId(r) = $id DELETE r", {"id": edge_id})
            state.history.pop(index)
            return f"Deleted relation {edge_id} (undo of add_relation)"

        elif action == "update_relation":
            if not before:
                raise ValueError("No before state to restore")
            src, tgt = before["source_id"], before["target_id"]
            old_type = before["relation"].strip().upper().replace(" ", "_").replace("`", "")
            old_props = before.get("properties", {})
            # current edge id is in before["id"] (pre-update) or after["id"] (post-update)
            current_id = entry.after["id"] if entry.after else before.get("id")
            await self.run(
                f"""
                MATCH (s) WHERE elementId(s) = $s
                MATCH (t) WHERE elementId(t) = $t
                MERGE (s)-[r:`{old_type}`]->(t)
                SET r = $props
                """,
                {"s": src, "t": tgt, "props": old_props},
            )
            if current_id:
                await self.run("MATCH ()-[r]->() WHERE elementId(r) = $id DELETE r", {"id": current_id})
            state.history.pop(index)
            return f"Restored relation to {old_type}"

        elif action == "delete_relation":
            if not before:
                raise ValueError("No before state to restore")
            rel_type = before["relation"].strip().upper().replace(" ", "_").replace("`", "")
            await self.run(
                f"""
                MATCH (s) WHERE elementId(s) = $s
                MATCH (t) WHERE elementId(t) = $t
                MERGE (s)-[r:`{rel_type}`]->(t)
                SET r += $props
                """,
                {"s": before["source_id"], "t": before["target_id"], "props": before.get("properties", {})},
            )
            state.history.pop(index)
            return f"Recreated relation {rel_type}"
        
        elif action == "add_node":
            node_id = entry.target
            await self.run("MATCH (n) WHERE elementId(n) = $id DETACH DELETE n", {"id": node_id})
            state.history.pop(index)
            return f"Deleted newly created node {node_id}"

        else:
            raise ValueError(f"Action '{action}' cannot be undone")

    async def get_schema(self) -> dict:
        """Return node label counts and relationship type counts."""
        label_rows = await self.run(
            "MATCH (n) UNWIND labels(n) AS lbl RETURN lbl AS label, count(*) AS count ORDER BY count DESC"
        )
        rel_rows = await self.run(
            "MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS count ORDER BY count DESC"
        )
        return {
            "node_labels": [{"label": r["label"], "count": r["count"]} for r in label_rows],
            "rel_types": [{"type": r["type"], "count": r["count"]} for r in rel_rows],
        }


neo4j_service = Neo4jService()
