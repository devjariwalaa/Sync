package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syncforge/internal/server"
	"syncforge/internal/store"
	"syscall"
	"time"
)

func main() {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://syncforge:syncforge@127.0.0.1:55432/syncforge?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	db, e := store.Open(ctx, url)
	cancel()
	if e != nil {
		log.Fatal(e)
	}
	defer db.Pool.Close()
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = "127.0.0.1:8080"
	}
	handler := (&server.Server{Store: db, AllowedOrigins: []string{"127.0.0.1:5173", "localhost:5173"}}).Handler()
	srv := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		log.Printf("SyncForge listening on http://%s", addr)
		if e = srv.ListenAndServe(); e != nil && e != http.ErrServerClosed {
			log.Fatal(e)
		}
	}()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	stop, c := context.WithTimeout(context.Background(), 5*time.Second)
	defer c()
	srv.Shutdown(stop)
}
