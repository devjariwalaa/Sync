CREATE TABLE IF NOT EXISTS documents (
 id TEXT PRIMARY KEY,
 version BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS operations (
 document_id TEXT NOT NULL REFERENCES documents(id),
 id TEXT NOT NULL,
 seq BIGINT NOT NULL,
 body TEXT NOT NULL,
 PRIMARY KEY (document_id, id),
 UNIQUE (document_id, seq)
);
