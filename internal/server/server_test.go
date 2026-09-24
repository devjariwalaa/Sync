package server

import (
	"context"
	"fmt"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"net/http/httptest"
	"os"
	"strings"
	"syncforge/internal/crdt"
	"syncforge/internal/store"
	"testing"
	"time"
)

func TestSocketCommitReplayAndIsolation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://syncforge:syncforge@127.0.0.1:55432/syncforge?sslmode=disable"
	}
	db, e := store.Open(ctx, url)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Pool.Close()
	srv := httptest.NewServer((&Server{Store: db}).Handler())
	defer srv.Close()
	doc := fmt.Sprintf("ws-%d", time.Now().UnixNano())
	dial := func(doc string, after int) *websocket.Conn {
		c, _, e := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+fmt.Sprintf("/ws?doc=%s&after=%d&client=test-client&name=Test", doc, after), nil)
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() { c.CloseNow() })
		return c
	}
	read := func(c *websocket.Conn, kind string) message {
		for {
			var m message
			if e := wsjson.Read(ctx, c, &m); e != nil {
				t.Fatal(e)
			}
			if m.Type == kind {
				return m
			}
		}
	}
	a := dial(doc, 0)
	b := dial(doc, 0)
	read(a, "ready")
	read(b, "ready")
	op := crdt.Op{ID: "1:a", Kind: "insert", Value: "x"}
	wsjson.Write(ctx, a, message{Type: "push", Ops: []crdt.Op{op}})
	ack := read(a, "ack")
	if len(ack.IDs) != 1 {
		t.Fatal(ack)
	}
	rows, e := db.Since(ctx, doc, 0)
	if e != nil || len(rows) != 1 {
		t.Fatal("ack before durable commit")
	}
	if got := read(b, "ops"); got.Entries[0].Op != op {
		t.Fatal(got)
	}
	a.CloseNow()
	a = dial(doc, 0)
	if got := read(a, "ops"); got.Cursor != 1 {
		t.Fatal(got)
	}
	read(a, "ready")
	wsjson.Write(ctx, a, message{Type: "push", Ops: []crdt.Op{op}})
	read(a, "ack")
	rows, _ = db.Since(ctx, doc, 0)
	if len(rows) != 1 {
		t.Fatal("duplicate persisted")
	}
	other := dial(doc+"-other", 0)
	if m := read(other, "ready"); m.Cursor != 0 {
		t.Fatal("document leak")
	}
	bad := dial(doc, 0)
	read(bad, "ops")
	read(bad, "ready")
	wsjson.Write(ctx, bad, message{Type: "push", Ops: []crdt.Op{{ID: "1:a", Kind: "insert", Value: "z"}}})
	read(bad, "error")
}

func TestIdentityValidation(t *testing.T) {
	for _, tc := range []struct {
		client, name string
		valid        bool
	}{{"abc", "Ada", true}, {"", "Ada", false}, {"bad id", "Ada", false}, {"abc", "", false}, {"abc", strings.Repeat("x", 41), false}} {
		if got := validIdentity(tc.client, tc.name); got != tc.valid {
			t.Fatalf("validIdentity(%q,%q)=%v", tc.client, tc.name, got)
		}
	}
}
