package server

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"log"
	"net/http"
	"strconv"
	"syncforge/internal/crdt"
	"syncforge/internal/store"
	"time"
)

type Server struct {
	Store          *store.Store
	AllowedOrigins []string
}
type message struct {
	Type    string        `json:"type"`
	Ops     []crdt.Op     `json:"ops,omitempty"`
	Entries []store.Entry `json:"entries,omitempty"`
	IDs     []string      `json:"ids,omitempty"`
	Cursor  int64         `json:"cursor"`
	Error   string        `json:"error,omitempty"`
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if e := s.Store.Pool.Ping(ctx); e != nil {
			http.Error(w, "database unavailable", 503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /ws", s.socket)
	mux.Handle("/", http.FileServer(http.Dir("dist")))
	return mux
}
func (s *Server) socket(w http.ResponseWriter, r *http.Request) {
	doc := r.URL.Query().Get("doc")
	cursor, e := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	if !store.ValidDocument(doc) || e != nil || cursor < 0 {
		http.Error(w, "invalid document or cursor", 400)
		return
	}
	conn, e := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: s.AllowedOrigins})
	if e != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(1024 * 1024)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	responses := make(chan message, 16)
	go func() {
		defer cancel()
		for {
			var m message
			if e := wsjson.Read(ctx, conn, &m); e != nil {
				return
			}
			if m.Type != "push" {
				select {
				case responses <- message{Type: "error", Error: "unknown message"}:
				case <-ctx.Done():
					return
				}
				continue
			}
			err := s.Store.Append(ctx, doc, m.Ops)
			reply := message{Type: "ack"}
			if err != nil {
				reply.Type = "error"
				reply.Error = "Operation batch rejected; edits remain on this device"
				if errors.Is(err, store.ErrConflict) {
					reply.Error = "Operation ID conflict; edits remain on this device"
				}
				log.Printf("append: %v", err)
			} else {
				for _, op := range m.Ops {
					reply.IDs = append(reply.IDs, op.ID)
				}
			}
			select {
			case responses <- reply:
			case <-ctx.Done():
				return
			}
		}
	}()
	send := func(m message) error {
		writeCtx, stop := context.WithTimeout(ctx, 5*time.Second)
		defer stop()
		return wsjson.Write(writeCtx, conn, m)
	}
	catchUp := func() error {
		for {
			entries, err := s.Store.Since(ctx, doc, cursor)
			if err != nil {
				return err
			}
			if len(entries) > 0 {
				cursor = entries[len(entries)-1].Seq
				if err = send(message{Type: "ops", Entries: entries, Cursor: cursor}); err != nil {
					return err
				}
			}
			if len(entries) < 1000 {
				return send(message{Type: "ready", Cursor: cursor})
			}
		}
	}
	if e = catchUp(); e != nil {
		return
	}
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case reply := <-responses:
			if send(reply) != nil {
				return
			}
			if catchUp() != nil {
				return
			}
		case <-ticker.C:
			if catchUp() != nil {
				return
			}
		}
	}
}
