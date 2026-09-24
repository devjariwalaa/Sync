package server

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"sync"
	"syncforge/internal/crdt"
	"syncforge/internal/store"
	"time"
)

type Server struct {
	Store          *store.Store
	AllowedOrigins []string
	presence       sync.Map
}
type message struct {
	Type    string        `json:"type"`
	Ops     []crdt.Op     `json:"ops,omitempty"`
	Entries []store.Entry `json:"entries,omitempty"`
	IDs     []string      `json:"ids,omitempty"`
	Cursor  int64         `json:"cursor"`
	Error   string        `json:"error,omitempty"`
	Client  string        `json:"client,omitempty"`
	Name    string        `json:"name,omitempty"`
	Users   []presence    `json:"users,omitempty"`
}
type presence struct {
	Client string `json:"client"`
	Name   string `json:"name"`
}
type room struct {
	sync.Mutex
	users map[string]string
}

func (s *Server) room(doc string) *room {
	r, _ := s.presence.LoadOrStore(doc, &room{users: map[string]string{}})
	return r.(*room)
}
func (s *Server) users(doc string) []presence {
	r := s.room(doc)
	r.Lock()
	defer r.Unlock()
	out := make([]presence, 0, len(r.users))
	for client, name := range r.users {
		out = append(out, presence{client, name})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Client < out[j].Client })
	return out
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
	mux.HandleFunc("POST /api/documents", s.createDocument)
	mux.Handle("/", http.FileServer(http.Dir("dist")))
	return mux
}
func (s *Server) socket(w http.ResponseWriter, r *http.Request) {
	doc := r.URL.Query().Get("doc")
	key := r.URL.Query().Get("key")
	client, name := r.URL.Query().Get("client"), r.URL.Query().Get("name")
	cursor, e := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	if !store.ValidDocument(doc) || e != nil || cursor < 0 || !validIdentity(client, name) {
		http.Error(w, "invalid document or cursor", 400)
		return
	}
	allowed, authErr := s.Store.Authorized(r.Context(), doc, key)
	if authErr != nil {
		http.Error(w, "database unavailable", 503)
		return
	}
	if !allowed {
		http.Error(w, "document access denied", 403)
		return
	}
	conn, e := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: s.AllowedOrigins})
	if e != nil {
		return
	}
	defer conn.CloseNow()
	rm := s.room(doc)
	rm.Lock()
	rm.users[client] = name
	rm.Unlock()
	defer func() {
		rm.Lock()
		delete(rm.users, client)
		empty := len(rm.users) == 0
		rm.Unlock()
		if empty {
			s.presence.Delete(doc)
		}
	}()
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
	lastPresence := ""
	sendPresence := func() error {
		users := s.users(doc)
		raw, _ := json.Marshal(users)
		if string(raw) == lastPresence {
			return nil
		}
		lastPresence = string(raw)
		return send(message{Type: "presence", Users: users})
	}
	if e = sendPresence(); e != nil {
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
			if sendPresence() != nil {
				return
			}
		}
	}
}

func (s *Server) createDocument(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body) != nil || !store.ValidDocument(body.ID) {
		http.Error(w, "invalid document", 400)
		return
	}
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		http.Error(w, "cannot create key", 500)
		return
	}
	key := base64.RawURLEncoding.EncodeToString(raw)
	if err := s.Store.CreatePrivate(r.Context(), body.ID, key); err != nil {
		http.Error(w, "document already exists", 409)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]string{"id": body.ID, "key": key})
}

func validIdentity(client, name string) bool {
	return regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`).MatchString(client) && len([]rune(name)) >= 1 && len([]rune(name)) <= 40
}
