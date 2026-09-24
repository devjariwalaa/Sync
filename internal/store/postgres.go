package store

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"regexp"
	"syncforge/internal/crdt"
)

//go:embed schema.sql
var schema string
var ErrConflict = errors.New("operation ID already has a different payload")
var docPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)

func ValidDocument(id string) bool { return docPattern.MatchString(id) }
func accessHash(key string) string { return fmt.Sprintf("%x", sha256.Sum256([]byte(key))) }

type Entry struct {
	Seq int64   `json:"seq"`
	Op  crdt.Op `json:"op"`
}
type Store struct{ Pool *pgxpool.Pool }

func (s *Store) CreatePrivate(ctx context.Context, doc, key string) error {
	if !ValidDocument(doc) || len(key) < 20 {
		return errors.New("invalid private document")
	}
	result, err := s.Pool.Exec(ctx, "INSERT INTO documents(id,access_hash) VALUES($1,$2) ON CONFLICT DO NOTHING", doc, accessHash(key))
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return errors.New("document already exists")
	}
	return nil
}

func (s *Store) Authorized(ctx context.Context, doc, key string) (bool, error) {
	var hash string
	err := s.Pool.QueryRow(ctx, "SELECT access_hash FROM documents WHERE id=$1", doc).Scan(&hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return key == "", nil
	}
	if err != nil {
		return false, err
	}
	return hash == "" || (key != "" && hash == accessHash(key)), nil
}

func Open(ctx context.Context, url string) (*Store, error) {
	p, e := pgxpool.New(ctx, url)
	if e != nil {
		return nil, e
	}
	tx, e := p.Begin(ctx)
	if e != nil {
		p.Close()
		return nil, e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(734921)"); e == nil {
		_, e = tx.Exec(ctx, schema)
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		p.Close()
		return nil, e
	}
	return &Store{p}, nil
}

// Append locks one document row until commit. This makes sequence order identical
// to commit order, including across backend processes; sequence gaps cannot hide edits.
func (s *Store) Append(ctx context.Context, doc string, ops []crdt.Op) error {
	if !ValidDocument(doc) || len(ops) == 0 || len(ops) > 1000 {
		return errors.New("invalid document or batch size")
	}
	check := crdt.New()
	if e := check.Apply(ops); e != nil {
		return e
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "INSERT INTO documents(id) VALUES($1) ON CONFLICT DO NOTHING", doc); e != nil {
		return e
	}
	var version int64
	if e = tx.QueryRow(ctx, "SELECT version FROM documents WHERE id=$1 FOR UPDATE", doc).Scan(&version); e != nil {
		return e
	}
	for _, op := range ops {
		var raw []byte
		e = tx.QueryRow(ctx, "SELECT body FROM operations WHERE document_id=$1 AND id=$2", doc, op.ID).Scan(&raw)
		if e == nil {
			var existing crdt.Op
			if e = json.Unmarshal(raw, &existing); e != nil {
				return e
			}
			if existing != op {
				return ErrConflict
			}
			continue
		}
		if !errors.Is(e, pgx.ErrNoRows) {
			return e
		}
		version++
		body, _ := json.Marshal(op)
		if _, e = tx.Exec(ctx, "INSERT INTO operations(document_id,id,seq,body) VALUES($1,$2,$3,$4)", doc, op.ID, version, string(body)); e != nil {
			return e
		}
	}
	if _, e = tx.Exec(ctx, "UPDATE documents SET version=$2 WHERE id=$1", doc, version); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Store) Since(ctx context.Context, doc string, after int64) ([]Entry, error) {
	rows, e := s.Pool.Query(ctx, "SELECT seq,body FROM operations WHERE document_id=$1 AND seq>$2 ORDER BY seq LIMIT 1000", doc, after)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		var item Entry
		var body []byte
		if e = rows.Scan(&item.Seq, &body); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(body, &item.Op); e != nil {
			return nil, e
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
