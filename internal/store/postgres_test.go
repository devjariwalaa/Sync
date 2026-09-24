package store

import (
	"context"
	"fmt"
	"os"
	"sync"
	"syncforge/internal/crdt"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://syncforge:syncforge@127.0.0.1:55432/syncforge?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	s, e := Open(ctx, url)
	if e != nil {
		t.Fatalf("real PostgreSQL required: start npm run db: %v", e)
	}
	t.Cleanup(s.Pool.Close)
	return s
}
func TestPersistenceAndAtomicity(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	doc := fmt.Sprintf("store-%d", time.Now().UnixNano())
	ops := []crdt.Op{{ID: "1:a", Kind: "insert", Value: "x"}, {ID: "2:a", Kind: "insert", After: "1:a", Value: "😀"}}
	if e := s.Append(ctx, doc, ops); e != nil {
		t.Fatal(e)
	}
	if e := s.Append(ctx, doc, ops); e != nil {
		t.Fatal(e)
	}
	conflict := []crdt.Op{{ID: "3:a", Kind: "insert", Value: "z"}, {ID: "1:a", Kind: "insert", Value: "q"}}
	if s.Append(ctx, doc, conflict) == nil {
		t.Fatal("expected rollback")
	}
	rows, e := s.Since(ctx, doc, 0)
	if e != nil || len(rows) != 2 || rows[1].Seq != 2 {
		t.Fatalf("%v %v", rows, e)
	}
	s2 := testStore(t)
	rows, e = s2.Since(ctx, doc, 1)
	if e != nil || len(rows) != 1 || rows[0].Op.Value != "😀" {
		t.Fatalf("reopened store: %v %v", rows, e)
	}
}
func TestConcurrentWritersAndCatchup(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	doc := fmt.Sprintf("concurrent-%d", time.Now().UnixNano())
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			op := crdt.Op{ID: fmt.Sprintf("1:actor%d", i), Kind: "insert", Value: "x"}
			if e := s.Append(ctx, doc, []crdt.Op{op, op}); e != nil {
				t.Error(e)
			}
		}(i)
	}
	wg.Wait()
	rows, e := s.Since(ctx, doc, 0)
	if e != nil || len(rows) != 50 {
		t.Fatalf("%d %v", len(rows), e)
	}
	for i, r := range rows {
		if r.Seq != int64(i+1) {
			t.Fatal("non-contiguous sequence")
		}
	}
}

func TestPrivateDocumentAuthorization(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	doc := fmt.Sprintf("private-%d", time.Now().UnixNano())
	if err := s.CreatePrivate(ctx, doc, "a-very-long-secret-document-key"); err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]bool{"": false, "wrong": false, "a-very-long-secret-document-key": true} {
		got, err := s.Authorized(ctx, doc, key)
		if err != nil || got != want {
			t.Fatalf("key %q: got %v, err %v", key, got, err)
		}
	}
	if err := s.CreatePrivate(ctx, doc, "another-long-secret-document-key"); err == nil {
		t.Fatal("duplicate document created")
	}
}
